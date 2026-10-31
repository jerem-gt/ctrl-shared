import type { Database } from 'better-sqlite3';

import type { Mailer } from '../mailer.js';
import type { FailureRateLimiter } from '../rateLimit.js';
import type { SetupToken } from '../setup.js';
import type { AuthHttpErrorClass } from './errors.js';
import type { AuthLogger, MailTexts } from './types.js';
import type { UserStatsProvider } from './usersRepo.js';

/**
 * Hook de suppression d'un compte, appelé dans la transaction, avant la suppression (les données
 * du compte sont encore lisibles). Il peut renvoyer un nettoyage asynchrone (fichiers), lancé
 * après la validation de la transaction.
 */
export type UserDeletedHook = (userId: number) => (() => Promise<void>) | void;

/** Options du module d'auth : ce qui est propre à chaque appli. */
export interface AuthModuleOptions<L extends string, S> {
  /** Nom affiché (émetteur TOTP) et graine du hash factice : `ShelfCtrl`, `CashCtrl`. */
  appName: string;
  /** Classe `HttpError` du projet : les erreurs du module passent par son gestionnaire global. */
  HttpError: AuthHttpErrorClass;
  /** Cookie de session (`express-session`), effacé à la déconnexion. */
  sessionCookie: string;
  /** Cookie « se souvenir de cet appareil », propre à l'appli (cookies partagés sur le NAS). */
  deviceCookie: string;
  /** Langues de l'appli, la première par défaut (`['fr']`, `['fr', 'en']`). */
  languages: readonly [L, ...L[]];
  /** Textes des e-mails (réinitialisation par langue, test). */
  mailTexts: MailTexts<L>;
  /** Statistiques d'un compte affichées sur la page Utilisateurs. */
  userStats: UserStatsProvider<S>;
  /** Appelé dans la transaction de création d'un compte (données initiales…). */
  onUserCreated?: (db: Database, userId: number, lang: L) => void;
  onUserDeleted?: UserDeletedHook;
  /** Cookie d'appareil `Secure` derrière HTTPS (SECURE_COOKIE=true). */
  secureCookies?: boolean;
  mailer?: Mailer;
  setupToken?: SetupToken;
  /** URL publique de l'application (sans slash final), pour les liens des e-mails. */
  appUrl?: string;
  /** Journal des événements d'authentification (la console par défaut). */
  log?: AuthLogger;
  /** Limiteur des échecs (tests : horloge maîtrisée). */
  limiter?: FailureRateLimiter;
}
