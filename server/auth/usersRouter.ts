import bcrypt from 'bcrypt';
import { Router } from 'express';

import { type AuthContext, BCRYPT_COST } from './context.js';
import { currentUserId } from './middleware.js';
import { idParamSchema, updateUserSchema } from './schemas.js';

/** Monté sur `/api/users`, réservé aux admins : gestion des comptes. */
export function createUsersRouter<L extends string, S>(ctx: AuthContext<L, S>): Router {
  const { db, repo, usersRepo, devices, sessionStore, schemas, assertIdentityFree } = ctx;
  const { HttpError, onUserCreated, onUserDeleted } = ctx.options;
  const router = Router();

  router.use(ctx.requireAuth, ctx.requireAdmin);

  router.get('/', (_req, res) => {
    res.json({ items: usersRepo.list() });
  });

  /** Retirer le rôle admin (rétrogradation ou suppression) au dernier admin est refusé. */
  const assertNotLastAdmin = (id: number): void => {
    if (usersRepo.getById(id)?.isAdmin === true && usersRepo.countAdmins() <= 1) {
      throw new HttpError(409, 'user.last_admin');
    }
  };

  const assertExists = (id: number): void => {
    if (!repo.getById(id)) {
      throw new HttpError(404, 'user.not_found');
    }
  };

  router.post('/', async (req, res) => {
    const {
      username,
      password,
      email = null,
      isAdmin = false,
      lang,
    } = schemas.createUserSchema.parse(req.body);
    assertIdentityFree(null, username, email);
    const hash = await bcrypt.hash(password, BCRYPT_COST);
    // Revérifié après le hachage (asynchrone) : une requête concurrente a pu prendre le nom.
    const id = db.transaction(() => {
      assertIdentityFree(null, username, email);
      const created = usersRepo.create(username, hash, email, isAdmin);
      onUserCreated?.(db, created, lang);
      return created;
    })();
    res.status(201).json(usersRepo.getById(id));
  });

  router.patch('/:id', async (req, res) => {
    const id = idParamSchema.parse(req.params.id);
    assertExists(id);
    const { username, password, email, isAdmin } = updateUserSchema.parse(req.body);
    const assertAllowed = () => {
      assertIdentityFree(id, username, email);
      if (isAdmin === false) {
        assertNotLastAdmin(id);
      }
    };

    assertAllowed();
    const hash = password === undefined ? null : await bcrypt.hash(password, BCRYPT_COST);
    // Revérifié dans la transaction, après le hachage : deux admins qui se rétrogradent l'un
    // l'autre en même temps ne laissent pas l'application sans admin.
    db.transaction(() => {
      assertAllowed();
      if (username !== undefined) {
        usersRepo.updateUsername(id, username);
      }
      if (email !== undefined) {
        usersRepo.updateEmail(id, email);
      }
      if (isAdmin !== undefined) {
        usersRepo.updateAdmin(id, isAdmin);
      }
      if (hash !== null) {
        repo.updatePassword(id, hash);
        devices.revokeAll(id);
      }
    })();
    // Mot de passe changé : son propre compte garde la session courante, un autre les perd toutes.
    if (hash !== null) {
      if (id === currentUserId(res)) {
        sessionStore.destroyOtherSessions(id, req.sessionID);
      } else {
        sessionStore.destroyAllSessions(id);
      }
    }
    res.json(usersRepo.getById(id));
  });

  /** Téléphone perdu : l'admin désactive la 2FA du compte, ses appareils mémorisés tombent. */
  router.delete('/:id/2fa', (req, res) => {
    const id = idParamSchema.parse(req.params.id);
    const user = repo.getById(id);
    if (!user) {
      throw new HttpError(404, 'user.not_found');
    }
    if (user.totp_enabled !== 1) {
      throw new HttpError(409, 'auth.totp_not_enabled');
    }
    ctx.disableTotp(id);
    res.status(204).end();
  });

  /** Supprime le compte et ses données ; le nettoyage des fichiers suit la transaction. */
  router.delete('/:id', async (req, res) => {
    const id = idParamSchema.parse(req.params.id);
    assertExists(id);
    if (id === currentUserId(res)) {
      throw new HttpError(409, 'user.cannot_delete_self');
    }
    const cleanup = db.transaction(() => {
      assertNotLastAdmin(id);
      const after = onUserDeleted?.(id);
      usersRepo.remove(id);
      return after;
    })();
    sessionStore.destroyAllSessions(id);
    await cleanup?.();
    res.status(204).end();
  });

  return router;
}
