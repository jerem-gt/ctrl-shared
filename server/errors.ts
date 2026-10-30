export type ErrorParams = Record<string, string | number>;

/**
 * Erreurs HTTP typées, levées par les services et les routes et traduites en réponse par le
 * gestionnaire d'erreur global du projet. Elles portent un `code` stable du registre du projet
 * (`C`) et des paramètres d'interpolation ; `render` en tire le message FR de repli.
 *
 * Dans le projet (`lib/errors.ts`) :
 *   export const { HttpError, BadRequestError, NotFoundError, ConflictError } =
 *     createHttpErrors<ErrorCode>(renderMessage);
 *   export type HttpError = InstanceType<typeof HttpError>;
 */
export function createHttpErrors<C extends string>(
  render: (code: C, params?: ErrorParams) => string,
) {
  class HttpError extends Error {
    constructor(
      public readonly status: number,
      public readonly code: C,
      public readonly params?: ErrorParams,
    ) {
      super(render(code, params));
      this.name = new.target.name;
    }
  }

  /** 400 — requête invalide (règle métier non respectée, valeur incohérente…). */
  class BadRequestError extends HttpError {
    constructor(code: C, params?: ErrorParams) {
      super(400, code, params);
    }
  }

  /** 404 — ressource introuvable (ou appartenant à un autre compte). */
  class NotFoundError extends HttpError {
    constructor(code: C, params?: ErrorParams) {
      super(404, code, params);
    }
  }

  /** 409 — conflit (doublon, état incompatible…). */
  class ConflictError extends HttpError {
    constructor(code: C, params?: ErrorParams) {
      super(409, code, params);
    }
  }

  return { HttpError, BadRequestError, NotFoundError, ConflictError };
}
