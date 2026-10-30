import { describe, expect, it } from 'vitest';

import { createHttpErrors } from './errors.js';

type Code = 'item.not_found' | 'item.duplicate' | 'item.too_many';

const MESSAGES: Record<Code, string> = {
  'item.not_found': 'Introuvable',
  'item.duplicate': 'Déjà présent',
  'item.too_many': 'Plus de {{max}}',
};

const { HttpError, BadRequestError, NotFoundError, ConflictError } = createHttpErrors<Code>(
  (code, params) => MESSAGES[code].replace('{{max}}', String(params?.max ?? '')),
);

describe('createHttpErrors', () => {
  it('donne à chaque classe son statut, son code et son message rendu', () => {
    const error = new BadRequestError('item.too_many', { max: 3 });

    expect(error).toBeInstanceOf(HttpError);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ status: 400, code: 'item.too_many', params: { max: 3 } });
    expect(error.message).toBe('Plus de 3');
    expect(error.name).toBe('BadRequestError');
  });

  it.each([
    [new NotFoundError('item.not_found'), 404, 'NotFoundError'],
    [new ConflictError('item.duplicate'), 409, 'ConflictError'],
    [new HttpError(429, 'item.too_many', { max: 1 }), 429, 'HttpError'],
  ])('%s', (error, status, name) => {
    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(status);
    expect(error.name).toBe(name);
  });

  it('isole les classes de deux registres', () => {
    const other = createHttpErrors<Code>(() => 'autre');
    expect(new other.NotFoundError('item.not_found')).not.toBeInstanceOf(HttpError);
  });
});
