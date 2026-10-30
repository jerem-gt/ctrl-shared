import type { Database, Statement } from 'better-sqlite3';

interface AttemptRow {
  count: number;
  reset_at: number;
}

/**
 * Limiteur de tentatives persisté en SQLite (table `login_attempts`, créée si absente), pour
 * freiner le brute-force et survivre aux redémarrages du conteneur. Seuls les échecs comptent : une
 * réussite remet le compteur à zéro. Les entrées expirées sont purgées à l'accès.
 */
export class FailureRateLimiter {
  private readonly stmtGet: Statement<[string]>;
  private readonly stmtUpsert: Statement<[string, number, number, number]>;
  private readonly stmtDelete: Statement<[string]>;

  constructor(
    db: Database,
    private readonly maxAttempts = 10,
    private readonly windowMs = 15 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS login_attempts (
        key      TEXT    PRIMARY KEY,
        count    INTEGER NOT NULL,
        reset_at INTEGER NOT NULL
      )
    `);
    this.stmtGet = db.prepare('SELECT count, reset_at FROM login_attempts WHERE key = ?');
    this.stmtUpsert = db.prepare(`
      INSERT INTO login_attempts (key, count, reset_at) VALUES (?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET
        count    = CASE WHEN reset_at <= ? THEN 1 ELSE count + 1 END,
        reset_at = CASE WHEN reset_at <= ? THEN excluded.reset_at ELSE reset_at END
    `);
    this.stmtDelete = db.prepare('DELETE FROM login_attempts WHERE key = ?');
  }

  /** `true` si la clé est sous le seuil (tentative autorisée). */
  isAllowed(key: string): boolean {
    const entry = this.stmtGet.get(key) as AttemptRow | undefined;
    if (!entry) {
      return true;
    }
    if (entry.reset_at <= this.now()) {
      this.stmtDelete.run(key);
      return true;
    }
    return entry.count < this.maxAttempts;
  }

  /** Enregistre un échec et (re)démarre la fenêtre si nécessaire. */
  recordFailure(key: string): void {
    const now = this.now();
    this.stmtUpsert.run(key, now + this.windowMs, now, now);
  }

  /** Réinitialise le compteur d'une clé (réussite). */
  reset(key: string): void {
    this.stmtDelete.run(key);
  }
}
