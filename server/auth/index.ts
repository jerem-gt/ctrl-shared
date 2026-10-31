import type { Database } from 'better-sqlite3';
import type { RequestHandler, Router } from 'express';

import type { SQLiteSessionStore } from '../session-store.js';
import { createAuthRouter } from './authRouter.js';
import { createAuthContext } from './context.js';
import type { AuthModuleOptions } from './options.js';
import { createUsersRouter } from './usersRouter.js';

export { AUTH_ERROR_MESSAGES, type AuthErrorCode, type AuthHttpErrorClass } from './errors.js';
export { actAs, createAuthMiddleware, currentUserId } from './middleware.js';
export type { AuthModuleOptions, AuthRuntimeOptions, UserDeletedHook } from './options.js';
export * from './schemas.js';
export type * from './types.js';

export interface AuthModule {
  /** À monter sur `/api/auth`. */
  authRouter: Router;
  /** À monter sur `/api/users` (admins). */
  usersRouter: Router;
  /** Session requise ; pose le compte lu par `currentUserId`. */
  requireAuth: RequestHandler;
  /** Réservé aux admins, après `requireAuth`. */
  requireAdmin: RequestHandler;
}

/**
 * Comptes et authentification communs à cash-ctrl et shelf-ctrl : premier compte, connexion
 * (2FA TOTP, appareils mémorisés), profil, mot de passe oublié, e-mail de test, gestion des
 * comptes par un admin. Les tables (`users`, `password_reset_tokens`, `trusted_devices`)
 * appartiennent aux migrations du projet ; ce qui est propre à l'appli passe par `options`.
 */
export function createAuthModule<L extends string, S>(
  db: Database,
  sessionStore: SQLiteSessionStore,
  options: AuthModuleOptions<L, S>,
): AuthModule {
  const ctx = createAuthContext(db, sessionStore, options);
  return {
    authRouter: createAuthRouter(ctx),
    usersRouter: createUsersRouter(ctx),
    requireAuth: ctx.requireAuth,
    requireAdmin: ctx.requireAdmin,
  };
}
