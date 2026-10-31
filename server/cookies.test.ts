import { describe, expect, it } from 'vitest';

import { readCookie } from './cookies.js';

describe('readCookie', () => {
  it('lit un cookie parmi plusieurs', () => {
    expect(readCookie('a=1; b=2; c=3', 'b')).toBe('2');
  });

  it('renvoie undefined sans en-tête ou si le cookie est absent', () => {
    expect(readCookie(undefined, 'a')).toBeUndefined();
    expect(readCookie('a=1', 'b')).toBeUndefined();
  });

  it('ne confond pas un nom avec un suffixe', () => {
    expect(readCookie('xa=1', 'a')).toBeUndefined();
  });

  it('décode les valeurs encodées et tolère un encodage invalide', () => {
    expect(readCookie('a=x%20y', 'a')).toBe('x y');
    expect(readCookie('a=%E0%A4%A', 'a')).toBe('%E0%A4%A');
  });

  it('ignore les fragments sans égal', () => {
    expect(readCookie('junk; a=1', 'a')).toBe('1');
  });
});
