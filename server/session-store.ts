import type { Database, Statement } from 'better-sqlite3';
import { type SessionData, Store } from 'express-session';

interface SessionRow {
  data: string;
  expires_at: number;
}

const DEFAULT_MAX_AGE_MS = 86_400_000;

/**
 * Sessions `express-session` persistées en SQLite (table `sessions`, créée si absente) : elles
 * survivent aux redémarrages du conteneur. Le compte d'une session est lu dans `data.userId`.
 */
export class SQLiteSessionStore extends Store {
  private readonly stmtGet: Statement<[string], SessionRow>;
  private readonly stmtUpsert: Statement<[string, string, number]>;
  private readonly stmtDelete: Statement<[string]>;
  private readonly stmtTouch: Statement<[number, string]>;
  private readonly stmtCleanup: Statement<[number]>;
  private readonly stmtDeleteOthers: Statement<[number, string]>;
  private readonly stmtDeleteAll: Statement<[number]>;

  constructor(db: Database) {
    super();

    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid        TEXT PRIMARY KEY,
        data       TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `);
    this.stmtGet = db.prepare('SELECT data, expires_at FROM sessions WHERE sid = ?');
    this.stmtUpsert = db.prepare(
      'INSERT OR REPLACE INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)',
    );
    this.stmtDelete = db.prepare('DELETE FROM sessions WHERE sid = ?');
    this.stmtTouch = db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?');
    this.stmtCleanup = db.prepare('DELETE FROM sessions WHERE expires_at < ?');
    this.stmtDeleteOthers = db.prepare(
      "DELETE FROM sessions WHERE json_extract(data, '$.userId') = ? AND sid != ?",
    );
    this.stmtDeleteAll = db.prepare(
      "DELETE FROM sessions WHERE json_extract(data, '$.userId') = ?",
    );

    setInterval(() => this.stmtCleanup.run(Date.now()), 60 * 60 * 1000).unref();
  }

  private static expiresAt(session: SessionData): number {
    return session.cookie.expires
      ? new Date(session.cookie.expires).getTime()
      : Date.now() + (session.cookie.maxAge ?? DEFAULT_MAX_AGE_MS);
  }

  get(sid: string, callback: (err: unknown, session?: SessionData | null) => void): void {
    try {
      const row = this.stmtGet.get(sid);
      if (!row || row.expires_at < Date.now()) {
        callback(null, null);
        return;
      }
      callback(null, JSON.parse(row.data) as SessionData);
    } catch (err) {
      callback(err);
    }
  }

  set(sid: string, session: SessionData, callback?: (err?: unknown) => void): void {
    try {
      this.stmtUpsert.run(sid, JSON.stringify(session), SQLiteSessionStore.expiresAt(session));
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  destroy(sid: string, callback?: (err?: unknown) => void): void {
    try {
      this.stmtDelete.run(sid);
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  /** Supprime les sessions d'un utilisateur, sauf la session courante. */
  destroyOtherSessions(userId: number, currentSid: string): void {
    this.stmtDeleteOthers.run(userId, currentSid);
  }

  /** Supprime toutes les sessions d'un utilisateur (courante incluse). */
  destroyAllSessions(userId: number): void {
    this.stmtDeleteAll.run(userId);
  }

  touch(sid: string, session: SessionData, callback?: (err?: unknown) => void): void {
    try {
      this.stmtTouch.run(SQLiteSessionStore.expiresAt(session), sid);
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }
}
