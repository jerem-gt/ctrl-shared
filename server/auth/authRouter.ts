import bcrypt from 'bcrypt';
import { type NextFunction, type Request, type Response, Router } from 'express';

import { matchTotpStep } from '../totp.js';
import { BCRYPT_COST } from './authRepo.js';
import type { AuthContext } from './context.js';
import { createMailRouter } from './mailRouter.js';
import { createPasswordRouter } from './passwordRouter.js';
import { changePasswordSchema, loginSchema, profileSchema, verifyTotpSchema } from './schemas.js';
import { createTotpRouter } from './totpRouter.js';
import type { LoginResponse, SessionResponse, SetupStatusResponse, User } from './types.js';

/** Délai pour donner le code TOTP après le mot de passe. */
const TOTP_PENDING_TTL_MS = 5 * 60 * 1000;

export function sessionResponse(user: User): SessionResponse {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    isAdmin: user.is_admin === 1,
    totpEnabled: user.totp_enabled === 1,
  };
}

/** Régénère la session (anti-fixation) puis y pose l'utilisateur authentifié. */
function startSession(req: Request, res: Response, next: NextFunction, user: User): void {
  req.session.regenerate((regenerateError) => {
    if (regenerateError) {
      next(regenerateError);
      return;
    }
    req.session.userId = user.id;
    req.session.save((saveError) => {
      if (saveError) {
        next(saveError);
        return;
      }
      res.json(sessionResponse(user));
    });
  });
}

