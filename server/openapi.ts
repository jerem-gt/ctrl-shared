import type { ZodType } from 'zod';
import { toJSONSchema } from 'zod';

/**
 * Briques des specs OpenAPI 3.1 des projets (Swagger UI sur `/api/docs`) : corps et paramètres
 * générés depuis les schémas Zod des routes, réponses usuelles, corps d'erreur commun
 * (`{ error: { code, message, params?, fields? } }`, cf. `apiErrors`) et session par cookie.
 */

// Un type que JSON Schema ne sait pas représenter (date, transformation…) devient « any ».
const TO_JSON_OPTS = { unrepresentable: 'any' } as const;

export function jsonSchema(zod: ZodType) {
  return toJSONSchema(zod, TO_JSON_OPTS);
}

/** Corps JSON requis, validé par `zod`. */
export function body(zod: ZodType) {
  return {
    required: true,
    content: { 'application/json': { schema: jsonSchema(zod) } },
  };
}

/** Corps JSON facultatif (valeurs par défaut côté serveur). */
export function optionalBody(zod: ZodType) {
  return { ...body(zod), required: false };
}

/** Corps brut (fichier envoyé tel quel), comme `express.raw`. */
export function rawBody(mediaTypes: readonly string[]) {
  return {
    required: true,
    content: Object.fromEntries(
      mediaTypes.map((type) => [type, { schema: { type: 'string', format: 'binary' } }]),
    ),
  };
}

/**
 * Propriétés d'un schéma Zod objet en paramètres de requête. Schéma d'entrée (`io: 'input'`) :
 * un champ qui a une valeur par défaut reste facultatif pour le client.
 */
export function queryParams(zod: ZodType) {
  const js = toJSONSchema(zod, { ...TO_JSON_OPTS, io: 'input' }) as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  if (!js.properties) return [];
  return Object.entries(js.properties).map(([name, propSchema]) => ({
    name,
    in: 'query',
    required: (js.required ?? []).includes(name),
    schema: propSchema,
  }));
}

/** Paramètre de chemin entier (`{id}`, `{accountId}`…). */
export function pathInt(name: string) {
  return { name, in: 'path', required: true, schema: { type: 'integer' } };
}

export const pId = [pathInt('id')];

/** Réponse d'erreur au corps commun (`components.schemas.Error`, cf. `errorSchema`). */
export function errorResponse(description: string) {
  return {
    description,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  };
}

export const r200 = (description = 'OK') => ({ 200: { description } });
export const r201 = { 201: { description: 'Created' } };
export const r202 = { 202: { description: 'Accepted' } };
export const r204 = { 204: { description: 'No Content' } };
export const r400 = { 400: errorResponse('Validation error') };
export const r401 = { 401: errorResponse('Unauthorized') };
export const r403 = { 403: errorResponse('Forbidden (admin only)') };
export const r404 = { 404: errorResponse('Not found') };
export const r409 = { 409: errorResponse('Conflict') };
export const r429 = { 429: errorResponse('Too many failures') };

/** Opération protégée par la session (`sessionCookieScheme`). */
export const sessionAuth = [{ sessionCookie: [] }];

/** `components.securitySchemes` : cookie de session posé par `POST /api/auth/login`. */
export function sessionCookieScheme(cookieName: string) {
  return {
    sessionCookie: {
      type: 'apiKey',
      in: 'cookie',
      name: cookieName,
      description: 'Cookie de session posé par POST /api/auth/login.',
    },
  };
}

/** `components.schemas.Error` : corps d'erreur, `codes` = clés du registre du projet. */
export function errorSchema(codes: readonly string[]) {
  const params = { type: 'object', additionalProperties: { type: ['string', 'number'] } };
  return {
    type: 'object',
    required: ['error'],
    properties: {
      error: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: { type: 'string', enum: codes },
          message: { type: 'string', description: 'Message FR de repli' },
          params,
          fields: {
            type: 'array',
            description: 'Détail par champ (validation)',
            items: {
              type: 'object',
              required: ['path', 'code', 'message'],
              properties: {
                path: { type: 'string' },
                code: { type: 'string', enum: codes },
                message: { type: 'string' },
                params,
              },
            },
          },
        },
      },
    },
  };
}
