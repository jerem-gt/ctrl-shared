import { describe, expect, it } from 'vitest';

import { sha256Hex } from './crypto.js';

describe('sha256Hex', () => {
  it('retourne le SHA-256 hexadécimal', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
