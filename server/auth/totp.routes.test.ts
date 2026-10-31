import { sha256Hex as sha256 } from '../crypto.js';
import * as OTPAuth from 'otpauth';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAuthApp } from '../testing/authApp.js';
import { addTestUser } from '../testing/authApp.js';

const PASSWORD = 'password';
const DAY = 24 * 60 * 60 * 1000;
const UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0';

type Name = 'alice' | 'bob' | 'root';

const totpCode = (secret: string, timestamp = Date.now()) =>
  OTPAuth.TOTP.generate({ secret: OTPAuth.Secret.fromBase32(secret), timestamp });

const setCookies = (res: request.Response) =>
  (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
const deviceSetCookie = (res: request.Response) =>
  setCookies(res).find((cookie) => cookie.startsWith('testctrl_device='));
/** Valeur brute `testctrl_device=<jeton>` d'un Set-Cookie. */
function deviceCookieValue(res: request.Response): string {
  const header = deviceSetCookie(res);
  if (!header) {
    throw new Error('cookie appareil absent');
  }
  return header.split(';')[0];
}

afterEach(() => {
  vi.useRealTimers();
});

/** Trois comptes à la 2FA active (root admin), avec les aides de connexion en deux temps. */
function setup(options: { secureCookies?: boolean } = {}) {
  const ctx = createAuthApp(options);
  const { db, app } = ctx;
  const secrets = {} as Record<Name, string>;
  const ids = {} as Record<Name, number>;
  for (const [name, isAdmin] of [
    ['alice', false],
    ['bob', false],
    ['root', true],
  ] as const) {
    secrets[name] = new OTPAuth.Secret().base32;
    ids[name] = addTestUser(db, name, { isAdmin, totpSecret: secrets[name] });
  }

  /** Code courant ; le dernier pas accepté est oublié, pour se reconnecter dans le même test. */
  const codeFor = (name: Name) => {
    db.prepare('UPDATE users SET totp_last_step = NULL WHERE id = ?').run(ids[name]);
    return totpCode(secrets[name]);
  };

  const login = (name: Name, cookie?: string) => {
    const req = request(app).post('/api/auth/login');
    return (cookie ? req.set('Cookie', cookie) : req).send({ username: name, password: PASSWORD });
  };

  /** Connexion avec « se souvenir », éventuellement depuis un navigateur portant déjà un cookie. */
  const trustDevice = async (name: Name, previousCookie?: string) => {
    const agent = request.agent(app);
    const withCookie = (req: request.Test) =>
      previousCookie ? req.set('Cookie', previousCookie) : req;
    await withCookie(agent.post('/api/auth/login').set('User-Agent', UA)).send({
      username: name,
      password: PASSWORD,
    });
    const res = await withCookie(agent.post('/api/auth/2fa/verify').set('User-Agent', UA)).send({
      code: codeFor(name),
      remember: true,
    });
    expect(res.status).toBe(200);
    return deviceCookieValue(res);
  };

  /** Agent connecté (2FA franchie, rien de mémorisé), qui envoie éventuellement un cookie d'appareil. */
  const sessionAgent = async (name: Name, deviceCookie?: string) => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ username: name, password: PASSWORD });
    const res = await agent.post('/api/auth/2fa/verify').send({ code: codeFor(name) });
    expect(res.status).toBe(200);
    const withCookie = (req: request.Test) =>
      deviceCookie ? req.set('Cookie', deviceCookie) : req;
    return {
      agent,
      get: (url: string) => withCookie(agent.get(url)),
      del: (url: string) => withCookie(agent.delete(url)),
    };
  };

  const deviceCount = (name?: Name): number => {
    const row =
      name === undefined
        ? db.prepare('SELECT COUNT(*) AS n FROM trusted_devices').get()
        : db.prepare('SELECT COUNT(*) AS n FROM trusted_devices WHERE user_id = ?').get(ids[name]);
    return (row as { n: number }).n;
  };

  const insertDevice = (name: Name, tokenHash: string, expiresAt: number) =>
    db
      .prepare(
        `INSERT INTO trusted_devices (user_id, token_hash, label, created_at, last_used_at, expires_at)
         VALUES (?, ?, 'x', 1, 1, ?)`,
      )
      .run(ids[name], tokenHash, expiresAt);

  return {
    ...ctx,
    secrets,
    ids,
    codeFor,
    login,
    trustDevice,
    sessionAgent,
    deviceCount,
    insertDevice,
  };
}

