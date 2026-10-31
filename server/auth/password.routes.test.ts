import { createHash } from 'node:crypto';

import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import {
  createAuthApp,
  createFakeMailer,
  type FakeMailer,
  loginAgent,
  addTestUser,
  type TestDb,
} from '../testing/authApp.js';

// Les réinitialisations hachent au coût de production (12) : délai élargi pour la CI chargée.
const SLOW = 20_000;

function setup(options: { appUrl?: string; mailer?: FakeMailer } = {}) {
  const ctx = createAuthApp(options);
  const aliceId = addTestUser(ctx.db, 'alice', { email: 'alice@example.com', isAdmin: true });
  addTestUser(ctx.db, 'noemail');
  return { ...ctx, aliceId };
}

const forgot = (app: ReturnType<typeof setup>['app'], identifier: string) =>
  request(app).post('/api/auth/password/forgot').send({ identifier });
const tokenCount = (db: TestDb) =>
  (db.prepare('SELECT COUNT(*) AS n FROM password_reset_tokens').get() as { n: number }).n;
const tokenFrom = (text: string) => /token=([\w-]+)/.exec(text)?.[1] as string;
const lastWarning = (log: ReturnType<typeof setup>['log']) =>
  String(log.warn.mock.calls.at(-1)?.[0] ?? '');

