import { describe, expect, it } from 'vitest';

import { createHttpErrors } from './errors.js';
import { createIdParamParser, parsePositiveInt } from './params.js';

describe('parsePositiveInt', () => {
  it.each([
    ['1', 1],
    ['42', 42],
    ['2026', 2026],
    [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
  ])('accepte %s', (raw, expected) => {
    expect(parsePositiveInt(raw)).toBe(expected);
  });

  it.each([
    '',
    '0',
    '-3',
    '+3',
    '012',
    '12abc',
    '1.5',
    '1e2',
    '0x10',
    ' 12',
    '12 ',
    '9007199254740993',
  ])('refuse « %s »', (raw) => {
    expect(parsePositiveInt(raw)).toBeNull();
  });

  it('refuse ce qui n’est pas une chaîne', () => {
    expect(parsePositiveInt(undefined)).toBeNull();
    expect(parsePositiveInt(12)).toBeNull();
    expect(parsePositiveInt(['12'])).toBeNull();
  });
});

describe('createIdParamParser', () => {
  const { HttpError } = createHttpErrors<'common.invalid_param'>(() => 'Paramètre invalide');
  const parseIdParam = createIdParamParser(HttpError);

  it('lit le paramètre id par défaut, ou celui nommé', () => {
    expect(parseIdParam({ params: { id: '7' } })).toBe(7);
    expect(parseIdParam({ params: { accountId: '12' } }, 'accountId')).toBe(12);
  });

  it('lève 400 common.invalid_param en nommant le paramètre', () => {
    const run = () => parseIdParam({ params: { loanId: '12abc' } }, 'loanId');
    expect(run).toThrow(HttpError);
    expect(run).toThrow(
      expect.objectContaining({
        status: 400,
        code: 'common.invalid_param',
        params: { param: 'loanId' },
      }),
    );
  });

  it('lève aussi pour un paramètre absent', () => {
    expect(() => parseIdParam({ params: {} })).toThrow(
      expect.objectContaining({ code: 'common.invalid_param', params: { param: 'id' } }),
    );
  });
});