describe('connexion en deux temps', () => {
  it('demande le code après le mot de passe, sans ouvrir de session', async () => {
    const { app } = setup();
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/login').send({ username: 'alice', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ totpRequired: true });
    expect((await agent.get('/api/items')).status).toBe(401);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('ouvre la session avec le bon code', async () => {
    const { app, ids, codeFor } = setup();
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ username: 'alice', password: PASSWORD });
    const res = await agent.post('/api/auth/2fa/verify').send({ code: codeFor('alice') });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: ids.alice,
      username: 'alice',
      email: null,
      isAdmin: false,
      totpEnabled: true,
    });
    expect((await agent.get('/api/items')).status).toBe(200);
  });

  it('change d’identifiant de session après le code (anti-fixation)', async () => {
    const { app, codeFor } = setup();
    const agent = request.agent(app);
    const sid = (res: request.Response) =>
      setCookies(res)
        .find((cookie) => cookie.startsWith('testctrl.sid='))
        ?.split(';')[0];
    const pending = await agent
      .post('/api/auth/login')
      .send({ username: 'alice', password: PASSWORD });
    const opened = await agent.post('/api/auth/2fa/verify').send({ code: codeFor('alice') });
    expect(sid(opened)).toBeDefined();
    expect(sid(opened)).not.toBe(sid(pending));
  });

  it('refuse un code faux', async () => {
    const { app, secrets } = setup();
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ username: 'alice', password: PASSWORD });
    const wrong = totpCode(secrets.alice) === '000000' ? '111111' : '000000';
    const res = await agent.post('/api/auth/2fa/verify').send({ code: wrong });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('auth.totp_invalid');
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('refuse un code déjà utilisé (anti-rejeu)', async () => {
    const { app, secrets } = setup();
    const code = totpCode(secrets.alice);
    const first = request.agent(app);
    await first.post('/api/auth/login').send({ username: 'alice', password: PASSWORD });
    expect((await first.post('/api/auth/2fa/verify').send({ code })).status).toBe(200);

    const second = request.agent(app);
    await second.post('/api/auth/login').send({ username: 'alice', password: PASSWORD });
    const res = await second.post('/api/auth/2fa/verify').send({ code });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('auth.totp_invalid');
  });

  it('accepte le code suivant après un code utilisé', async () => {
    const { app, secrets } = setup();
    const first = request.agent(app);
    await first.post('/api/auth/login').send({ username: 'alice', password: PASSWORD });
    await first.post('/api/auth/2fa/verify').send({ code: totpCode(secrets.alice) });

    const second = request.agent(app);
    await second.post('/api/auth/login').send({ username: 'alice', password: PASSWORD });
    const next = totpCode(secrets.alice, Date.now() + 30_000);
    expect((await second.post('/api/auth/2fa/verify').send({ code: next })).status).toBe(200);
  });

  it('refuse le code sans mot de passe vérifié', async () => {
    const { app, codeFor } = setup();
    const res = await request(app)
      .post('/api/auth/2fa/verify')
      .send({ code: codeFor('alice') });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('auth.totp_token_invalid');
  });

  it('refuse le code au-delà de 5 minutes', async () => {
    const { app, codeFor } = setup();
    vi.useFakeTimers({ toFake: ['Date'] });
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ username: 'alice', password: PASSWORD });
    vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1);
    const res = await agent.post('/api/auth/2fa/verify').send({ code: codeFor('alice') });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('auth.totp_token_invalid');
  });

  it('refuse le code si la 2FA a été désactivée entre-temps', async () => {
    const { app, db, ids, codeFor } = setup();
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ username: 'alice', password: PASSWORD });
    const code = codeFor('alice');
    db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(ids.alice);
    const res = await agent.post('/api/auth/2fa/verify').send({ code });
    expect(res.body.error.code).toBe('auth.totp_token_invalid');
  });

  it('régénère la session : une connexion précédente ne survit pas à l’attente du code', async () => {
    const { app, db } = setup();
    addTestUser(db, 'carol');
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ username: 'carol', password: PASSWORD });
    expect((await agent.get('/api/auth/me')).body.username).toBe('carol');

    const res = await agent.post('/api/auth/login').send({ username: 'alice', password: PASSWORD });
    expect(res.body).toEqual({ totpRequired: true });
    expect((await agent.get('/api/auth/me')).status).toBe(401);
    expect((await agent.get('/api/items')).status).toBe(401);
  });

  it('rejette un code mal formé', async () => {
    const { app } = setup();
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ username: 'alice', password: PASSWORD });
    const res = await agent.post('/api/auth/2fa/verify').send({ code: '123' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation.invalid');
  });

  it('ne demande pas de code à un compte sans 2FA', async () => {
    const { app, db } = setup();
    addTestUser(db, 'carol');
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'carol', password: PASSWORD });
    expect(res.body).toMatchObject({ username: 'carol', totpEnabled: false });
  });
});

