import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { sha256Hex } from './crypto.js';
import { createDeviceCookies, DEVICE_TTL_MS } from './deviceCookie.js';
import { createDevicesDb } from './testing/devicesDb.js';
import { createTrustedDevicesRepo } from './trustedDevices.js';

const NAME = 'testctrl_device';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

function setup(secure = false) {
  const devices = createTrustedDevicesRepo(createDevicesDb());
  const cookies = createDeviceCookies(devices, { name: NAME, secure });
  const app = express();
  app.post('/remember/:userId', (req, res) => {
    cookies.remember(req, res, Number(req.params.userId));
    res.status(204).end();
  });
  app.get('/trusted/:userId', (req, res) => {
    res.json({
      trusted: cookies.isTrusted(req, res, Number(req.params.userId)),
      belongs: cookies.belongsTo(req, Number(req.params.userId)),
    });
  });
  app.post('/clear', (req, res) => {
    cookies.clear(req, res);
    res.status(204).end();
  });
  return { app, devices };
}

/** Jeton posé par la réponse (en-tête `Set-Cookie`). */
function tokenOf(res: request.Response): string {
  const header = [res.headers['set-cookie'] ?? []].flat().find((c) => c.startsWith(`${NAME}=`));
  return header!.slice(NAME.length + 1).split(';')[0];
}

describe('createDeviceCookies', () => {
  it("pose un cookie HttpOnly, SameSite=Strict, limité à /api/auth, et n'en stocke que l'empreinte", async () => {
    const { app, devices } = setup();
    const res = await request(app).post('/remember/1').set('User-Agent', CHROME_ANDROID);
    const cookie = [res.headers['set-cookie']].flat()[0];
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api\/auth/);
    expect(cookie).toMatch(`Max-Age=${DEVICE_TTL_MS / 1000}`);
    expect(cookie).not.toMatch(/Secure/);
    const device = devices.getByHash(sha256Hex(tokenOf(res)));
    expect(device).toMatchObject({ user_id: 1, label: 'Chrome · Android' });
  });

  it("n'est Secure qu'en HTTPS, même avec l'option", async () => {
    const { app } = setup(true);
    const res = await request(app).post('/remember/1');
    expect([res.headers['set-cookie']].flat()[0]).not.toMatch(/Secure/);
    app.set('trust proxy', true);
    const https = await request(app).post('/remember/1').set('X-Forwarded-Proto', 'https');
    expect([https.headers['set-cookie']].flat()[0]).toMatch(/Secure/);
  });

  it("reconnaît l'appareil du compte et met à jour sa dernière utilisation", async () => {
    const { app, devices } = setup();
    const token = tokenOf(await request(app).post('/remember/1'));
    const before = devices.getByHash(sha256Hex(token))!.last_used_at;
    const res = await request(app).get('/trusted/1').set('Cookie', `${NAME}=${token}`);
    expect(res.body).toEqual({ trusted: true, belongs: true });
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(devices.getByHash(sha256Hex(token))!.last_used_at).toBeGreaterThanOrEqual(before);
  });

  it("garde le cookie d'un autre compte (navigateur partagé) sans le reconnaître", async () => {
    const { app } = setup();
    const token = tokenOf(await request(app).post('/remember/2'));
    const res = await request(app).get('/trusted/1').set('Cookie', `${NAME}=${token}`);
    expect(res.body).toEqual({ trusted: false, belongs: false });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('efface un cookie mort (appareil révoqué ou expiré)', async () => {
    const { app, devices } = setup();
    const token = tokenOf(await request(app).post('/remember/1'));
    devices.revokeAll(1);
    const res = await request(app).get('/trusted/1').set('Cookie', `${NAME}=${token}`);
    expect(res.body).toEqual({ trusted: false, belongs: false });
    expect([res.headers['set-cookie']].flat()[0]).toMatch(
      new RegExp(`^${NAME}=;.*Expires=Thu, 01 Jan 1970`),
    );
  });

  it('ne reconnaît rien sans cookie', async () => {
    const { app } = setup();
    const res = await request(app).get('/trusted/1');
    expect(res.body).toEqual({ trusted: false, belongs: false });
  });

  it("remplace l'appareil déjà porté par le cookie", async () => {
    const { app, devices } = setup();
    const first = tokenOf(await request(app).post('/remember/1'));
    const second = tokenOf(
      await request(app).post('/remember/1').set('Cookie', `${NAME}=${first}`),
    );
    expect(devices.getByHash(sha256Hex(first))).toBeUndefined();
    expect(devices.getByHash(sha256Hex(second))).toBeDefined();
    expect(devices.list(1, 0)).toHaveLength(1);
  });

  it('efface le cookie à la demande', async () => {
    const { app } = setup();
    const res = await request(app).post('/clear');
    expect([res.headers['set-cookie']].flat()[0]).toMatch(new RegExp(`^${NAME}=;.*Path=/api/auth`));
  });
});
