import type { Database } from 'better-sqlite3';

import type { UserItem } from './types.js';

interface UserRow {
  id: number;
  username: string;
  email: string | null;
  is_admin: number;
  totp_enabled: number;
  created_at: string;
}

/** Statistiques d'un compte propres à l'appli (page Utilisateurs). */
export type UserStatsProvider<S> = (userId: number) => S;

const SELECT_USERS = 'SELECT id, username, email, is_admin, totp_enabled, created_at FROM users';

/** Comptes vus par un admin ; `userStats` ajoute les statistiques propres à l'appli. */
export function createUsersRepo<S>(db: Database, userStats: UserStatsProvider<S>) {
  const listStmt = db.prepare<[], UserRow>(`${SELECT_USERS} ORDER BY id`);
  const getByIdStmt = db.prepare<[number], UserRow>(`${SELECT_USERS} WHERE id = ?`);
  const getByUsernameStmt = db.prepare<[string], { id: number }>(
    'SELECT id FROM users WHERE username = ?',
  );
  const getByEmailStmt = db.prepare<[string], { id: number }>(
    'SELECT id FROM users WHERE email = ?',
  );
  const insertStmt = db.prepare<[string, string, string | null, number]>(
    'INSERT INTO users (username, password_hash, email, is_admin) VALUES (?, ?, ?, ?)',
  );
  const updateUsernameStmt = db.prepare<[string, number]>(
    'UPDATE users SET username = ? WHERE id = ?',
  );
  const updateEmailStmt = db.prepare<[string | null, number]>(
    'UPDATE users SET email = ? WHERE id = ?',
  );
  const updateAdminStmt = db.prepare<[number, number]>(
    'UPDATE users SET is_admin = ? WHERE id = ?',
  );
  const disableTotpStmt = db.prepare<[number]>(
    'UPDATE users SET totp_secret = NULL, totp_enabled = 0, totp_last_step = NULL WHERE id = ?',
  );
  const countAdminsStmt = db.prepare<[], { n: number }>(
    'SELECT COUNT(*) AS n FROM users WHERE is_admin = 1',
  );
  const deleteStmt = db.prepare<[number]>('DELETE FROM users WHERE id = ?');

  const toUserItem = (row: UserRow): UserItem<S> => ({
    id: row.id,
    username: row.username,
    email: row.email,
    isAdmin: row.is_admin === 1,
    totpEnabled: row.totp_enabled === 1,
    createdAt: row.created_at,
    stats: userStats(row.id),
  });

  const getById = (id: number): UserItem<S> | undefined => {
    const row = getByIdStmt.get(id);
    return row ? toUserItem(row) : undefined;
  };

  return {
    list: (): UserItem<S>[] => listStmt.all().map(toUserItem),
    getById,
    getByUsername: (username: string): { id: number } | undefined =>
      getByUsernameStmt.get(username),
    /** `email` doit être normalisé (`emailSchema` : trim + minuscules). */
    getByEmail: (email: string): { id: number } | undefined => getByEmailStmt.get(email),
    countAdmins: (): number => countAdminsStmt.get()?.n ?? 0,
    create: (username: string, hash: string, email: string | null, isAdmin: boolean): number =>
      Number(insertStmt.run(username, hash, email, isAdmin ? 1 : 0).lastInsertRowid),
    updateUsername: (id: number, username: string) => updateUsernameStmt.run(username, id),
    updateEmail: (id: number, email: string | null) => updateEmailStmt.run(email, id),
    updateAdmin: (id: number, isAdmin: boolean) => updateAdminStmt.run(isAdmin ? 1 : 0, id),
    disableTotp: (id: number) => disableTotpStmt.run(id),
    /** Supprime le compte et ses données (cascade). */
    remove: (id: number) => deleteStmt.run(id),
  };
}

export type UsersRepo<S> = ReturnType<typeof createUsersRepo<S>>;
