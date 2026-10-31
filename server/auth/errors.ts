/** Codes d'erreur du module d'auth, avec leur message FR de repli : fusionnés dans le registre du projet. */
export const AUTH_ERROR_MESSAGES = {
  'user.not_found': 'Utilisateur introuvable',
  'user.username_taken': "Nom d'utilisateur déjà utilisé",
  'user.email_taken': 'Adresse e-mail déjà utilisée',
  'user.last_admin': 'Il doit rester au moins un administrateur',
  'user.cannot_delete_self': 'Vous ne pouvez pas supprimer votre propre compte',
  'auth.invalid_credentials': 'Identifiants invalides',
  'auth.too_many_attempts': 'Trop de tentatives. Réessayez plus tard.',
  'auth.current_password_incorrect': 'Mot de passe actuel incorrect',
  'auth.setup_done': 'La configuration initiale est déjà terminée',
  'auth.setup_token_invalid': 'Jeton de configuration invalide',
  'auth.reset_token_invalid': 'Lien de réinitialisation invalide ou expiré',
  'auth.email_missing': "Aucune adresse e-mail n'est renseignée pour ce compte",
  'auth.smtp_not_configured': "L'envoi d'e-mails n'est pas configuré sur le serveur",
  'auth.email_send_failed': "Échec de l'envoi de l'e-mail",
  'auth.totp_invalid': 'Code invalide ou expiré',
  'auth.totp_token_invalid': "Session d'authentification expirée, reconnectez-vous",
  'auth.totp_setup_expired': 'Configuration de la 2FA expirée, recommencez',
  'auth.totp_already_enabled': 'La double authentification est déjà activée',
  'auth.totp_not_enabled': "La double authentification n'est pas activée",
  'auth.device_not_found': 'Appareil mémorisé introuvable',
} as const;

/** Codes levés par le module : les siens et deux codes de base (`common.*`). */
export type AuthErrorCode =
  keyof typeof AUTH_ERROR_MESSAGES | 'common.unauthorized' | 'common.forbidden';

/**
 * Classe `HttpError` du projet (`createHttpErrors`) : le module lève ses erreurs avec, le
 * gestionnaire global du projet les traduit. Elle accepte au moins les codes du module.
 */
export type AuthHttpErrorClass = new (status: number, code: AuthErrorCode) => Error;
