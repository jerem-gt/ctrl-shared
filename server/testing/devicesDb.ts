import Database from 'better-sqlite3';

/** Base en mémoire au schéma `trusted_devices` des projets, avec les comptes 1 et 2. */
export function createDevicesDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT);
    INSERT INTO users DEFAULT VALUES;
    INSERT INTO users DEFAULT VALUES;
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
  `);
  return db;
}
