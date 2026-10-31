import bcrypt from 'bcrypt';
import type { Database } from 'better-sqlite3';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

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

/** Coût bcrypt des mots de passe (et du hash factice de la connexion). */
export const BCRYPT_COST = 12;

/** Clé de limitation d'une requête : son adresse IP, préfixée par l'action (`setup:`, `reset:`…). */
export const clientKey = (req: Request, prefix = '') => `${prefix}${req.ip ?? 'unknown'}`;

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
  /** Lève 429 si la clé a épuisé ses essais auprès de ce limiteur. */
  assertAllowed: (limiter: FailureRateLimiter, key: string) => void;
  /**
   * Session neuve (anti-fixation) : `fill` y pose ce qu'il faut, puis `respond` répond une fois
   * la session enregistrée ; une erreur du store part au gestionnaire global.
   */
  regenerateSession: (
    req: Request,
    next: NextFunction,
    fill: () => void,
    respond: () => void,
  ) => void;
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
  /** Désactive la 2FA du compte ; ses appareils mémorisés tombent avec elle. */
  disableTotp: (userId: number) => void;
}

export function createAuthContext<L extends string, S>(
  db: Database,
  sessionStore: SQLiteSessionStore,
  options: AuthModuleOptions<L, S>,
): AuthContext<L, S> {
  const { HttpError } = options;
  const repo = createAuthRepo(db);
  const devices = createTrustedDevicesRepo(db);
  const limiter = options.limiter ?? new FailureRateLimiter(db);
  const { requireAuth, createRequireAdmin } = createAuthMiddleware(HttpError);

  const assertAllowed = (rateLimiter: FailureRateLimiter, key: string): void => {
    if (!rateLimiter.isAllowed(key)) {
      throw new HttpError(429, 'auth.too_many_attempts');
    }
  };

  return {
    db,
    sessionStore,
    options,
    repo,
    usersRepo: createUsersRepo(db, options.userStats),
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
    assertAllowed,

    regenerateSession: (req, next, fill, respond) => {
      req.session.regenerate((regenerateError) => {
        if (regenerateError) {
          next(regenerateError);
          return;
        }
        fill();
        req.session.save((saveError) => {
          if (saveError) {
            next(saveError);
            return;
          }
          respond();
        });
      });
    },

    sessionUser: (res) => {
      const user = repo.getById(currentUserId(res));
      if (!user) {
        throw new HttpError(401, 'common.unauthorized');
      }
      return user;
    },

    checkCurrentPassword: async (user, candidate) => {
      const key = `password:${user.id}`;
      assertAllowed(limiter, key);
      if (!(await bcrypt.compare(candidate, user.password_hash))) {
        limiter.recordFailure(key);
        throw new HttpError(401, 'auth.current_password_incorrect');
      }
      limiter.reset(key);
    },

    assertIdentityFree: (id, username, email) => {
      const usernameOwner = username === undefined ? undefined : repo.getByUsername(username);
      if (usernameOwner && usernameOwner.id !== id) {
        throw new HttpError(409, 'user.username_taken');
      }
      const emailOwner = email ? repo.getByEmail(email) : undefined;
      if (emailOwner && emailOwner.id !== id) {
        throw new HttpError(409, 'user.email_taken');
      }
    },

    disableTotp: (userId) => {
      db.transaction(() => {
        repo.disableTotp(userId);
        devices.revokeAll(userId);
      })();
    },
  };
}
