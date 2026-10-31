import { Router } from 'express';

import { matchTotpStep, newTotpSecret } from '../totp.js';
import type { AuthContext } from './context.js';
import { currentUserId } from './middleware.js';
import { disableTotpSchema, enableTotpSchema, idParamSchema } from './schemas.js';
import type { TotpSetupResponse, TrustedDeviceItem } from './types.js';

/** Activation et désactivation de la 2FA, appareils mémorisés du compte connecté. */
export function createTotpRouter<L extends string, S>(ctx: AuthContext<L, S>): Router {
  const { db, repo, devices, deviceCookies, sessionUser, checkCurrentPassword } = ctx;
  const { HttpError, appName } = ctx.options;
  const router = Router();

  router.use(['/2fa/setup', '/2fa/enable', '/2fa/disable', '/devices'], ctx.requireAuth);

  /** Nouveau secret, gardé en session jusqu'à sa confirmation par `/2fa/enable`. */
  router.post('/2fa/setup', (req, res) => {
    const user = sessionUser(res);
    if (user.totp_enabled === 1) {
      throw new HttpError(409, 'auth.totp_already_enabled');
    }
    const body: TotpSetupResponse = newTotpSecret(appName, user.username);
    req.session.pendingTotpSecret = body.secret;
    res.json(body);
  });

  /** Le premier code confirme le secret ; les appareils mémorisés sont révoqués. */
  router.post('/2fa/enable', (req, res) => {
    const { code } = enableTotpSchema.parse(req.body);
    const user = sessionUser(res);
    if (user.totp_enabled === 1) {
      throw new HttpError(409, 'auth.totp_already_enabled');
    }
    const secret = req.session.pendingTotpSecret;
    if (!secret) {
      throw new HttpError(400, 'auth.totp_setup_expired');
    }
    const step = matchTotpStep(secret, code);
    if (step === null) {
      throw new HttpError(401, 'auth.totp_invalid');
    }
    db.transaction(() => {
      repo.enableTotp(user.id, secret, step);
      devices.revokeAll(user.id);
    })();
    delete req.session.pendingTotpSecret;
    res.status(204).end();
  });

  router.post('/2fa/disable', async (req, res) => {
    const { password } = disableTotpSchema.parse(req.body);
    const user = sessionUser(res);
    if (user.totp_enabled !== 1) {
      throw new HttpError(409, 'auth.totp_not_enabled');
    }
    await checkCurrentPassword(user, password);
    ctx.disableTotp(user.id);
    res.status(204).end();
  });

  router.get('/devices', (req, res) => {
    const now = Date.now();
    devices.purgeExpired(now);
    const currentHash = deviceCookies.currentHash(req);
    const items: TrustedDeviceItem[] = devices.list(currentUserId(res), now).map((device) => ({
      id: device.id,
      label: device.label,
      createdAt: device.created_at,
      lastUsedAt: device.last_used_at,
      expiresAt: device.expires_at,
      current: device.token_hash === currentHash,
    }));
    res.json({ items });
  });

  router.delete('/devices/:id', (req, res) => {
    const id = idParamSchema.parse(req.params.id);
    const device = devices.get(id, currentUserId(res));
    if (!device) {
      throw new HttpError(404, 'auth.device_not_found');
    }
    devices.remove(device.id, device.user_id);
    if (deviceCookies.currentHash(req) === device.token_hash) {
      deviceCookies.clear(req, res);
    }
    res.status(204).end();
  });

  /** Le cookie n'est effacé que s'il appartient au compte (navigateur partagé). */
  router.delete('/devices', (req, res) => {
    const userId = currentUserId(res);
    const ownsCookie = deviceCookies.belongsTo(req, userId);
    devices.revokeAll(userId);
    if (ownsCookie) {
      deviceCookies.clear(req, res);
    }
    res.status(204).end();
  });

  return router;
}