describe('limitation des codes', () => {
  /** Adresse de client n° `n`, vue derrière le proxy (`trust proxy`). */
  const clientIp = (n: number) => `10.0.0.${n}`;

  /** Échecs de code, chacun après un mot de passe juste, depuis l'adresse `ipOf(i)`. */
  async function failCodes(
    app: ReturnType<typeof setup>['app'],
    count: number,
    ipOf: (i: number) => string,
  ) {
    for (let i = 0; i < count; i += 1) {
      const agent = request.agent(app);
      const from = ipOf(i);
      await agent
        .post('/api/auth/login')
        .set('X-Forwarded-For', from)
        .send({ username: 'alice', password: PASSWORD });
      await agent
        .post('/api/auth/2fa/verify')
        .set('X-Forwarded-For', from)
        .send({ code: 'abcdef' });
    }
  }

  async function verifyFrom(ctx: ReturnType<typeof setup>, ip: string) {
    const agent = request.agent(ctx.app);
    await agent
      .post('/api/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ username: 'alice', password: PASSWORD });
    return agent
      .post('/api/auth/2fa/verify')
      .set('X-Forwarded-For', ip)
      .send({ code: ctx.codeFor('alice') });
  }

  it('bloque une adresse après 10 codes faux', async () => {
    const ctx = setup();
    ctx.app.set('trust proxy', true);
    await failCodes(ctx.app, 10, () => clientIp(1));
    const res = await request(ctx.app)
      .post('/api/auth/2fa/verify')
      .set('X-Forwarded-For', clientIp(1))
      .send({ code: ctx.codeFor('alice') });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('auth.too_many_attempts');
  });

  it('bloque le compte après 10 codes faux, même depuis des adresses différentes', async () => {
    const ctx = setup();
    ctx.app.set('trust proxy', true);
    await failCodes(ctx.app, 10, (i) => clientIp(10 + i));
    const res = await verifyFrom(ctx, clientIp(99));
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('auth.too_many_attempts');
  });

  it('les codes faux épuisent aussi le quota de connexion de l’adresse', async () => {
    const ctx = setup();
    ctx.app.set('trust proxy', true);
    await failCodes(ctx.app, 10, () => clientIp(1));
    const res = await request(ctx.app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', clientIp(1))
      .send({ username: 'bob', password: PASSWORD });
    expect(res.status).toBe(429);
  });

  it('remet les compteurs à zéro après un bon code', async () => {
    const ctx = setup();
    ctx.app.set('trust proxy', true);
    await failCodes(ctx.app, 9, () => clientIp(1));
    expect((await verifyFrom(ctx, clientIp(1))).status).toBe(200);
    await failCodes(ctx.app, 9, () => clientIp(1));
    expect((await verifyFrom(ctx, clientIp(1))).status).toBe(200);
  });
});

describe('activation et désactivation', () => {
  async function plainAgent(ctx: ReturnType<typeof setup>) {
    addTestUser(ctx.db, 'carol');
    const agent = request.agent(ctx.app);
    await agent.post('/api/auth/login').send({ username: 'carol', password: PASSWORD });
    return agent;
  }

  it('exige une session', async () => {
    const { app } = setup();
    for (const path of ['/api/auth/2fa/setup', '/api/auth/2fa/enable', '/api/auth/2fa/disable']) {
      expect((await request(app).post(path).send({})).status).toBe(401);
    }
  });

  it('active la 2FA avec le secret proposé et un premier code', async () => {
    const ctx = setup();
    const agent = await plainAgent(ctx);
    const setupRes = await agent.post('/api/auth/2fa/setup');
    expect(setupRes.status).toBe(200);
    expect(setupRes.body.uri).toContain('otpauth://totp/TestCtrl:carol?');
    const { secret } = setupRes.body as { secret: string };

    const res = await agent.post('/api/auth/2fa/enable').send({ code: totpCode(secret) });
    expect(res.status).toBe(204);
    expect((await agent.get('/api/auth/me')).body.totpEnabled).toBe(true);
    expect(
      (
        await request(ctx.app)
          .post('/api/auth/login')
          .send({ username: 'carol', password: PASSWORD })
      ).body,
    ).toEqual({ totpRequired: true });
  });

  it('ignore un secret envoyé par le client : seul celui de la session compte', async () => {
    const ctx = setup();
    const agent = await plainAgent(ctx);
    await agent.post('/api/auth/2fa/setup');
    const own = new OTPAuth.Secret().base32;
    // Le code d'un autre secret ne vaut rien (sauf collision improbable de 6 chiffres).
    const res = await agent.post('/api/auth/2fa/enable').send({ secret: own, code: totpCode(own) });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('auth.totp_invalid');
  });

  it('refuse l’activation sans secret proposé', async () => {
    const ctx = setup();
    const agent = await plainAgent(ctx);
    const res = await agent.post('/api/auth/2fa/enable').send({ code: '123456' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('auth.totp_setup_expired');
  });

  it('ne réutilise pas le secret une fois la 2FA activée', async () => {
    const ctx = setup();
    const agent = await plainAgent(ctx);
    const { secret } = (await agent.post('/api/auth/2fa/setup')).body as { secret: string };
    await agent.post('/api/auth/2fa/enable').send({ code: totpCode(secret) });
    ctx.db.prepare("UPDATE users SET totp_enabled = 0 WHERE username = 'carol'").run();
    const res = await agent
      .post('/api/auth/2fa/enable')
      .send({ code: totpCode(secret, Date.now() + 30_000) });
    expect(res.body.error.code).toBe('auth.totp_setup_expired');
  });

  it('le code de confirmation ne sert pas à se connecter', async () => {
    const ctx = setup();
    const agent = await plainAgent(ctx);
    const { secret } = (await agent.post('/api/auth/2fa/setup')).body as { secret: string };
    const code = totpCode(secret);
    await agent.post('/api/auth/2fa/enable').send({ code });

    const other = request.agent(ctx.app);
    await other.post('/api/auth/login').send({ username: 'carol', password: PASSWORD });
    const res = await other.post('/api/auth/2fa/verify').send({ code });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('auth.totp_invalid');
  });

  it('refuse un code faux à l’activation', async () => {
    const ctx = setup();
    const agent = await plainAgent(ctx);
    const { secret } = (await agent.post('/api/auth/2fa/setup')).body as { secret: string };
    const wrong = totpCode(secret) === '000000' ? '111111' : '000000';
    const res = await agent.post('/api/auth/2fa/enable').send({ code: wrong });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('auth.totp_invalid');
  });

  it('refuse de proposer ou d’activer une 2FA déjà active', async () => {
    const { sessionAgent } = setup();
    const { agent } = await sessionAgent('alice');
    const setupRes = await agent.post('/api/auth/2fa/setup');
    expect(setupRes.status).toBe(409);
    expect(setupRes.body.error.code).toBe('auth.totp_already_enabled');
    const enable = await agent.post('/api/auth/2fa/enable').send({ code: '123456' });
    expect(enable.body.error.code).toBe('auth.totp_already_enabled');
  });

  it('désactive la 2FA avec le mot de passe actuel', async () => {
    const { app, sessionAgent } = setup();
    const { agent } = await sessionAgent('alice');
    const res = await agent.post('/api/auth/2fa/disable').send({ password: PASSWORD });
    expect(res.status).toBe(204);
    expect((await agent.get('/api/auth/me')).body.totpEnabled).toBe(false);
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password: PASSWORD });
    expect(login.body).toMatchObject({ username: 'alice', totpEnabled: false });
  });

  it('refuse la désactivation avec un mauvais mot de passe', async () => {
    const { sessionAgent } = setup();
    const { agent } = await sessionAgent('alice');
    const res = await agent.post('/api/auth/2fa/disable').send({ password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('auth.current_password_incorrect');
    expect((await agent.get('/api/auth/me')).body.totpEnabled).toBe(true);
  });

  it('refuse de désactiver une 2FA inactive', async () => {
    const ctx = setup();
    const agent = await plainAgent(ctx);
    const res = await agent.post('/api/auth/2fa/disable').send({ password: PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('auth.totp_not_enabled');
  });
});

describe('POST /api/auth/2fa/verify (se souvenir)', () => {
  it('ne mémorise rien par défaut', async () => {
    const { app, codeFor, deviceCount } = setup();
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ username: 'alice', password: PASSWORD });
    const res = await agent
      .post('/api/auth/2fa/verify')
      .send({ code: codeFor('alice'), remember: false });
    expect(res.status).toBe(200);
    expect(deviceSetCookie(res)).toBeUndefined();
    expect(deviceCount()).toBe(0);
  });

  it("pose le cookie d'appareil avec les bons attributs et ne stocke que l'empreinte", async () => {
    const { app, db, ids, codeFor } = setup();
    const agent = request.agent(app);
    await agent
      .post('/api/auth/login')
      .set('User-Agent', UA)
      .send({ username: 'alice', password: PASSWORD });
    const res = await agent
      .post('/api/auth/2fa/verify')
      .set('User-Agent', UA)
      .send({ code: codeFor('alice'), remember: true });
    const header = deviceSetCookie(res) as string;
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Strict');
    expect(header).toContain('Path=/api/auth');
    expect(header).toContain(`Max-Age=${30 * 24 * 60 * 60}`);
    expect(header).not.toContain('Secure');

    const token = decodeURIComponent(header.split(';')[0].split('=')[1]);
    expect(token).toMatch(/^[\w-]{43}$/);
    const row = db.prepare('SELECT * FROM trusted_devices').get() as {
      token_hash: string;
      label: string;
      user_id: number;
      created_at: number;
      expires_at: number;
    };
    expect(row.token_hash).toBe(sha256(token));
    expect(row.label).toBe('Firefox · Linux');
    expect(row.user_id).toBe(ids.alice);
    expect(row.expires_at - row.created_at).toBe(30 * DAY);
  });

  it('ajoute Secure quand secureCookies est actif et la requête en HTTPS', async () => {
    const { app, codeFor } = setup({ secureCookies: true });
    app.set('trust proxy', 1);
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ username: 'alice', password: PASSWORD });
    const res = await agent
      .post('/api/auth/2fa/verify')
      .set('X-Forwarded-Proto', 'https')
      .send({ code: codeFor('alice'), remember: true });
    expect(deviceSetCookie(res)).toContain('Secure');
  });

  it("n'ajoute pas Secure en HTTP même avec secureCookies, comme le cookie de session", async () => {
    const { app, codeFor } = setup({ secureCookies: true });
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ username: 'alice', password: PASSWORD });
    const res = await agent
      .post('/api/auth/2fa/verify')
      .send({ code: codeFor('alice'), remember: true });
    expect(deviceSetCookie(res)).not.toContain('Secure');
  });

  it('ne mémorise pas si le code est invalide', async () => {
    const { app, deviceCount } = setup();
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ username: 'alice', password: PASSWORD });
    const res = await agent.post('/api/auth/2fa/verify').send({ code: 'abcdef', remember: true });
    expect(res.status).toBe(401);
    expect(deviceSetCookie(res)).toBeUndefined();
    expect(deviceCount()).toBe(0);
  });

  it("remplace l'appareil déjà porté par le cookie, même d'un autre compte", async () => {
    const { trustDevice, deviceCount } = setup();
    const bobCookie = await trustDevice('bob');
    expect(deviceCount('bob')).toBe(1);

    const aliceCookie = await trustDevice('alice', bobCookie);
    expect(aliceCookie).not.toBe(bobCookie);
    expect(deviceCount('bob')).toBe(0);
    expect(deviceCount('alice')).toBe(1);
  });

  it('purge les appareils expirés à la création', async () => {
    const { trustDevice, deviceCount, insertDevice } = setup();
    insertDevice('bob', 'old', Date.now() - 1000);
    await trustDevice('alice');
    expect(deviceCount('bob')).toBe(0);
  });
});