/** Monté sur `/api/auth` : premier compte, connexion (2FA comprise), profil, mot de passe. */
export function createAuthRouter<L extends string, S>(ctx: AuthContext<L, S>): Router {
  const { db, repo, usersRepo, devices, deviceCookies, limiter, setupToken, log, schemas } = ctx;
  const { HttpError, appName, sessionCookie, onUserCreated } = ctx.options;
  const router = Router();

  // Hash factice, du même coût que les vrais, comparé quand l'identifiant est inconnu : égalise
  // le temps de réponse pour ne pas révéler si le compte existe. Calculé à la première utilisation.
  let dummyHash: string | undefined;
  const getDummyHash = () =>
    (dummyHash ??= bcrypt.hashSync(`${appName}-unknown-user`, BCRYPT_COST));

  router.get('/setup', (_req, res) => {
    const body: SetupStatusResponse = { required: repo.countUsers() === 0 };
    res.json(body);
  });

  router.post('/setup', async (req, res, next) => {
    if (repo.countUsers() > 0) {
      throw new HttpError(409, 'auth.setup_done');
    }
    const key = `setup:${req.ip ?? 'unknown'}`;
    if (!limiter.isAllowed(key)) {
      throw new HttpError(429, 'auth.too_many_attempts');
    }
    const data = schemas.setupSchema.parse(req.body);
    if (!setupToken.verify(data.token)) {
      limiter.recordFailure(key);
      throw new HttpError(403, 'auth.setup_token_invalid');
    }

    const hash = await bcrypt.hash(data.password, BCRYPT_COST);
    // Revérifié dans la transaction : deux requêtes simultanées ne créent qu'un compte.
    const userId = db.transaction((): number | null => {
      if (repo.countUsers() > 0) {
        return null;
      }
      const id = repo.createAdmin(data.username, hash);
      onUserCreated?.(db, id, data.lang);
      return id;
    })();
    if (userId === null) {
      throw new HttpError(409, 'auth.setup_done');
    }
    setupToken.consume();
    limiter.reset(key);
    log.info(`[auth] premier compte créé : « ${data.username} » (admin)`);
    startSession(req, res, next, repo.getById(userId) as User);
  });

  router.post('/login', async (req, res, next) => {
    const key = req.ip ?? 'unknown';
    if (!limiter.isAllowed(key)) {
      throw new HttpError(429, 'auth.too_many_attempts');
    }
    const { username, password } = loginSchema.parse(req.body);
    const user = repo.getByUsername(username);
    const passwordOk = await bcrypt.compare(password, user?.password_hash ?? getDummyHash());
    if (!user || !passwordOk) {
      limiter.recordFailure(key);
      log.warn(`[auth] échec de connexion depuis ${key}`);
      throw new HttpError(401, 'auth.invalid_credentials');
    }
    if (user.totp_enabled === 1) {
      if (deviceCookies.isTrusted(req, res, user.id)) {
        limiter.reset(key);
        startSession(req, res, next, user);
        return;
      }
      // Mot de passe vérifié : une session neuve attend le code (le limiteur se remet à zéro
      // après lui). Régénérée, elle ne garde rien d'une connexion précédente (autre compte).
      req.session.regenerate((regenerateError) => {
        if (regenerateError) {
          next(regenerateError);
          return;
        }
        req.session.pendingUserId = user.id;
        req.session.pendingTotpAt = Date.now();
        req.session.save((saveError) => {
          if (saveError) {
            next(saveError);
            return;
          }
          const body: LoginResponse = { totpRequired: true };
          res.json(body);
        });
      });
      return;
    }
    limiter.reset(key);
    startSession(req, res, next, user);
  });

  /** Second temps de la connexion : échecs limités par IP et par compte, code à usage unique. */
  router.post('/2fa/verify', (req, res, next) => {
    const key = req.ip ?? 'unknown';
    if (!limiter.isAllowed(key)) {
      throw new HttpError(429, 'auth.too_many_attempts');
    }
    const { code, remember } = verifyTotpSchema.parse(req.body);
    const { pendingUserId, pendingTotpAt } = req.session;
    const expired =
      pendingUserId === undefined ||
      pendingTotpAt === undefined ||
      Date.now() - pendingTotpAt > TOTP_PENDING_TTL_MS;
    const user = expired ? undefined : repo.getById(pendingUserId);
    if (user?.totp_enabled !== 1 || !user.totp_secret) {
      throw new HttpError(401, 'auth.totp_token_invalid');
    }
    const accountKey = `totp:${user.id}`;
    if (!limiter.isAllowed(accountKey)) {
      throw new HttpError(429, 'auth.too_many_attempts');
    }
    const step = matchTotpStep(user.totp_secret, code);
    if (step === null || !repo.consumeTotpStep(user.id, step)) {
      limiter.recordFailure(key);
      limiter.recordFailure(accountKey);
      log.warn(`[auth] code 2FA refusé pour « ${user.username} » depuis ${key}`);
      throw new HttpError(401, 'auth.totp_invalid');
    }
    limiter.reset(key);
    limiter.reset(accountKey);
    if (remember) {
      deviceCookies.remember(req, res, user.id);
    }
    startSession(req, res, next, user);
  });

  router.post('/logout', (req, res) => {
    req.session.destroy(() => {
      res.clearCookie(sessionCookie);
      res.status(204).end();
    });
  });

  router.get('/me', (req, res) => {
    const user = req.session?.userId ? repo.getById(req.session.userId) : undefined;
    if (!user) {
      throw new HttpError(401, 'common.unauthorized');
    }
    res.json(sessionResponse(user));
  });

  /** Nom d'utilisateur et e-mail : le mot de passe actuel est requis. */
  router.patch('/profile', ctx.requireAuth, async (req, res) => {
    const { currentPassword, username, email } = profileSchema.parse(req.body);
    const user = ctx.sessionUser(res);
    await ctx.checkCurrentPassword(user, currentPassword);
    ctx.assertIdentityFree(user.id, username, email);
    db.transaction(() => {
      if (username !== undefined) {
        usersRepo.updateUsername(user.id, username);
      }
      if (email !== undefined) {
        usersRepo.updateEmail(user.id, email);
      }
    })();
    res.json(sessionResponse(repo.getById(user.id) as User));
  });

  /** Ferme les autres sessions du compte, garde la session courante. */
  router.post('/change-password', ctx.requireAuth, async (req, res) => {
    const data = changePasswordSchema.parse(req.body);
    const user = ctx.sessionUser(res);
    await ctx.checkCurrentPassword(user, data.current);
    const hash = await bcrypt.hash(data.next, BCRYPT_COST);
    db.transaction(() => {
      repo.updatePassword(user.id, hash);
      devices.revokeAll(user.id);
    })();
    ctx.sessionStore.destroyOtherSessions(user.id, req.sessionID);
    res.status(204).end();
  });

  router.use(createTotpRouter(ctx));
  router.use(createPasswordRouter(ctx));
  router.use(createMailRouter(ctx));

  return router;
}
