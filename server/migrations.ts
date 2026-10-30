import type { Database } from 'better-sqlite3';

/** Une migration : du SQL, ou une fonction pour ce que le SQL seul ne sait pas faire. */
export type Migration = string | ((db: Database) => void);

/**
 * Applique, dans l'ordre, les migrations pas encore passées : la version de la base
 * (`PRAGMA user_version`) est le nombre de migrations appliquées. Une migration livrée ne se
 * modifie jamais : on en ajoute une.
 *
 * Chaque migration tourne dans sa propre transaction, clés étrangères désactivées (une
 * reconstruction de table ne déclenche pas les cascades) puis contrôlées avant la validation :
 * une migration qui échoue ou casse l'intégrité laisse la base à la version précédente.
 */
export function runMigrations(db: Database, migrations: readonly Migration[]): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  if (current >= migrations.length) {
    return;
  }
  // Hors transaction : le pragma n'a pas d'effet à l'intérieur.
  const foreignKeys = db.pragma('foreign_keys', { simple: true }) as number;
  db.pragma('foreign_keys = OFF');
  try {
    for (let version = current; version < migrations.length; version++) {
      db.transaction(() => {
        const migration = migrations[version];
        if (typeof migration === 'string') {
          db.exec(migration);
        } else {
          migration(db);
        }
        const violations = db.pragma('foreign_key_check') as unknown[];
        if (violations.length > 0) {
          throw new Error(`Migration ${version + 1} : clés étrangères invalides.`);
        }
        db.pragma(`user_version = ${version + 1}`);
      })();
    }
  } finally {
    db.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
  }
}
