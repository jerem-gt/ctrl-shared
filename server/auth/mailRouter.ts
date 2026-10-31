import { Router } from 'express';

import type { AuthContext } from './context.js';
import { currentUserId } from './middleware.js';

/** E-mail de test envoyé à l'admin connecté : vérifie la configuration SMTP. */
export function createMailRouter<L extends string, S>(ctx: AuthContext<L, S>): Router {
  const { repo, mailer, log } = ctx;
  const { HttpError, mailTexts } = ctx.options;
  const router = Router();

  router.post('/test-email', ctx.requireAuth, ctx.requireAdmin, async (_req, res) => {
    const user = repo.getById(currentUserId(res));
    if (!user?.email) {
      throw new HttpError(400, 'auth.email_missing');
    }
    if (!mailer.isConfigured()) {
      throw new HttpError(503, 'auth.smtp_not_configured');
    }
    try {
      await mailer.send({ to: user.email, ...mailTexts.test() });
    } catch (err) {
      log.error(`[auth] envoi de l'e-mail de test échoué : ${String(err)}`);
      throw new HttpError(502, 'auth.email_send_failed');
    }
    res.status(204).end();
  });

  return router;
}