describe('POST /api/auth/password/forgot', () => {
  it('envoie l’e-mail avec un lien basé sur APP_URL, et ne stocke que l’empreinte', async () => {
    const { app, db, mailer } = setup({ appUrl: 'https://shelf.example.com' });

    const res = await forgot(app, 'alice');

    expect(res.status).toBe(204);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe('alice@example.com');
    // Langue par défaut (la première de l'appli), lien valable 30 minutes.
    expect(mailer.sent[0].subject).toBe('reset fr');
    expect(mailer.sent[0].text).toMatch(
      /^fr https:\/\/shelf\.example\.com\/reset-password\?token=\S+ 30$/,
    );
    const token = tokenFrom(mailer.sent[0].text);
    const row = db.prepare('SELECT token_hash, expires_at FROM password_reset_tokens').get() as {
      token_hash: string;
      expires_at: number;
    };
    expect(row.token_hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(row.expires_at).toBeGreaterThan(Date.now() + 29 * 60_000);
    expect(row.expires_at).toBeLessThanOrEqual(Date.now() + 30 * 60_000);
  });

  it('écrit l’e-mail dans la langue demandée, refuse une langue inconnue', async () => {
    const { app, mailer } = setup({ appUrl: 'https://shelf.example.com' });
    const send = (lang: string) =>
      request(app).post('/api/auth/password/forgot').send({ identifier: 'alice', lang });
    expect((await send('en')).status).toBe(204);
    expect(mailer.sent[0].subject).toBe('reset en');
    const res = await send('de');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation.invalid');
  });

  it('accepte l’e-mail comme identifiant, casse et espaces ignorés', async () => {
    const { app, mailer } = setup({ appUrl: 'https://shelf.example.com' });
    expect((await forgot(app, '  ALICE@example.com ')).status).toBe(204);
    expect(mailer.sent).toHaveLength(1);
  });

  it('remplace les anciens jetons du compte et purge les expirés', async () => {
    const { app, db, aliceId } = setup();
    db.prepare("INSERT INTO password_reset_tokens VALUES ('old', ?, 1)").run(aliceId);
    await forgot(app, 'alice');
    await forgot(app, 'alice');
    expect(tokenCount(db)).toBe(1);
  });

  it('écrit le lien dans les logs sans APP_URL, sans e-mail', async () => {
    const { app, mailer, log } = setup();
    await forgot(app, 'alice');
    expect(mailer.sent).toHaveLength(0);
    expect(lastWarning(log)).toContain('« alice » : ouvrir /reset-password?token=');
  });

  it('écrit le lien absolu dans les logs pour un compte sans e-mail', async () => {
    const { app, mailer, log } = setup({ appUrl: 'https://shelf.example.com' });
    await forgot(app, 'noemail');
    expect(mailer.sent).toHaveLength(0);
    expect(lastWarning(log)).toContain('https://shelf.example.com/reset-password?token=');
  });

  it('écrit le lien dans les logs si le SMTP n’est pas configuré', async () => {
    const mailer = createFakeMailer({ configured: false });
    const { app, log } = setup({ appUrl: 'https://shelf.example.com', mailer });
    await forgot(app, 'alice');
    expect(mailer.sent).toHaveLength(0);
    expect(lastWarning(log)).toContain('reset-password?token=');
  });

  it('répond 204 si l’envoi échoue, l’erreur et le lien étant dans les logs', async () => {
    const mailer = createFakeMailer({ fail: true });
    const { app, log } = setup({ appUrl: 'https://shelf.example.com', mailer });
    expect((await forgot(app, 'alice')).status).toBe(204);
    await vi.waitFor(() => expect(log.error).toHaveBeenCalled());
    expect(lastWarning(log)).toContain('reset-password?token=');
  });

  it('répond 204 pour un compte inconnu, sans jeton ni e-mail', async () => {
    const { app, db, mailer, log } = setup({ appUrl: 'https://shelf.example.com' });
    expect((await forgot(app, 'inconnu')).status).toBe(204);
    expect(tokenCount(db)).toBe(0);
    expect(mailer.sent).toHaveLength(0);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('retourne 400 si le corps est invalide', async () => {
    const { app } = setup();
    expect((await request(app).post('/api/auth/password/forgot').send({})).status).toBe(400);
  });

  it('retourne 429 au-delà de 5 demandes par adresse IP', async () => {
    const { app } = setup();
    for (let i = 0; i < 5; i += 1) {
      expect((await forgot(app, 'inconnu')).status).toBe(204);
    }
    expect((await forgot(app, 'alice')).status).toBe(429);
  });
});

describe('POST /api/auth/password/reset', () => {
  const withToken = async () => {
    const ctx = setup({ appUrl: 'https://shelf.example.com' });
    await forgot(ctx.app, 'alice');
    return { ...ctx, token: tokenFrom(ctx.mailer.sent[0].text) };
  };
  const reset = (app: ReturnType<typeof setup>['app'], token: string, password = 'brand-new-pw') =>
    request(app).post('/api/auth/password/reset').send({ token, password });

  it(
    'change le mot de passe, supprime les jetons et ferme toutes les sessions',
    async () => {
      const { app, db, token } = await withToken();
      const agent = await loginAgent(app, 'alice');

      expect((await reset(app, token)).status).toBe(204);

      expect(tokenCount(db)).toBe(0);
      expect((await agent.get('/api/auth/me')).status).toBe(401);
      await loginAgent(app, 'alice', 'brand-new-pw');
    },
    SLOW,
  );

  it(
    'refuse un jeton déjà utilisé',
    async () => {
      const { app, token } = await withToken();
      await reset(app, token);
      const again = await reset(app, token, 'another-password');
      expect(again.status).toBe(400);
      expect(again.body.error.code).toBe('auth.reset_token_invalid');
    },
    SLOW,
  );

  it('refuse un jeton expiré', async () => {
    const { app, db, token } = await withToken();
    db.prepare('UPDATE password_reset_tokens SET expires_at = ?').run(Date.now() - 1);
    expect((await reset(app, token)).status).toBe(400);
  });

  it('refuse un jeton inconnu sans toucher au mot de passe', async () => {
    const { app } = await withToken();
    expect((await reset(app, 'inconnu')).status).toBe(400);
    await loginAgent(app, 'alice');
  });

  it(
    'un jeton envoyé deux fois en même temps ne sert qu’une fois',
    async () => {
      const { app, token } = await withToken();
      const results = await Promise.all([
        reset(app, token, 'first-pass'),
        reset(app, token, 'second-pass'),
      ]);
      expect(results.map((res) => res.status).sort((a, b) => a - b)).toEqual([204, 400]);
    },
    SLOW,
  );

  it('retourne 400 de validation si le mot de passe est trop court', async () => {
    const { app, db, token } = await withToken();
    const res = await reset(app, token, 'short');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation.invalid');
    expect(tokenCount(db)).toBe(1);
  });

  it('retourne 429 après 10 jetons invalides', async () => {
    const { app, token } = await withToken();
    for (let i = 0; i < 10; i += 1) {
      await reset(app, 'faux');
    }
    expect((await reset(app, token)).status).toBe(429);
  });
});

describe('POST /api/auth/test-email', () => {
  it('envoie un e-mail de test à l’admin connecté', async () => {
    const { app, mailer } = setup();
    const agent = await loginAgent(app, 'alice');
    expect((await agent.post('/api/auth/test-email')).status).toBe(204);
    expect(mailer.sent).toEqual([expect.objectContaining({ to: 'alice@example.com' })]);
  });

  it('retourne 400 sans e-mail sur le compte', async () => {
    const { app, db } = setup();
    db.prepare("UPDATE users SET email = NULL WHERE username = 'alice'").run();
    const agent = await loginAgent(app, 'alice');
    const res = await agent.post('/api/auth/test-email');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('auth.email_missing');
  });

  it('retourne 503 sans SMTP et 502 si l’envoi échoue', async () => {
    const unconfigured = setup({ mailer: createFakeMailer({ configured: false }) });
    const res503 = await (await loginAgent(unconfigured.app, 'alice')).post('/api/auth/test-email');
    expect(res503.status).toBe(503);

    const failing = setup({ mailer: createFakeMailer({ fail: true }) });
    const res502 = await (await loginAgent(failing.app, 'alice')).post('/api/auth/test-email');
    expect(res502.status).toBe(502);
    expect(failing.log.error).toHaveBeenCalled();
  });

  it('retourne 403 pour un non-admin et 401 sans session', async () => {
    const { app } = setup();
    const agent = await loginAgent(app, 'noemail');
    expect((await agent.post('/api/auth/test-email')).status).toBe(403);
    expect((await request(app).post('/api/auth/test-email')).status).toBe(401);
  });
});
