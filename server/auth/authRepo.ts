import type { Database } from 'better-sqlite3';

import type { ResetTokenRow, User } from './types.js';

export const BCRYPT_COST = 12;

export function createAuthRepo(db: Database) {
  const getByUsernameStmt = db.prepare<[string], User>('SELECT * FROM users WHERE username = ?');
  const getByEmailStmt = db.prepare<[string], User>('SELECT * FROM users WHERE email = ?');
  const getByIdStmt = db.prepare<[number], User>('SELECT * FROM users WHERE id = ?');
  const countUsersStmt = db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM users');
  const insertAdminStmt = db.prepare<[string, string]>(
    'INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)',
  );
  const updatePasswordStmt = db.prepare<[string, number]>(
    'UPDATE users SET password_hash = ? WHERE id = ?',
  );
  const enableTotpStmt = db.prepare<[string, number, number]>(
    'UPDATE users SET totp_secret = ?, totp_enabled = 1, totp_last_step = ? WHERE id = ?',
  );
  // Conditionnel : de deux requêtes simultanées avec le même code, une seule passe.
  const consumeTotpStepStmt = db.prepare<[number, number, number]>(
    `UPDATE users SET totp_last_step = ?
     WHERE id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)`,
  );
  const deleteTokensForUserStmt = db.prepare<[number]>(
    'DELETE FROM password_reset_tokens WHERE user_id = ?',
  );
  const purgeExpiredTokensStmt = db.prepare<[number]>(
    'DELETE FROM password_reset_tokens WHERE expires_at <= ?',
  );
  const insertTokenStmt = db.prepare<[string, number, number]>(
    'INSERT INTO password_reset_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
  );
  const getTokenStmt = db.prepare<[string], ResetTokenRow>(
    'SELECT user_id, expires_at FROM password_reset_tokens WHERE token_hash = ?',
  );

  return {
    getByUsername: (username: string): User | undefined => getByUsernameStmt.get(username),
    /** `email` doit être normalisé (emailSchema : trim + minuscules). */
    getByEmail: (email: string): User | undefined => getByEmailStmt.get(email),
    getById: (id: number): User | undefined => getByIdStmt.get(id),
    countUsers: (): number => countUsersStmt.get()?.n ?? 0,
    createAdmin: (username: string, hash: string): number =>
      Number(insertAdminStmt.run(username, hash).lastInsertRowid),
    updatePassword: (userId: number, hash: string) => updatePasswordStmt.run(hash, userId),
    /** Le pas du code de confirmation est déjà consommé : ce code ne sert pas à se connecter. */
    enableTotp: (userId: number, secret: string, step: number) =>
      enableTotpStmt.run(secret, step, userId),
    /** Vrai si le pas est postérieur au dernier accepté, qu'il remplace ; faux pour un rejeu. */
    consumeTotpStep: (userId: number, step: number): boolean =>
      consumeTotpStepStmt.run(step, userId, step).changes === 1,
    deleteResetTokensForUser: (userId: number) => deleteTokensForUserStmt.run(userId),
    purgeExpiredResetTokens: (now: number) => purgeExpiredTokensStmt.run(now),
    insertResetToken: (tokenHash: string, userId: number, expiresAt: number) =>
      insertTokenStmt.run(tokenHash, userId, expiresAt),
    getResetToken: (tokenHash: string): ResetTokenRow | undefined => getTokenStmt.get(tokenHash),
  };
}

export type AuthRepo = ReturnType<typeof createAuthRepo>;
