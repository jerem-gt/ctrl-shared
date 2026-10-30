import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { type Migration, runMigrations } from './migrations.js';

function createDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE parents (id INTEGER PRIMARY KEY);
    CREATE TABLE children (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parents (id) ON DELETE CASCADE);
    INSERT INTO parents (id) VALUES (1);
    INSERT INTO children (id, parent_id) VALUES (1, 1);
  `);
  return db;
}

const version = (db: Database.Database) => db.pragma('user_version', { simple: true });

describe('runMigrations', () => {
  it('applique les migrations dans l’ordre, en SQL ou en fonction, et note la version', () => {
    const db = createDb();
    const migrations: Migration[] = [
      'ALTER TABLE parents ADD COLUMN name TEXT',
      (database) => database.prepare("UPDATE parents SET name = 'Alice'").run(),
    ];

    runMigrations(db, migrations);

    expect(version(db)).toBe(2);
    expect(db.prepare('SELECT name FROM parents').get()).toEqual({ name: 'Alice' });
  });

  it('ne rejoue pas les migrations déjà passées', () => {
    const db = createDb();
    runMigrations(db, ['ALTER TABLE parents ADD COLUMN name TEXT']);

    runMigrations(db, ['ALTER TABLE parents ADD COLUMN name TEXT', 'SELECT 1']);
    expect(version(db)).toBe(2);

    db.pragma('foreign_keys = OFF');
    runMigrations(db, ['ALTER TABLE parents ADD COLUMN name TEXT', 'SELECT 1']);
    expect(version(db)).toBe(2);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(0);
  });

  it('reconstruit une table sans déclencher les cascades, puis rétablit les clés étrangères', () => {
    const db = createDb();

    runMigrations(db, [
      `CREATE TABLE parents_new (id INTEGER PRIMARY KEY, label TEXT);
       INSERT INTO parents_new (id) SELECT id FROM parents;
       DROP TABLE parents;
       ALTER TABLE parents_new RENAME TO parents;`,
    ]);

    expect(db.prepare('SELECT COUNT(*) AS n FROM children').get()).toEqual({ n: 1 });
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('annule une migration qui casse l’intégrité, et garde la version précédente', () => {
    const db = createDb();

    expect(() =>
      runMigrations(db, ['SELECT 1', 'INSERT INTO children (id, parent_id) VALUES (2, 99)']),
    ).toThrow('Migration 2 : clés étrangères invalides.');

    expect(version(db)).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM children').get()).toEqual({ n: 1 });
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('annule une migration en erreur, et garde les clés étrangères désactivées si elles l’étaient', () => {
    const db = createDb();
    db.pragma('foreign_keys = OFF');

    expect(() => runMigrations(db, ['ALTER TABLE absente ADD COLUMN x TEXT'])).toThrow();

    expect(version(db)).toBe(0);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(0);
  });
});
