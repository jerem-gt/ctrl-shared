// Types du module d'auth. Les types de réponse sont réexportés (`export type`) par le paquet
// `shared` de chaque projet pour son client : une seule définition des formes de l'API.

/** Ligne de la table `users` (schéma commun aux projets). */
export interface User {
  id: number;
  username: string;
  email: string | null;
  password_hash: string;
  is_admin: number;
  totp_secret: string | null;
  totp_enabled: number;
  /** Dernier pas TOTP accepté (anti-rejeu), `null` avant le premier code. */
  totp_last_step: number | null;
  created_at: string;
}

/** Ligne de `password_reset_tokens` utile à la vérification d'un jeton. */
export interface ResetTokenRow {
  user_id: number;
  expires_at: number;
}

/** Journal des événements d'authentification. */
export interface AuthLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

/** Utilisateur connecté (réponse de `/api/auth/me` et de la connexion). */
export interface SessionResponse {
  id: number;
  username: string;
  email: string | null;
  isAdmin: boolean;
  totpEnabled: boolean;
}

/**
 * Réponse de la connexion : la session, ou `totpRequired` quand la 2FA est active et l'appareil
 * inconnu (le code se donne ensuite à `POST /api/auth/2fa/verify`).
 */
export type LoginResponse = SessionResponse | { totpRequired: true };

/** Activation de la 2FA : URI `otpauth://` (QR code) et secret en base32 pour la saisie manuelle. */
export interface TotpSetupResponse {
  uri: string;
  secret: string;
}

/** Appareil mémorisé (2FA sautée pendant 30 jours) ; horodatages en millisecondes. */
export interface TrustedDeviceItem {
  id: number;
  /** « Navigateur · OS » déduit du User-Agent, vide si rien n'est reconnu. */
  label: string;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
  /** L'appareil de la requête (son cookie). */
  current: boolean;
}

/** `required` : aucun compte, l'application attend la création du premier (admin). */
export interface SetupStatusResponse {
  required: boolean;
}

/** Compte vu par un admin (page Utilisateurs), avec les statistiques propres à l'appli. */
export interface UserItem<S> {
  id: number;
  username: string;
  email: string | null;
  isAdmin: boolean;
  totpEnabled: boolean;
  createdAt: string;
  stats: S;
}

/** Message d'un e-mail. */
export interface MailContent {
  subject: string;
  text: string;
}

/** Textes des e-mails, dans la langue demandée (`L` : langues de l'appli). */
export interface MailTexts<L extends string> {
  /** Lien de réinitialisation du mot de passe, valable `minutes`. */
  reset: (lang: L, link: string, minutes: number) => MailContent;
  /** E-mail de test (la langue du compte n'est pas connue). */
  test: () => MailContent;
}