describe('POST /api/auth/login avec appareil mémorisé', () => {
  it('ouvre la session sans code et met à jour la dernière utilisation', async () => {
    const { db, login, trustDevice } = setup();
    const cookie = await trustDevice('alice');
    db.prepare('UPDATE trusted_devices SET last_used_at = 1').run();

    const res = await login('alice', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ username: 'alice', totpEnabled: true });
    const row = db.prepare('SELECT last_used_at FROM trusted_devices').get() as {
      last_used_at: number;
    };
    expect(row.last_used_at).toBeGreaterThan(1);
  });

  it('remet à zéro le compteur du limiteur', async () => {
    const { app, login, trustDevice } = setup();
    const cookie = await trustDevice('alice');
    const fail = async (count: number) => {
      for (let i = 0; i < count; i += 1) {
        await request(app).post('/api/auth/login').send({ username: 'alice', password: 'wrong' });
      }
    };
    await fail(9);
    expect((await login('alice', cookie)).status).toBe(200);
    await fail(9);
    expect((await login('alice', cookie)).status).toBe(200);
  });

  it('garde le mot de passe obligatoire', async () => {
    const { app, trustDevice } = setup();
    const cookie = await trustDevice('alice');
    const res = await request(app)
      .post('/api/auth/login')
      .set('Cookie', cookie)
      .send({ username: 'alice', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('demande le code et efface le cookie si l’appareil est expiré', async () => {
    const { db, login, trustDevice, deviceCount } = setup();
    const cookie = await trustDevice('alice');
    db.prepare('UPDATE trusted_devices SET expires_at = ?').run(Date.now() - 1);

    const res = await login('alice', cookie);
    expect(res.body).toEqual({ totpRequired: true });
    const cleared = deviceSetCookie(res) as string;
    expect(cleared).toContain('testctrl_device=;');
    expect(cleared).toContain('Path=/api/auth');
    expect(deviceCount()).toBe(0);
  });

  it('demande le code et efface le cookie si l’appareil est révoqué', async () => {
    const { db, login, trustDevice } = setup();
    const cookie = await trustDevice('alice');
    db.prepare('DELETE FROM trusted_devices').run();

    const res = await login('alice', cookie);
    expect(res.body).toEqual({ totpRequired: true });
    expect(deviceSetCookie(res)).toContain('testctrl_device=;');
  });

  it('demande le code et efface un cookie inconnu', async () => {
    const { login } = setup();
    const res = await login('alice', 'testctrl_device=garbage');
    expect(res.body).toEqual({ totpRequired: true });
    expect(deviceSetCookie(res)).toContain('testctrl_device=;');
  });

  it('demande le code sans effacer ni supprimer l’appareil d’un autre compte', async () => {
    const { login, trustDevice, deviceCount } = setup();
    const bobCookie = await trustDevice('bob');

    const res = await login('alice', bobCookie);
    expect(res.body).toEqual({ totpRequired: true });
    expect(deviceSetCookie(res)).toBeUndefined();
    expect(deviceCount('bob')).toBe(1);
    expect((await login('bob', bobCookie)).body.totpRequired).toBeUndefined();
  });

  it('ne touche ni appareils ni cookie à la déconnexion', async () => {
    const { app, trustDevice, deviceCount } = setup();
    const cookie = await trustDevice('alice');
    const res = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect(res.status).toBe(204);
    expect(deviceSetCookie(res)).toBeUndefined();
    expect(deviceCount('alice')).toBe(1);
  });
});

describe('routes /api/auth/devices', () => {
  it('exige une session', async () => {
    const { app } = setup();
    expect((await request(app).get('/api/auth/devices')).status).toBe(401);
    expect((await request(app).delete('/api/auth/devices')).status).toBe(401);
    expect((await request(app).delete('/api/auth/devices/1')).status).toBe(401);
  });

  it('liste les appareils non expirés du compte, le dernier utilisé d’abord', async () => {
    const { db, trustDevice, sessionAgent, insertDevice } = setup();
    const other = await trustDevice('alice');
    const current = await trustDevice('alice');
    await trustDevice('bob');
    insertDevice('alice', 'expired', Date.now() - 1000);
    db.prepare('UPDATE trusted_devices SET last_used_at = 5 WHERE token_hash = ?').run(
      sha256(decodeURIComponent(other.split('=')[1])),
    );

    const session = await sessionAgent('alice', current);
    const res = await session.get('/api/auth/devices');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0]).toEqual({
      id: expect.any(Number),
      label: 'Firefox · Linux',
      createdAt: expect.any(Number),
      lastUsedAt: expect.any(Number),
      expiresAt: expect.any(Number),
      current: true,
    });
    expect(res.body.items[1]).toMatchObject({ current: false, lastUsedAt: 5 });
  });

  it('current est faux sans cookie correspondant', async () => {
    const { trustDevice, sessionAgent } = setup();
    await trustDevice('alice');
    const session = await sessionAgent('alice');
    const res = await session.get('/api/auth/devices');
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].current).toBe(false);
  });

  it('oublie un appareil du compte sans effacer le cookie si ce n’est pas le courant', async () => {
    const { db, login, trustDevice, sessionAgent, deviceCount } = setup();
    const cookie = await trustDevice('alice');
    const session = await sessionAgent('alice');
    const { id } = db.prepare('SELECT id FROM trusted_devices').get() as { id: number };
    const res = await session.del(`/api/auth/devices/${id}`);
    expect(res.status).toBe(204);
    expect(deviceSetCookie(res)).toBeUndefined();
    expect(deviceCount()).toBe(0);
    expect((await login('alice', cookie)).body).toEqual({ totpRequired: true });
  });

  it('efface aussi le cookie quand l’appareil oublié est le courant', async () => {
    const { db, trustDevice, sessionAgent } = setup();
    const cookie = await trustDevice('alice');
    const session = await sessionAgent('alice', cookie);
    const { id } = db.prepare('SELECT id FROM trusted_devices').get() as { id: number };
    const res = await session.del(`/api/auth/devices/${id}`);
    expect(res.status).toBe(204);
    expect(deviceSetCookie(res)).toContain('testctrl_device=;');
  });

  it('répond 404 pour un appareil inconnu ou d’un autre compte', async () => {
    const { db, trustDevice, sessionAgent, deviceCount } = setup();
    await trustDevice('bob');
    const session = await sessionAgent('alice');
    const { id } = db.prepare('SELECT id FROM trusted_devices').get() as { id: number };
    const res = await session.del(`/api/auth/devices/${id}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('auth.device_not_found');
    expect((await session.del('/api/auth/devices/9999')).status).toBe(404);
    expect(deviceCount('bob')).toBe(1);
  });

  it('oublie tous les appareils du compte, efface le cookie et garde la session', async () => {
    const { trustDevice, sessionAgent, deviceCount } = setup();
    const cookie = await trustDevice('alice');
    await trustDevice('alice');
    await trustDevice('bob');
    const session = await sessionAgent('alice', cookie);
    const res = await session.del('/api/auth/devices');
    expect(res.status).toBe(204);
    expect(deviceSetCookie(res)).toContain('testctrl_device=;');
    expect(deviceCount('alice')).toBe(0);
    expect(deviceCount('bob')).toBe(1);
    expect((await session.agent.get('/api/auth/me')).status).toBe(200);
  });

  it('oublier tous ne touche pas au cookie valide d’un autre compte', async () => {
    const { login, trustDevice, sessionAgent, deviceCount } = setup();
    const bobCookie = await trustDevice('bob');
    const session = await sessionAgent('alice', bobCookie);
    const res = await session.del('/api/auth/devices');
    expect(res.status).toBe(204);
    expect(deviceSetCookie(res)).toBeUndefined();
    expect(deviceCount('bob')).toBe(1);
    expect((await login('bob', bobCookie)).body).not.toEqual({ totpRequired: true });
  });
});

describe('révocation des appareils', () => {
  it('POST /change-password', async () => {
    const { trustDevice, sessionAgent, deviceCount } = setup();
    await trustDevice('alice');
    await trustDevice('bob');
    const { agent } = await sessionAgent('alice');
    const res = await agent
      .post('/api/auth/change-password')
      .send({ current: PASSWORD, next: 'newpassword1' });
    expect(res.status).toBe(204);
    expect(deviceCount('alice')).toBe(0);
    expect(deviceCount('bob')).toBe(1);
  });

  it('POST /password/reset, sans toucher à la 2FA', async () => {
    const { app, db, ids, trustDevice, deviceCount } = setup();
    await trustDevice('alice');
    await trustDevice('bob');
    const token = 'reset-token-value';
    db.prepare(
      'INSERT INTO password_reset_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
    ).run(sha256(token), ids.alice, Date.now() + 60_000);
    const res = await request(app)
      .post('/api/auth/password/reset')
      .send({ token, password: 'newpassword1' });
    expect(res.status).toBe(204);
    expect(deviceCount('alice')).toBe(0);
    expect(deviceCount('bob')).toBe(1);
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password: 'newpassword1' });
    expect(login.body).toEqual({ totpRequired: true });
  });

  it('PATCH /api/users/:id avec mot de passe (autre compte et propre compte)', async () => {
    const { ids, trustDevice, sessionAgent, deviceCount } = setup();
    await trustDevice('alice');
    await trustDevice('root');
    const { agent } = await sessionAgent('root');

    const other = await agent.patch(`/api/users/${ids.alice}`).send({ password: 'newpassword1' });
    expect(other.status).toBe(200);
    expect(deviceCount('alice')).toBe(0);
    expect(deviceCount('root')).toBe(1);

    const own = await agent.patch(`/api/users/${ids.root}`).send({ password: 'newpassword2' });
    expect(own.status).toBe(200);
    expect(deviceCount('root')).toBe(0);
  });

  it('PATCH /api/users/:id sans mot de passe ne révoque rien', async () => {
    const { ids, trustDevice, sessionAgent, deviceCount } = setup();
    await trustDevice('alice');
    const { agent } = await sessionAgent('root');
    const res = await agent
      .patch(`/api/users/${ids.alice}`)
      .send({ username: 'alicia', email: 'alicia@example.com' });
    expect(res.status).toBe(200);
    expect(deviceCount()).toBe(1);
  });

  it('PATCH /profile (nom, e-mail) ne révoque rien', async () => {
    const { trustDevice, sessionAgent, deviceCount } = setup();
    await trustDevice('alice');
    const { agent } = await sessionAgent('alice');
    const res = await agent
      .patch('/api/auth/profile')
      .send({ currentPassword: PASSWORD, username: 'alicia', email: 'a@example.com' });
    expect(res.status).toBe(200);
    expect(deviceCount()).toBe(1);
  });

  it('POST /2fa/disable', async () => {
    const { trustDevice, sessionAgent, deviceCount } = setup();
    await trustDevice('alice');
    await trustDevice('bob');
    const { agent } = await sessionAgent('alice');
    const res = await agent.post('/api/auth/2fa/disable').send({ password: PASSWORD });
    expect(res.status).toBe(204);
    expect(deviceCount('alice')).toBe(0);
    expect(deviceCount('bob')).toBe(1);
  });

  it('POST /2fa/enable (réactivation)', async () => {
    const { app, db, ids, deviceCount, insertDevice } = setup();
    db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(ids.alice);
    insertDevice('alice', 'stale', Date.now() + DAY);
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ username: 'alice', password: PASSWORD });
    const { secret } = (await agent.post('/api/auth/2fa/setup')).body as { secret: string };
    const res = await agent.post('/api/auth/2fa/enable').send({ code: totpCode(secret) });
    expect(res.status).toBe(204);
    expect(deviceCount('alice')).toBe(0);
  });

  it('la suppression du compte supprime ses appareils (cascade)', async () => {
    const { ids, trustDevice, sessionAgent, deviceCount } = setup();
    await trustDevice('alice');
    const { agent } = await sessionAgent('root');
    const res = await agent.delete(`/api/users/${ids.alice}`);
    expect(res.status).toBe(204);
    expect(deviceCount()).toBe(0);
  });
});

describe('DELETE /api/users/:id/2fa (admin)', () => {
  it('désactive la 2FA du compte et révoque ses seuls appareils', async () => {
    const { app, ids, trustDevice, sessionAgent, deviceCount } = setup();
    await trustDevice('alice');
    await trustDevice('bob');
    const { agent } = await sessionAgent('root');
    const res = await agent.delete(`/api/users/${ids.alice}/2fa`);
    expect(res.status).toBe(204);
    expect(deviceCount('alice')).toBe(0);
    expect(deviceCount('bob')).toBe(1);
    const users = (await agent.get('/api/users')).body.items as {
      username: string;
      totpEnabled: boolean;
    }[];
    expect(users.find((user) => user.username === 'alice')?.totpEnabled).toBe(false);
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password: PASSWORD });
    expect(login.body).toMatchObject({ username: 'alice', totpEnabled: false });
  });

  it('répond 404 pour un compte inconnu et 409 sans 2FA', async () => {
    const { db, sessionAgent } = setup();
    const carol = addTestUser(db, 'carol');
    const { agent } = await sessionAgent('root');
    const unknown = await agent.delete('/api/users/9999/2fa');
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('user.not_found');
    const plain = await agent.delete(`/api/users/${carol}/2fa`);
    expect(plain.status).toBe(409);
    expect(plain.body.error.code).toBe('auth.totp_not_enabled');
  });

  it('est réservé aux admins', async () => {
    const { ids, sessionAgent } = setup();
    const { agent } = await sessionAgent('alice');
    expect((await agent.delete(`/api/users/${ids.bob}/2fa`)).status).toBe(403);
  });
});
