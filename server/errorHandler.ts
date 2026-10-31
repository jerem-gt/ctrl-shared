import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

import { type BaseErrorCode, type ErrorRegistry, zodToApiError } from './apiErrors.js';
import type { HttpErrorClass } from './errors.js';

export interface ErrorHandlerLogger {
  warn(msg: string): void;
  error(msg: string): void;
}

export interface ErrorHandlerOptions<C extends string> {
  /** Classe `HttpError` du projet (`createHttpErrors`). */
  HttpError: HttpErrorClass<C>;
  /** Registre du projet (`createErrorRegistry`). */
  registry: ErrorRegistry<C | BaseErrorCode>;
  /**
   * 4xx en `warn` (méthode, URL, statut, code), sauf les refus d'accès de routine ; 500 en `error`
   * avec la pile.
   */
  log: ErrorHandlerLogger;
}

/**
 * Refus d'accès de routine, non journalisés : 401 (session absente ou expirée, identifiants faux :
 * le module d'auth journalise lui-même les échecs qui comptent) et 403 `common.forbidden` (rôle
 * admin requis). Sinon chaque visite sans session écrirait une ligne.
 */
const isRoutineDenial = (status: number, code: string) =>
  status === 401 || (status === 403 && code === 'common.forbidden');

/** Erreur 4xx des lecteurs de corps (JSON illisible, corps trop gros…), avec son code. */
function bodyParserError(err: unknown): { status: number; code: BaseErrorCode } | null {
  if (typeof err !== 'object' || err === null || !('status' in err)) {
    return null;
  }
  const { status } = err;
  if (typeof status !== 'number' || status < 400 || status >= 500) {
    return null;
  }
  const code: BaseErrorCode =
    status === 413 ? 'common.payload_too_large' : 'common.invalid_request';
  return { status, code };
}

/**
 * Gestionnaire d'erreur global, à monter en dernier : `HttpError` du projet → son statut et son
 * code ; erreur Zod (`schema.parse`) → 400 `validation.invalid` avec le détail par champ ; erreur
 * d'un lecteur de corps → 413 ou 400 ; le reste → 500 `common.internal`, sans détail au client.
 * Rien n'est envoyé si la réponse est déjà partie.
 */
export function createErrorHandler<C extends string>(
  options: ErrorHandlerOptions<C>,
): ErrorRequestHandler {
  const { HttpError, registry, log } = options;

  // 4 paramètres requis pour qu'Express reconnaisse un gestionnaire d'erreur (fn.length === 4)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return (err: unknown, req, res, _next) => {
    const where = `${req.method} ${req.originalUrl}`;
    if (err instanceof HttpError) {
      if (!isRoutineDenial(err.status, err.code)) {
        log.warn(`${where} ${err.status} — ${err.code}`);
      }
      if (!res.headersSent) registry.sendError(res, err.status, err.code, err.params);
      return;
    }
    if (err instanceof ZodError) {
      log.warn(`${where} 400 — validation.invalid`);
      if (!res.headersSent) res.status(400).json({ error: zodToApiError(err) });
      return;
    }
    const bodyError = bodyParserError(err);
    if (bodyError) {
      log.warn(`${where} ${bodyError.status} — ${bodyError.code}`);
      if (!res.headersSent) registry.sendError(res, bodyError.status, bodyError.code);
      return;
    }
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.error(`${where} 500 — ${detail}`);
    if (!res.headersSent) registry.sendError(res, 500, 'common.internal');
  };
}
