import type { ErrorParams } from './errors.js';

/** Classe `HttpError` du projet (`createHttpErrors`) : elle accepte au moins `common.invalid_param`. */
export type InvalidParamErrorClass = new (
  status: number,
  code: 'common.invalid_param',
  params?: ErrorParams,
) => Error;

const POSITIVE_INT = /^[1-9]\d*$/;

/** Entier strictement positif écrit en chiffres seuls (ni signe, espace, zéro en tête ou exposant), sinon `null`. */
export function parsePositiveInt(raw: unknown): number | null {
  if (typeof raw !== 'string' || !POSITIVE_INT.test(raw)) {
    return null;
  }
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * `parseIdParam(req, nom = 'id')` : paramètre de route entier strictement positif, sinon 400
 * `common.invalid_param` avec `{ param: nom }`, levée avec la classe `HttpError` du projet.
 */
export function createIdParamParser(HttpError: InvalidParamErrorClass) {
  return (req: { params: Record<string, unknown> }, name = 'id'): number => {
    const value = parsePositiveInt(req.params[name]);
    if (value === null) {
      throw new HttpError(400, 'common.invalid_param', { param: name });
    }
    return value;
  };
}
