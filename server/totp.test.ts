import * as OTPAuth from 'otpauth';
import { describe, expect, it } from 'vitest';

import { matchTotpStep, newTotpSecret } from './totp.js';

const PERIOD_MS = 30_000;
const NOW = 1_800_000_000_000;

const codeAt = (secret: string, timestamp: number) =>
  OTPAuth.TOTP.generate({ secret: OTPAuth.Secret.fromBase32(secret), timestamp });

describe('newTotpSecret', () => {
  it("donne un secret base32 et l'URI du QR code au nom de l'appli", () => {
    const { uri, secret } = newTotpSecret('ShelfCtrl', 'alice');
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(uri).toBe(
      `otpauth://totp/ShelfCtrl:alice?issuer=ShelfCtrl&secret=${secret}&algorithm=SHA1&digits=6&period=30`,
    );
  });

  it('tire un secret différent à chaque fois', () => {
    expect(newTotpSecret('CashCtrl', 'alice').secret).not.toBe(
      newTotpSecret('CashCtrl', 'alice').secret,
    );
  });
});

describe('matchTotpStep', () => {
  const { secret } = newTotpSecret('ShelfCtrl', 'alice');
  const step = Math.floor(NOW / PERIOD_MS);

  it('renvoie le pas du code courant', () => {
    expect(matchTotpStep(secret, codeAt(secret, NOW), NOW)).toBe(step);
  });

  it("tolère une période d'écart, et renvoie alors le pas du code", () => {
    expect(matchTotpStep(secret, codeAt(secret, NOW - PERIOD_MS), NOW)).toBe(step - 1);
    expect(matchTotpStep(secret, codeAt(secret, NOW + PERIOD_MS), NOW)).toBe(step + 1);
  });

  it('refuse un code trop ancien ou faux', () => {
    expect(matchTotpStep(secret, codeAt(secret, NOW - 2 * PERIOD_MS), NOW)).toBeNull();
    const wrong = codeAt(secret, NOW) === '000000' ? '111111' : '000000';
    expect(matchTotpStep(secret, wrong, NOW)).toBeNull();
  });

  it("prend l'heure courante par défaut", () => {
    expect(matchTotpStep(secret, codeAt(secret, Date.now()))).not.toBeNull();
  });
});
