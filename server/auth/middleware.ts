import type { Database } from 'better-sqlite3';
import type { RequestHandler, Response } from 'express';

import type { AuthHttpErrorClass } from './errors.js';

declare module 'express-session' {
  interface SessionData {
    userId?: number;
    /** Mot de passe vérifié, code TOTP attendu (`POST /api/auth/2fa/verify`). */
    pendingUserId?: number;
    pendingTotpAt?: number;
    /** Secret proposé par `/2fa/setup`, en attente de confirmation par `/2fa/enable`. */
    pendingTotpSecret?: string;
  }
}

/** Compte de la requête, posé par `requireAuth` (ou `actAs`). */
export function currentUserId(res: Response): number {
  return res.locals.userId as number;
}

/** Sans authentification (tests de modules) : toutes les requêtes agissent pour ce compte. */
export function actAs(userId: number): RequestHandler {
  return (_req, res, next) => {
    res.locals.userId = userId;
    next();
  };
}

/** Middlewares d'accès, qui lèvent les erreurs avec la classe `HttpError` du projet. */
export function createAuthMiddleware(HttpError: AuthHttpErrorClass) {
  /** Session requise : le compte est posé dans `res.locals.userId`, lu par `currentUserId`. */
  const requireAuth: RequestHandler = (req, res, next) => {
    const userId = req.session?.userId;
    if (!userId) {
      throw new HttpError(401, 'common.unauthorized');
    }
    res.locals.userId = userId;
    next();
  };

  /**
   * Réservé aux admins, après `requireAuth`. Le rôle est lu en base à chaque requête : une
   * rétrogradation prend effet tout de suite.
   */
  const createRequireAdmin = (db: Database): RequestHandler => {
    const isAdminStmt = db.prepare<[number], { is_admin: number }>(
      'SELECT is_admin FROM users WHERE id = ?',
    );
    return (_req, res, next) => {
      const userId = res.locals.userId as number | undefined;
      if (!userId || isAdminStmt.get(userId)?.is_admin !== 1) {
        throw new HttpError(403, 'common.forbidden');
      }
      next();
    };
  };

  return { requireAuth, createRequireAdmin };
}
