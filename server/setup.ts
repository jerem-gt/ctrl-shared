import { randomBytes, timingSafeEqual } from 'node:crypto';

import type { Database } from 'better-sqlite3';

/** Jeton à usage unique, gardé en mémoire, qui autorise la création du premier compte. */
export class SetupToken {
  private value: string | null = randomBytes(32).toString('base64url');

  /** Jeton courant (null une fois consommé) ; exposé pour l'affichage dans les logs et les tests. */
  current(): string | null {
    return this.value;
  }

  verify(candidate: string): boolean {
    if (this.value === null) return false;
    const expected = Buffer.from(this.value);
    const given = Buffer.from(candidate);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  consume(): void {
    this.value = null;
  }
}

/** Au moins un compte dans la table `users` du projet. */
export function hasUsers(db: Database): boolean {
  return db.prepare('SELECT 1 FROM users LIMIT 1').get() !== undefined;
}

/** Écrit le jeton dans les logs si aucun compte n'existe (format parsable par le smoke test). */
export function announceSetupToken(
  db: Database,
  token: SetupToken,
  log: (msg: string) => void,
): void {
  const value = token.current();
  if (value === null || hasUsers(db)) return;
  log(`Aucun compte : ouvrez l'application pour créer le premier compte (setup token: ${value})`);
}
