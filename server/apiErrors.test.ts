import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { BASE_ERROR_MESSAGES, createErrorRegistry, zodToApiError } from './apiErrors.js';

const registry = createErrorRegistry({
  ...BASE_ERROR_MESSAGES,
  'item.not_found': 'Introuvable',
  'item.too_many': 'Plus de {{max}} éléments',
});

describe('createErrorRegistry', () => {
  it('rend un message, avec ses paramètres, et laisse en place ceux qui manquent', () => {
    expect(registry.renderMessage('item.not_found')).toBe('Introuvable');
    expect(registry.renderMessage('item.too_many', { max: 3 })).toBe('Plus de 3 éléments');
    expect(registry.renderMessage('item.too_many', {})).toBe('Plus de {{max}} éléments');
    expect(registry.renderMessage('common.invalid_param', { param: 'id' })).toBe(
      'Paramètre id invalide',
    );
  });

  it("construit le corps d'erreur, params seulement s'il y en a", () => {
    expect(registry.buildError('item.not_found')).toEqual({
      code: 'item.not_found',
      message: 'Introuvable',
    });
    expect(registry.buildError('item.too_many', { max: 5 })).toEqual({
      code: 'item.too_many',
      message: 'Plus de 5 éléments',
      params: { max: 5 },
    });
  });

  it('envoie le corps avec le statut', () => {
    const json = vi.fn();
    const res = { status: vi.fn(() => ({ json })) };

    registry.sendError(res, 404, 'item.not_found');

    expect(res.status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      error: { code: 'item.not_found', message: 'Introuvable' },
    });
  });
});

const schema = z.object({
  name: z.string().min(2).max(5),
  count: z.number().int().min(1).max(10),
  tags: z.array(z.string()).max(1),
  email: z.email(),
  format: z.enum(['book', 'dvd']),
  nested: z.object({ flag: z.boolean() }),
});

function fieldsOf(input: unknown) {
  const result = schema.safeParse(input);
  if (result.success) {
    throw new Error('validation attendue en échec');
  }
  return zodToApiError(result.error).fields;
}

describe('zodToApiError', () => {
  it('classe chaque problème par champ, avec ses paramètres', () => {
    const fields = fieldsOf({
      name: 'a',
      count: 20,
      tags: ['a', 'b'],
      email: 'pas-un-e-mail',
      format: 'vhs',
      nested: { flag: 'oui' },
    });
    expect(fields).toEqual([
      {
        path: 'name',
        code: 'validation.too_short',
        params: { minimum: 2 },
        message: 'Doit contenir au moins 2 caractère(s)',
      },
      {
        path: 'count',
        code: 'validation.too_big',
        params: { maximum: 10 },
        message: 'La valeur ne doit pas dépasser 10',
      },
      {
        path: 'tags',
        code: 'validation.too_long',
        params: { maximum: 1 },
        message: 'Doit contenir au plus 1 caractère(s)',
      },
      { path: 'email', code: 'validation.invalid_format', message: 'Format invalide' },
      { path: 'format', code: 'validation.invalid_value', message: 'Valeur non autorisée' },
      { path: 'nested.flag', code: 'validation.invalid_type', message: 'Type de valeur incorrect' },
    ]);
  });

  it('distingue un champ manquant et une valeur trop petite', () => {
    const fields = fieldsOf({ name: 'abc', count: 0, tags: [], email: 'a@b.fr', format: 'book' });
    expect(fields).toEqual([
      {
        path: 'count',
        code: 'validation.too_small',
        params: { minimum: 1 },
        message: 'La valeur doit être au moins 1',
      },
      { path: 'nested', code: 'validation.required', message: 'Ce champ est requis' },
    ]);
  });

  it('rattache une erreur globale à (root) avec le code générique', () => {
    const result = z
      .string()
      .refine(() => false)
      .safeParse('x');
    expect(result.success).toBe(false);
    expect(zodToApiError((result as { error: z.ZodError }).error)).toEqual({
      code: 'validation.invalid',
      message: 'Données invalides',
      fields: [{ path: '(root)', code: 'validation.invalid', message: 'Données invalides' }],
    });
  });
});
