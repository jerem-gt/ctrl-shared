import { randomBytes } from 'node:crypto';

import bcrypt from 'bcrypt';
import { Router } from 'express';

import { sha256Hex } from '../crypto.js';
import { FailureRateLimiter } from '../rateLimit.js';
import { type AuthContext, BCRYPT_COST, clientKey } from './context.js';
import { emailSchema, resetPasswordSchema } from './schemas.js';
import type { User } from './types.js';

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const FORGOT_MAX_REQUESTS = 5;

/** Mot de passe oublié : lien à usage unique par e-mail (ou dans les logs, sans SMTP). */
export function createPasswordRouter<L extends string, S>(ctx: AuthContext<L, S>): Router {
  const { db, repo, devices, sessionStore, mailer, log, schemas, assertAllowed } = ctx;
  const { HttpError, appUrl, mailTexts } = ctx.options;
  const router = Router();
  const forgotLimiter = new FailureRateLimiter(db, FORGOT_MAX_REQUESTS);
  const resetLimiter = new FailureRateLimiter(db);

  function validResetToken(tokenHash: string) {
    const row = repo.getResetToken(tokenHash);
    return row && row.expires_at > Date.now() ? row : undefined;
  }

  function issueResetLink(user: User, lang: L): void {
    const now = Date.now();
    repo.purgeExpiredResetTokens(now);
    repo.deleteResetTokensForUser(user.id);
    const token = randomBytes(32).toString('base64url');
    repo.insertResetToken(sha256Hex(token), user.id, now + RESET_TOKEN_TTL_MS);

    const path = `/reset-password?token=${token}`;
    const fallbackMessage = `[auth] réinitialisation du mot de passe de « ${user.username} » : ouvrir ${appUrl ?? ''}${path}`;
    if (mailer.isConfigured() && user.email && appUrl) {
      const { subject, text } = mailTexts.reset(
        lang,
        `${appUrl}${path}`,
        RESET_TOKEN_TTL_MS / 60_000,
      );
      mailer.send({ to: user.email, subject, text }).catch((err: unknown) => {
        log.error(`[auth] envoi de l'e-mail de réinitialisation échoué : ${String(err)}`);
        log.warn(fallbackMessage);
      });
      return;
    }
    log.warn(fallbackMessage);
  }

  /** Réponse identique que le compte existe ou non : ne révèle ni les noms ni les e-mails. */
  router.post('/password/forgot', (req, res) => {
    const key = clientKey(req, 'forgot:');
    assertAllowed(forgotLimiter, key);
    // Chaque requête compte, qu'elle aboutisse ou non.
    forgotLimiter.recordFailure(key);

    const { identifier, lang } = schemas.forgotPasswordSchema.parse(req.body);
    const email = emailSchema.safeParse(identifier);
    const user =
      repo.getByUsername(identifier) ?? (email.success ? repo.getByEmail(email.data) : undefined);
    if (user) {
      try {
        issueResetLink(user, lang);
      } catch (err) {
        log.error(`[auth] création du lien de réinitialisation échouée : ${String(err)}`);
      }
    }
    res.status(204).end();
  });

  router.post('/password/reset', async (req, res) => {
    const key = clientKey(req, 'reset:');
    assertAllowed(resetLimiter, key);
    const data = resetPasswordSchema.parse(req.body);

    const tokenHash = sha256Hex(data.token);
    if (!validResetToken(tokenHash)) {
      resetLimiter.recordFailure(key);
      throw new HttpError(400, 'auth.reset_token_invalid');
    }

    // Haché après la vérification du jeton : un faux jeton ne coûte pas un bcrypt au serveur.
    const hash = await bcrypt.hash(data.password, BCRYPT_COST);
    // Revérifié dans la transaction : un jeton consommé pendant le hachage ne sert pas deux fois.
    const userId = db.transaction((): number | null => {
      const row = validResetToken(tokenHash);
      if (!row) {
        return null;
      }
      repo.updatePassword(row.user_id, hash);
      repo.deleteResetTokensForUser(row.user_id);
      // Les appareils mémorisés tombent ; la 2FA reste active (un admin peut la désactiver).
      devices.revokeAll(row.user_id);
      return row.user_id;
    })();
    if (userId === null) {
      throw new HttpError(400, 'auth.reset_token_invalid');
    }
    sessionStore.destroyAllSessions(userId);
    resetLimiter.reset(key);
    res.status(204).end();
  });

  return router;
}
