import bcrypt from 'bcrypt';
import type { Database } from 'better-sqlite3';
import type { RequestHandler, Response } from 'express';

import { createDeviceCookies, type DeviceCookies } from '../deviceCookie.js';
import { createMailer, type Mailer } from '../mailer.js';
import { FailureRateLimiter } from '../rateLimit.js';
import type { SQLiteSessionStore } from '../session-store.js';
import { SetupToken } from '../setup.js';
import { createTrustedDevicesRepo, type TrustedDevicesRepo } from '../trustedDevices.js';
import { type AuthRepo, createAuthRepo } from './authRepo.js';
import { createAuthMiddleware, currentUserId } from './middleware.js';
import type { AuthModuleOptions } from './options.js';
import { createLangSchemas, type LangSchemas } from './schemas.js';
import type { AuthLogger, User } from './types.js';
import { createUsersRepo, type UsersRepo } from './usersRepo.js';

/** Dépendances partagées par les routeurs du module, construites une fois par `createAuthModule`. */
export interface AuthContext<L extends string, S> {
  db: Database;
  sessionStore: SQLiteSessionStore;
  options: AuthModuleOptions<L, S>;
  repo: AuthRepo;
  usersRepo: UsersRepo<S>;
  devices: TrustedDevicesRepo;
  deviceCookies: DeviceCookies;
  limiter: FailureRateLimiter;
  mailer: Mailer;
  setupToken: SetupToken;
  log: AuthLogger;
  schemas: LangSchemas<L>;
  requireAuth: RequestHandler;
  requireAdmin: RequestHandler;
  /** Le compte de la session ; supprimé entre-temps : 401. */
  sessionUser: (res: Response) => User;
  /** Vérifie le mot de passe actuel, échecs limités par compte ; lève 429/401 sinon. */
  checkCurrentPassword: (user: User, candidate: string) => Promise<void>;
  /** Lève 409 si le nom ou l'e-mail est pris par un autre compte que `id` (null : création). */
  assertIdentityFree: (
    id: number | null,
    username: string | undefined,
    email: string | null | undefined,
  ) => void;
}

export function createAuthContext<L extends string, S>(
  db: Database,
  sessionStore: SQLiteSessionStore,
  options: AuthModuleOptions<L, S>,
): AuthContext<L, S> {
  const { HttpError } = options;
  const repo = createAuthRepo(db);
  const usersRepo = createUsersRepo(db, options.userStats);
  const devices = createTrustedDevicesRepo(db);
  const limiter = options.limiter ?? new FailureRateLimiter(db);
  const { requireAuth, createRequireAdmin } = createAuthMiddleware(HttpError);

  return {
    db,
    sessionStore,
    options,
    repo,
    usersRepo,
    devices,
    deviceCookies: createDeviceCookies(devices, {
      name: options.deviceCookie,
      secure: options.secureCookies === true,
    }),
    limiter,
    mailer: options.mailer ?? createMailer(),
    setupToken: options.setupToken ?? new SetupToken(),
    log: options.log ?? console,
    schemas: createLangSchemas(options.languages),
    requireAuth,
    requireAdmin: createRequireAdmin(db),

    sessionUser: (res) => {
      const user = repo.getById(currentUserId(res));
      if (!user) {
        throw new HttpError(401, 'common.unauthorized');
      }
      return user;
    },

    checkCurrentPassword: async (user, candidate) => {
      const key = `password:${user.id}`;
      if (!limiter.isAllowed(key)) {
        throw new HttpError(429, 'auth.too_many_attempts');
      }
      if (!(await bcrypt.compare(candidate, user.password_hash))) {
        limiter.recordFailure(key);
        throw new HttpError(401, 'auth.current_password_incorrect');
      }
      limiter.reset(key);
    },

    assertIdentityFree: (id, username, email) => {
      const usernameOwner = username === undefined ? undefined : usersRepo.getByUsername(username);
      if (usernameOwner && usernameOwner.id !== id) {
        throw new HttpError(409, 'user.username_taken');
      }
      const emailOwner = email ? usersRepo.getByEmail(email) : undefined;
      if (emailOwner && emailOwner.id !== id) {
        throw new HttpError(409, 'user.email_taken');
      }
    },
  };
}
