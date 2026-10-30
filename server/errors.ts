export type ErrorParams = Record<string, string | number>;

/** Erreur HTTP portant un code du registre du projet (`C`) et ses paramètres d'interpolation. */
export interface HttpErrorInstance<C extends string> extends Error {
  readonly status: number;
  readonly code: C;
  readonly params?: ErrorParams;
}

export interface HttpErrorClass<C extends string> {
  new (status: number, code: C, params?: ErrorParams): HttpErrorInstance<C>;
}

/** Erreur à statut fixe (400, 404, 409). */
export interface StatusErrorClass<C extends string> {
  new (code: C, params?: ErrorParams): HttpErrorInstance<C>;
}

export interface HttpErrors<C extends string> {
  HttpError: HttpErrorClass<C>;
  /** 400 — requête invalide (règle métier non respectée, valeur incohérente…). */
  BadRequestError: StatusErrorClass<C>;
  /** 404 — ressource introuvable (ou appartenant à un autre compte). */
  NotFoundError: StatusErrorClass<C>;
  /** 409 — conflit (doublon, état incompatible…). */
  ConflictError: StatusErrorClass<C>;
}

/**
 * Erreurs HTTP typées, levées par les services et les routes et traduites en réponse par le
 * gestionnaire d'erreur global du projet. `render` tire du code le message FR de repli.
 *
 * Le type de retour est explicite : l'instance d'une classe déclarée dans une fonction générique
 * serait sinon perdue (`any`) après un `instanceof`.
 *
 * Dans le projet (`lib/errors.ts`) :
 *   export const { HttpError, BadRequestError, NotFoundError, ConflictError } =
 *     createHttpErrors<ErrorCode>(renderMessage);
 *   export type HttpError = InstanceType<typeof HttpError>;
 */
export function createHttpErrors<C extends string>(
  render: (code: C, params?: ErrorParams) => string,
): HttpErrors<C> {
  class HttpError extends Error implements HttpErrorInstance<C> {
    constructor(
      public readonly status: number,
      public readonly code: C,
      public readonly params?: ErrorParams,
    ) {
      super(render(code, params));
      this.name = new.target.name;
    }
  }

  class BadRequestError extends HttpError {
    constructor(code: C, params?: ErrorParams) {
      super(400, code, params);
    }
  }

  class NotFoundError extends HttpError {
    constructor(code: C, params?: ErrorParams) {
      super(404, code, params);
    }
  }

  class ConflictError extends HttpError {
    constructor(code: C, params?: ErrorParams) {
      super(409, code, params);
    }
  }

  return { HttpError, BadRequestError, NotFoundError, ConflictError };
}
