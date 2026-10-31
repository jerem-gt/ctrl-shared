import bcrypt from 'bcrypt';
import Database from 'better-sqlite3';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import { vi } from 'vitest';

import { BASE_ERROR_MESSAGES, createErrorRegistry } from '../apiErrors.js';
import { AUTH_ERROR_MESSAGES } from '../auth/errors.js';
import { type AuthModuleOptions, createAuthModule } from '../auth/index.js';
import { createErrorHandler } from '../errorHandler.js';
import { createHttpErrors } from '../errors.js';
import type { Mailer, MailMessage } from '../mailer.js';
import { SQLiteSessionStore } from '../session-store.js';

/** Coût bcrypt minimal : les tests n'ont pas besoin de la lenteur de la production. */
export const TEST_BCRYPT_COST = 4;
export const TEST_SECRET = 'a'.repeat(40);
export const SESSION_COOKIE = 'testctrl.sid';
export const DEVICE_COOKIE = 'testctrl_device';

const registry = createErrorRegistry({ ...BASE_ERROR_MESSAGES, ...AUTH_ERROR_MESSAGES });
const { HttpError } = createHttpErrors(registry.renderMessage);

/** Base en mémoire au schéma commun des projets (comptes, jetons de réinitialisation, appareils). */
export function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users
    (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        username       TEXT    NOT NULL UNIQUE,
        password_hash  TEXT    NOT NULL,
        is_admin       INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
        email          TEXT,
        totp_secret    TEXT,
        totp_enabled   INTEGER NOT NULL DEFAULT 0 CHECK (totp_enabled IN (0, 1)),
        totp_last_step INTEGER,
        created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE password_reset_tokens
    (
        token_hash TEXT PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
    );
    CREATE TABLE trusted_devices
    (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        token_hash   TEXT    NOT NULL UNIQUE,
        label        TEXT    NOT NULL,
        created_at   INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL,
        expires_at   INTEGER NOT NULL
    );
    -- Données d'un compte (statistiques et hooks des tests).
    CREATE TABLE items
    (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        label   TEXT    NOT NULL
    );
  `);
  return db;
}

export type TestDb = ReturnType<typeof createTestDb>;

interface TestUserOptions {
  password?: string;
  email?: string | null;
  isAdmin?: boolean;
  /** Secret TOTP (base32) : la 2FA du compte est active. */
  totpSecret?: string;
}

/** Crée un compte et renvoie son id ; mot de passe « password » par défaut. */
export function addTestUser(db: TestDb, username: string, options: TestUserOptions = {}): number {
  const { password = 'password', email = null, isAdmin = false, totpSecret = null } = options;
  return Number(
    db
      .prepare(
        `INSERT INTO users (username, password_hash, email, is_admin, totp_secret, totp_enabled)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        username,
        bcrypt.hashSync(password, TEST_BCRYPT_COST),
        email,
        isAdmin ? 1 : 0,
        totpSecret,
        totpSecret === null ? 0 : 1,
      ).lastInsertRowid,
  );
}

export interface FakeMailer extends Mailer {
  sent: MailMessage[];
}

/** Mailer de test : mémorise les messages, aucun SMTP réel. */
export function createFakeMailer(
  options: { configured?: boolean; fail?: boolean } = {},
): FakeMailer {
  const { configured = true, fail = false } = options;
  const sent: MailMessage[] = [];
  return {
    sent,
    isConfigured: () => configured,
    send: (message) => {
      if (fail) {
        return Promise.reject(new Error('smtp down'));
      }
      sent.push(message);
      return Promise.resolve();
    },
  };
}

export type TestLang = 'fr' | 'en';
export interface TestStats {
  itemCount: number;
}

type TestOptions = Partial<
  Omit<AuthModuleOptions<TestLang, TestStats>, 'HttpError' | 'mailer' | 'log'>
>;

/**
 * Application d'auth de test : session SQLite, module d'auth, une route protégée
 * (`GET /api/items`) et le gestionnaire d'erreur global, comme dans les projets.
 */
export function createAuthApp(
  options: TestOptions & { db?: TestDb; mailer?: FakeMailer; trustProxy?: boolean } = {},
) {
  const { db = createTestDb(), mailer = createFakeMailer(), trustProxy, ...auth } = options;
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const sessionStore = new SQLiteSessionStore(db);
  const app = express();
  if (trustProxy) {
    app.set('trust proxy', true);
  }
  app.use(express.json());
  app.use(
    session({
      name: SESSION_COOKIE,
      store: sessionStore,
      secret: TEST_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: 'lax', secure: auth.secureCookies ? 'auto' : false },
    }),
  );
  const authModule = createAuthModule<TestLang, TestStats>(db, sessionStore, {
    appName: 'TestCtrl',
    HttpError,
    sessionCookie: SESSION_COOKIE,
    deviceCookie: DEVICE_COOKIE,
    languages: ['fr', 'en'],
    mailTexts: {
      reset: (lang, link, minutes) => ({
        subject: `reset ${lang}`,
        text: `${lang} ${link} ${minutes}`,
      }),
      test: () => ({ subject: 'TestCtrl', text: 'test' }),
    },
    userStats: (userId) => ({
      itemCount: (
        db.prepare('SELECT COUNT(*) AS n FROM items WHERE user_id = ?').get(userId) as {
          n: number;
        }
      ).n,
    }),
    mailer,
    log,
    ...auth,
  });
  app.use('/api/auth', authModule.authRouter);
  app.use('/api', authModule.requireAuth);
  app.use('/api/users', authModule.usersRouter);
  app.get('/api/items', (_req, res) => {
    res.json({ items: [] });
  });
  app.use(
    createErrorHandler({ HttpError, registry, log: { warn: () => undefined, error: log.error } }),
  );
  return { db, app, mailer, log, sessionStore, authModule };
}

export type TestApp = ReturnType<typeof createAuthApp>['app'];

/** Agent connecté (cookie de session conservé entre les requêtes). */
export async function loginAgent(app: TestApp, username: string, password = 'password') {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ username, password });
  if (res.status !== 200) {
    throw new Error(`Connexion de ${username} refusée : ${res.status}`);
  }
  return agent;
}
