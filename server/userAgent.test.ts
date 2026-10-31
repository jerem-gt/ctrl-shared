import { describe, expect, it } from 'vitest';

import { deviceLabel } from './userAgent.js';

const UA = {
  chromeWin:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  edgeWin:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  operaWin:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  safariIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
};

describe('deviceLabel', () => {
  it.each([
    [UA.chromeWin, 'Chrome · Windows'],
    [UA.edgeWin, 'Edge · Windows'],
    [UA.operaWin, 'Opera · Windows'],
    [UA.firefoxLinux, 'Firefox · Linux'],
    [UA.safariMac, 'Safari · macOS'],
    [UA.safariIos, 'Safari · iOS'],
    [UA.chromeAndroid, 'Chrome · Android'],
  ])('déduit le libellé de %s', (ua, expected) => {
    expect(deviceLabel(ua)).toBe(expected);
  });

  it("renvoie une chaîne vide si le User-Agent est absent ou n'est pas reconnu", () => {
    expect(deviceLabel()).toBe('');
    expect(deviceLabel('curl/8.0')).toBe('');
  });

  it("n'affiche que la partie reconnue", () => {
    expect(deviceLabel('Firefox/121.0')).toBe('Firefox');
    expect(deviceLabel('Windows NT 10.0')).toBe('Windows');
  });
});
