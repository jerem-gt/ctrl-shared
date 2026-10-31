import type { Database } from 'better-sqlite3';

/** Ligne de la table `trusted_devices`, créée par les migrations du projet. */
export interface TrustedDeviceRow {
  id: number;
  user_id: number;
  token_hash: string;
  label: string;
  created_at: number;
  last_used_at: number;
  expires_at: number;
}

/**
 * Appareils mémorisés (2FA sautée) : seule l'empreinte du jeton du cookie est stockée. La table
 * `trusted_devices` (colonnes de `TrustedDeviceRow`, `token_hash` unique, `user_id` en cascade)
 * appartient au projet.
 */
export function createTrustedDevicesRepo(db: Database) {
  const purgeExpiredStmt = db.prepare<[number]>(
    'DELETE FROM trusted_devices WHERE expires_at <= ?',
  );
  const insertStmt = db.prepare<[number, string, string, number, number, number]>(
    `INSERT INTO trusted_devices (user_id, token_hash, label, created_at, last_used_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const getByHashStmt = db.prepare<[string], TrustedDeviceRow>(
    'SELECT * FROM trusted_devices WHERE token_hash = ?',
  );
  const touchStmt = db.prepare<[number, number]>(
    'UPDATE trusted_devices SET last_used_at = ? WHERE id = ?',
  );
  const deleteByHashStmt = db.prepare<[string]>('DELETE FROM trusted_devices WHERE token_hash = ?');
  const listStmt = db.prepare<[number, number], TrustedDeviceRow>(
    `SELECT * FROM trusted_devices WHERE user_id = ? AND expires_at > ?
     ORDER BY last_used_at DESC, id DESC`,
  );
  const getStmt = db.prepare<[number, number], TrustedDeviceRow>(
    'SELECT * FROM trusted_devices WHERE id = ? AND user_id = ?',
  );
  const deleteStmt = db.prepare<[number, number]>(
    'DELETE FROM trusted_devices WHERE id = ? AND user_id = ?',
  );
  const revokeAllStmt = db.prepare<[number]>('DELETE FROM trusted_devices WHERE user_id = ?');

  return {
    purgeExpired: (now: number) => purgeExpiredStmt.run(now),
    insert: (userId: number, tokenHash: string, label: string, now: number, expiresAt: number) =>
      insertStmt.run(userId, tokenHash, label, now, now, expiresAt),
    getByHash: (tokenHash: string): TrustedDeviceRow | undefined => getByHashStmt.get(tokenHash),
    touch: (id: number, now: number) => touchStmt.run(now, id),
    deleteByHash: (tokenHash: string) => deleteByHashStmt.run(tokenHash),
    /** Appareils non expirés du compte, le dernier utilisé d'abord. */
    list: (userId: number, now: number): TrustedDeviceRow[] => listStmt.all(userId, now),
    get: (id: number, userId: number): TrustedDeviceRow | undefined => getStmt.get(id, userId),
    remove: (id: number, userId: number) => deleteStmt.run(id, userId),
    /** Mot de passe ou 2FA modifié, « oublier tous » : plus aucun appareil ne saute la 2FA. */
    revokeAll: (userId: number) => revokeAllStmt.run(userId),
  };
}

export type TrustedDevicesRepo = ReturnType<typeof createTrustedDevicesRepo>;
