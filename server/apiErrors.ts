import type { z } from 'zod';

import type { ErrorParams } from './errors.js';

/**
 * Codes d'erreur communs aux projets, avec leur message FR de repli. Chaque projet les étend avec
 * ses codes métier (`{ ...BASE_ERROR_MESSAGES, 'copy.not_found': '…' }`) ; le code partagé
 * (validation Zod, gestionnaire d'erreur) n'utilise que ceux-ci.
 */
export const BASE_ERROR_MESSAGES = {
  // ── Communs ───────────────────────────────────────────────────────────────
  'common.unauthorized': 'Non authentifié',
  'common.forbidden': 'Accès refusé',
  'common.invalid_request': 'Requête invalide',
  'common.invalid_param': 'Paramètre {{param}} invalide',
  'common.internal': 'Erreur interne du serveur.',
  'common.payload_too_large': 'Requête trop volumineuse',
  'common.unsupported_media_type': 'Type de contenu non pris en charge',

  // ── Validation (par champ) ────────────────────────────────────────────────
  'validation.invalid': 'Données invalides',
  'validation.required': 'Ce champ est requis',
  'validation.invalid_type': 'Type de valeur incorrect',
  'validation.too_small': 'La valeur doit être au moins {{minimum}}',
  'validation.too_big': 'La valeur ne doit pas dépasser {{maximum}}',
  'validation.too_short': 'Doit contenir au moins {{minimum}} caractère(s)',
  'validation.too_long': 'Doit contenir au plus {{maximum}} caractère(s)',
  'validation.invalid_format': 'Format invalide',
  'validation.invalid_value': 'Valeur non autorisée',
} as const;

export type BaseErrorCode = keyof typeof BASE_ERROR_MESSAGES;

export interface ApiErrorField<C extends string = string> {
  path: string;
  code: C;
  params?: ErrorParams;
  message: string;
}

/** Corps `{ error: … }` des réponses d'erreur : `code` traduit côté client, `message` en repli. */
export interface ApiErrorBody<C extends string = string> {
  code: C;
  message: string;
  params?: ErrorParams;
  fields?: ApiErrorField<C>[];
}

/** Ce dont `sendError` a besoin d'une réponse Express. */
export interface JsonResponse {
  status(code: number): { json(body: unknown): unknown };
}

export interface ErrorRegistry<C extends string> {
  /** Message FR d'un code, placeholders `{{param}}` interpolés (laissés tels quels si absents). */
  renderMessage(code: C, params?: ErrorParams): string;
  /** Corps d'erreur structuré ; `params` seulement s'il y en a. */
  buildError(code: C, params?: ErrorParams): ApiErrorBody<C>;
  /** Répond `{ error: { code, message, params? } }` avec ce statut. */
  sendError(res: JsonResponse, status: number, code: C, params?: ErrorParams): void;
}

function renderTemplate(template: string, params?: ErrorParams): string {
  if (!params) return template;
  return template.replaceAll(/\{\{(\w+)\}\}/g, (_match, key: string) =>
    key in params ? String(params[key]) : `{{${key}}}`,
  );
}

/**
 * Fonctions d'erreur sur le registre du projet, qui doit contenir les codes de base (garanti par
 * le typage). Dans le projet (`lib/errorCodes.ts`) :
 *   export const ERROR_MESSAGES = { ...BASE_ERROR_MESSAGES, …codes métier } as const;
 *   export type ErrorCode = keyof typeof ERROR_MESSAGES;
 *   export const { renderMessage, buildError, sendError } = createErrorRegistry(ERROR_MESSAGES);
 */
export function createErrorRegistry<C extends string>(
  messages: Readonly<Record<C | BaseErrorCode, string>>,
): ErrorRegistry<C | BaseErrorCode> {
  type Code = C | BaseErrorCode;
  const renderMessage = (code: Code, params?: ErrorParams): string =>
    renderTemplate(messages[code], params);
  const buildError = (code: Code, params?: ErrorParams): ApiErrorBody<Code> => ({
    code,
    message: renderMessage(code, params),
    ...(params ? { params } : {}),
  });
  const sendError = (res: JsonResponse, status: number, code: Code, params?: ErrorParams) => {
    res.status(status).json({ error: buildError(code, params) });
  };
  return { renderMessage, buildError, sendError };
}

/**
 * Champ absent : sans `reportInput`, Zod ne joint pas la valeur reçue (`issue.input` est toujours
 * indéfini) ; son message par défaut, qu'aucun schéma ne remplace, se termine par « received undefined ».
 */
function isMissing(issue: z.core.$ZodIssueInvalidType): boolean {
  return issue.message.endsWith('received undefined');
}

/** Mappe une issue Zod vers un code de validation traduisible + ses paramètres. */
function classifyIssue(issue: z.core.$ZodIssue): { code: BaseErrorCode; params?: ErrorParams } {
  switch (issue.code) {
    case 'invalid_type':
      return isMissing(issue)
        ? { code: 'validation.required' }
        : { code: 'validation.invalid_type' };
    case 'too_small': {
      const minimum = Number(issue.minimum);
      return issue.origin === 'string' || issue.origin === 'array'
        ? { code: 'validation.too_short', params: { minimum } }
        : { code: 'validation.too_small', params: { minimum } };
    }
    case 'too_big': {
      const maximum = Number(issue.maximum);
      return issue.origin === 'string' || issue.origin === 'array'
        ? { code: 'validation.too_long', params: { maximum } }
        : { code: 'validation.too_big', params: { maximum } };
    }
    case 'invalid_format':
      return { code: 'validation.invalid_format' };
    case 'invalid_value':
      return { code: 'validation.invalid_value' };
    default:
      return { code: 'validation.invalid' };
  }
}

const base = createErrorRegistry(BASE_ERROR_MESSAGES);

function mapZodIssue(issue: z.core.$ZodIssue): ApiErrorField<BaseErrorCode> {
  const path = issue.path.map(String).join('.') || '(root)';
  const { code, params } = classifyIssue(issue);
  return { path, code, ...(params ? { params } : {}), message: base.renderMessage(code, params) };
}

/** Corps d'erreur de validation : code générique + détail par champ. */
export function zodToApiError(error: z.ZodError): ApiErrorBody<BaseErrorCode> {
  return {
    code: 'validation.invalid',
    message: base.renderMessage('validation.invalid'),
    fields: error.issues.map(mapZodIssue),
  };
}
