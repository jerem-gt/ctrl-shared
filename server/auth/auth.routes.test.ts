import { SetupToken } from '../setup.js';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { addTestUser, createAuthApp, loginAgent, type TestApp } from '../testing/authApp.js';
import { actAs, currentUserId } from './middleware.js';

const PASSWORD = 'correct-horse';

function setup({ secureCookies = false } = {}) {
  const ctx = createAuthApp({ secureCookies });
  const userId = addTestUser(ctx.db, 'admin', {
    password: PASSWORD,
    email: 'admin@example.com',
    isAdmin: true,
  });
  return { ...ctx, userId };
}

const login = (app: TestApp, body: object = { username: 'admin', password: PASSWORD }) =>
  request(app).post('/api/auth/login').send(body);
const cookieOf = (res: request.Response) => (res.headers['set-cookie'] as unknown as string[])[0];
const sessionCookie = (res: request.Response) => cookieOf(res).split(';')[0];

describe('accès aux routes protégées', () => {
  it.each([
    ['GET', '/api/items'],
    ['POST', '/api/items'],
    ['GET', '/api/users'],
  ])('refuse %s %s sans session', async (method, path) => {
    const { app } = setup();
    const res = await request(app)[method.toLowerCase() as 'get' | 'post'](path);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('common.unauthorized');
  });

  it('donne accès à l’API une fois connecté', async () => {
    const { app } = setup();
    const agent = await loginAgent(app, 'admin', PASSWORD);
    expect((await agent.get('/api/items')).status).toBe(200);
  });

  it('refuse un cookie de session falsifié', async () => {
    const { app } = setup();
    const res = await request(app)
      .get('/api/items')
      .set('Cookie', 'testctrl.sid=s%3Aforged.invalidsignature');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/login', () => {
  it('connecte le compte et pose un cookie de session sûr', async () => {
    const { app, userId } = setup();
    const res = await login(app);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: userId,
      username: 'admin',
      email: 'admin@example.com',
      isAdmin: true,
      totpEnabled: false,
    });
    const cookie = cookieOf(res);
    expect(cookie).toMatch(/^testctrl\.sid=/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toContain('Secure');
  });

  it.each([
    ['mot de passe incorrect', { username: 'admin', password: 'wrong' }],
    ['identifiant inconnu', { username: 'root', password: PASSWORD }],
  ])('refuse un %s sans ouvrir de session', async (_label, body) => {
    const { app } = setup();
    const res = await login(app, body);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('auth.invalid_credentials');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it.each([
    ['sans corps', {}],
    ['sans mot de passe', { username: 'admin' }],
    ['identifiant vide', { username: '', password: PASSWORD }],
    ['identifiant trop long', { username: 'a'.repeat(201), password: PASSWORD }],
  ])('rejette une requête %s', async (_label, body) => {
    const { app } = setup();
    const res = await login(app, body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation.invalid');
  });

  it('change d’identifiant de session à chaque connexion', async () => {
    const { app } = setup();
    const first = sessionCookie(await login(app));
    const second = sessionCookie(await login(app));
    expect(second).not.toBe(first);
  });

  it('marque le cookie Secure derrière HTTPS seulement (mode « auto »)', async () => {
    const { app } = setup({ secureCookies: true });
    app.set('trust proxy', 1);
    const https = await login(app).set('X-Forwarded-Proto', 'https');
    expect(cookieOf(https)).toContain('Secure');
    const http = await login(app);
    expect(http.status).toBe(200);
    expect(cookieOf(http)).not.toContain('Secure');
  });
});

describe('limitation des tentatives', () => {
  const failAttempts = async (app: TestApp, count: number) => {
    for (let i = 0; i < count; i += 1) {
      await login(app, { username: 'admin', password: 'wrong' });
    }
  };

  it('bloque la connexion après 10 échecs, même avec le bon mot de passe', async () => {
    const { app } = setup();
    await failAttempts(app, 10);
    const res = await login(app);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('auth.too_many_attempts');
  });

  it('remet le compteur à zéro après une connexion réussie', async () => {
    const { app } = setup();
    await failAttempts(app, 9);
    expect((await login(app)).status).toBe(200);
    await failAttempts(app, 9);
    expect((await login(app)).status).toBe(200);
  });
});

describe('GET /api/auth/me et POST /api/auth/logout', () => {
  it('renvoie l’utilisateur connecté, 401 sinon', async () => {
    const { app, userId } = setup();
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    const agent = await loginAgent(app, 'admin', PASSWORD);
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body).toEqual({
      id: userId,
      username: 'admin',
      email: 'admin@example.com',
      isAdmin: true,
      totpEnabled: false,
    });
  });

  it('renvoie 401 quand le compte de la session a été supprimé', async () => {
    const { app, db, userId } = setup();
    const agent = await loginAgent(app, 'admin', PASSWORD);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('déconnecte : le cookie est effacé et l’API se referme', async () => {
    const { app } = setup();
    const agent = await loginAgent(app, 'admin', PASSWORD);
    const out = await agent.post('/api/auth/logout');
    expect(out.status).toBe(204);
    expect(cookieOf(out)).toMatch(/^testctrl\.sid=;/);
    expect((await agent.get('/api/items')).status).toBe(401);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('accepte une déconnexion sans session', async () => {
    const { app } = setup();
    expect((await request(app).post('/api/auth/logout')).status).toBe(204);
  });
});

describe('persistance des sessions', () => {
  it('garde la session après un redémarrage (même base, nouvelle instance)', async () => {
    const { app, db } = setup();
    const cookie = sessionCookie(await login(app));
    const restarted = createAuthApp({ db }).app;
    const res = await request(restarted).get('/api/items').set('Cookie', cookie);
    expect(res.status).toBe(200);
  });
});

describe('premier démarrage', () => {
  const setupApp = () => {
    const setupToken = new SetupToken();
    return { ...createAuthApp({ setupToken }), token: setupToken.current() as string };
  };
  const firstAccount = { username: 'jerem', password: 'long-enough' };

  it('annonce la création attendue tant qu’aucun compte n’existe', async () => {
    const { app, db } = setupApp();
    expect((await request(app).get('/api/auth/setup')).body).toEqual({ required: true });
    addTestUser(db, 'alice');
    expect((await request(app).get('/api/auth/setup')).body).toEqual({ required: false });
  });

  it('crée le premier compte, admin, et ouvre la session', async () => {
    const { app, db, token } = setupApp();
    const agent = request.agent(app);

    const res = await agent.post('/api/auth/setup').send({ token, ...firstAccount });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ username: 'jerem', email: null, isAdmin: true });
    expect((await agent.get('/api/users')).status).toBe(200);
    expect(db.prepare('SELECT username, is_admin FROM users').all()).toEqual([
      { username: 'jerem', is_admin: 1 },
    ]);
    expect((await login(app, firstAccount)).status).toBe(200);
  });

  it('passe le compte créé et sa langue au hook, dans la transaction', async () => {
    const setupToken = new SetupToken();
    const created: [number, string][] = [];
    const { app } = createAuthApp({
      setupToken,
      onUserCreated: (db, userId, lang) => {
        db.prepare("INSERT INTO items (user_id, label) VALUES (?, 'seed')").run(userId);
        created.push([userId, lang]);
      },
    });
    const token = setupToken.current() as string;
    const res = await request(app)
      .post('/api/auth/setup')
      .send({ token, ...firstAccount, lang: 'en' });
    expect(res.status).toBe(200);
    expect(created).toEqual([[res.body.id, 'en']]);
  });

  it('n’accepte le jeton qu’une fois (409 ensuite)', async () => {
    const { app, token } = setupApp();
    await request(app)
      .post('/api/auth/setup')
      .send({ token, ...firstAccount });

    const again = await request(app)
      .post('/api/auth/setup')
      .send({ token, username: 'other', password: 'long-enough' });

    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('auth.setup_done');
  });

  it('retourne 409 si un compte existe déjà', async () => {
    const { app, db, token } = setupApp();
    addTestUser(db, 'alice');
    const res = await request(app)
      .post('/api/auth/setup')
      .send({ token, ...firstAccount });
    expect(res.status).toBe(409);
  });

  it('retourne 403 pour un jeton faux, sans créer de compte', async () => {
    const { app, db } = setupApp();
    const res = await request(app)
      .post('/api/auth/setup')
      .send({ token: 'faux', ...firstAccount });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('auth.setup_token_invalid');
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 0 });
  });

  it.each([
    ['mot de passe trop court', { username: 'jerem', password: 'short' }],
    ['sans nom', { password: 'long-enough' }],
  ])('retourne 400 : %s', async (_label, body) => {
    const { app, token } = setupApp();
    const res = await request(app)
      .post('/api/auth/setup')
      .send({ token, ...body });
    expect(res.status).toBe(400);
  });

  it('bloque après 10 jetons faux, même avec le bon jeton ensuite', async () => {
    const { app, token } = setupApp();
    for (let i = 0; i < 10; i += 1) {
      await request(app)
        .post('/api/auth/setup')
        .send({ token: 'faux', ...firstAccount });
    }
    const res = await request(app)
      .post('/api/auth/setup')
      .send({ token, ...firstAccount });
    expect(res.status).toBe(429);
  });
});

describe('PATCH /api/auth/profile', () => {
  const profileSetup = async () => {
    const ctx = setup();
    addTestUser(ctx.db, 'bob', { email: 'bob@example.com' });
    const agent = await loginAgent(ctx.app, 'admin', PASSWORD);
    return { ...ctx, agent };
  };

  it('modifie le nom et normalise l’e-mail', async () => {
    const { agent } = await profileSetup();

    const res = await agent
      .patch('/api/auth/profile')
      .send({ currentPassword: PASSWORD, username: 'jerem', email: '  Jerem@Example.COM ' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ username: 'jerem', email: 'jerem@example.com' });
    expect((await agent.get('/api/auth/me')).body.username).toBe('jerem');
  });

  it('efface l’e-mail avec null, et accepte de renvoyer son propre nom', async () => {
    const { agent } = await profileSetup();
    const res = await agent
      .patch('/api/auth/profile')
      .send({ currentPassword: PASSWORD, username: 'admin', email: null });
    expect(res.status).toBe(200);
    expect(res.body.email).toBeNull();
  });

  it('retourne 401 si le mot de passe actuel est faux, sans rien modifier', async () => {
    const { agent, db } = await profileSetup();
    const res = await agent
      .patch('/api/auth/profile')
      .send({ currentPassword: 'wrong', username: 'jerem' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('auth.current_password_incorrect');
    expect(db.prepare("SELECT 1 FROM users WHERE username = 'jerem'").get()).toBeUndefined();
  });

  it.each([
    ['nom pris', { username: 'bob' }, 'user.username_taken'],
    ['e-mail pris, casse différente', { email: 'BOB@example.com' }, 'user.email_taken'],
  ])('retourne 409 : %s', async (_label, change, error) => {
    const { agent } = await profileSetup();
    const res = await agent
      .patch('/api/auth/profile')
      .send({ currentPassword: PASSWORD, ...change });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe(error);
  });

  it.each([
    ['e-mail invalide', { currentPassword: PASSWORD, email: 'pas-un-email' }],
    ['aucun champ', { currentPassword: PASSWORD }],
    ['sans mot de passe', { username: 'jerem' }],
  ])('retourne 400 : %s', async (_label, body) => {
    const { agent } = await profileSetup();
    expect((await agent.patch('/api/auth/profile').send(body)).status).toBe(400);
  });

  it('retourne 401 sans session', async () => {
    const { app } = setup();
    const res = await request(app)
      .patch('/api/auth/profile')
      .send({ currentPassword: PASSWORD, username: 'x' });
    expect(res.status).toBe(401);
  });

  it('bloque après 10 mots de passe actuels faux, même avec le bon ensuite', async () => {
    const { agent } = await profileSetup();
    for (let i = 0; i < 10; i += 1) {
      await agent.patch('/api/auth/profile').send({ currentPassword: 'wrong', username: 'x' });
    }
    const res = await agent
      .patch('/api/auth/profile')
      .send({ currentPassword: PASSWORD, username: 'x' });
    expect(res.status).toBe(429);
  }, 20_000);
});

describe('POST /api/auth/change-password', () => {
  it('change le mot de passe et ferme les autres sessions, pas la courante', async () => {
    const { app } = setup();
    const current = await loginAgent(app, 'admin', PASSWORD);
    const other = await loginAgent(app, 'admin', PASSWORD);

    const res = await current
      .post('/api/auth/change-password')
      .send({ current: PASSWORD, next: 'new-password' });

    expect(res.status).toBe(204);
    expect((await current.get('/api/auth/me')).status).toBe(200);
    expect((await other.get('/api/auth/me')).status).toBe(401);
    expect((await login(app, { username: 'admin', password: 'new-password' })).status).toBe(200);
  });

  it('retourne 401 si le mot de passe actuel est faux, 400 si le nouveau est trop court', async () => {
    const { app } = setup();
    const agent = await loginAgent(app, 'admin', PASSWORD);
    expect(
      (await agent.post('/api/auth/change-password').send({ current: 'x', next: 'new-password' }))
        .status,
    ).toBe(401);
    expect(
      (await agent.post('/api/auth/change-password').send({ current: PASSWORD, next: 'short' }))
        .status,
    ).toBe(400);
  });
});

describe('sans authentification (tests de modules)', () => {
  it('actAs agit pour le compte indiqué', async () => {
    const app = express();
    app.use(actAs(42));
    app.get('/whoami', (_req, res) => {
      res.json({ userId: currentUserId(res) });
    });
    expect((await request(app).get('/whoami')).body).toEqual({ userId: 42 });
  });
});
