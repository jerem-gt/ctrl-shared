import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  body,
  errorResponse,
  errorSchema,
  optionalBody,
  queryParams,
  rawBody,
  sessionCookieScheme,
} from './openapi.js';

describe('briques OpenAPI', () => {
  const schema = z.object({ name: z.string(), page: z.number().default(1) });

  it('décrit un corps JSON requis ou facultatif depuis un schéma Zod', () => {
    expect(body(schema)).toMatchObject({
      required: true,
      content: { 'application/json': { schema: { type: 'object' } } },
    });
    expect(optionalBody(schema).required).toBe(false);
  });

  it('décrit un corps brut par type de média', () => {
    expect(rawBody(['image/*']).content).toEqual({
      'image/*': { schema: { type: 'string', format: 'binary' } },
    });
  });

  it('tire les paramètres de requête du schéma d’entrée (défaut = facultatif)', () => {
    expect(queryParams(schema)).toEqual([
      { name: 'name', in: 'query', required: true, schema: { type: 'string' } },
      { name: 'page', in: 'query', required: false, schema: { type: 'number', default: 1 } },
    ]);
    expect(queryParams(z.string())).toEqual([]);
  });

  it('renvoie le corps d’erreur commun, codes du registre du projet', () => {
    const error = errorSchema(['common.internal', 'item.not_found']);

    expect(error.properties.error.properties.code.enum).toEqual([
      'common.internal',
      'item.not_found',
    ]);
    expect(errorResponse('Not found').content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/Error',
    });
  });

  it('nomme le cookie de session de l’appli', () => {
    expect(sessionCookieScheme('app.sid').sessionCookie).toMatchObject({
      type: 'apiKey',
      in: 'cookie',
      name: 'app.sid',
    });
  });
});
