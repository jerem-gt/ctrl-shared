import {
  body,
  errorResponse,
  pId,
  r200,
  r201,
  r204,
  r400,
  r401,
  r403,
  r404,
  r409,
  r429,
  sessionAuth,
} from '../openapi.js';
import {
  changePasswordSchema,
  createLangSchemas,
  disableTotpSchema,
  enableTotpSchema,
  loginSchema,
  profileSchema,
  resetPasswordSchema,
  updateUserSchema,
  verifyTotpSchema,
} from './schemas.js';

export interface AuthOpenApiOptions<L extends string> {
  /** Langues de l'appli (les mêmes que `AuthModuleOptions.languages`). */
  languages: readonly [L, ...L[]];
  /** Tags Swagger, dans la langue des autres tags du projet. */
  tags: { auth: string; users: string };
}

/**
 * Spec OpenAPI des routes du module d'auth, montées sur `/api/auth` et `/api/users` : à étendre
 * dans les `paths` du projet (`...createAuthOpenApiPaths(…)`), qui déclare `errorSchema` et
 * `sessionCookieScheme` dans ses `components`. `openapi.test.ts` vérifie qu'elle couvre chaque
 * route des routeurs.
 */
export function createAuthOpenApiPaths<L extends string>(options: AuthOpenApiOptions<L>) {
  const { setupSchema, forgotPasswordSchema, createUserSchema } = createLangSchemas(
    options.languages,
  );
  const auth = [options.tags.auth];
  const users = [options.tags.users];
  return {
    '/api/auth/login': {
      post: {
        tags: auth,
        summary: 'Connexion (`{ totpRequired: true }` si la 2FA attend un code)',
        requestBody: body(loginSchema),
        responses: {
          ...r200('Session started or TOTP code required'),
          ...r400,
          ...r401,
          ...r429,
        },
      },
    },
    '/api/auth/2fa/verify': {
      post: {
        tags: auth,
        summary:
          'Second temps de la connexion : code TOTP (à usage unique), « se souvenir » 30 jours',
        requestBody: body(verifyTotpSchema),
        responses: {
          ...r200('Session started'),
          ...r400,
          401: errorResponse('Invalid code or expired login'),
          ...r429,
        },
      },
    },
    '/api/auth/2fa/setup': {
      post: {
        tags: auth,
        summary: 'Proposer un secret TOTP (QR code), gardé en session jusqu’à sa confirmation',
        security: sessionAuth,
        responses: { ...r200(), ...r401, 409: errorResponse('2FA already enabled') },
      },
    },
    '/api/auth/2fa/enable': {
      post: {
        tags: auth,
        summary: 'Activer la 2FA avec un premier code (révoque les appareils mémorisés)',
        security: sessionAuth,
        requestBody: body(enableTotpSchema),
        responses: {
          ...r204,
          400: errorResponse('Validation error or no pending secret'),
          401: errorResponse('Invalid code'),
          409: errorResponse('2FA already enabled'),
        },
      },
    },
    '/api/auth/2fa/disable': {
      post: {
        tags: auth,
        summary: 'Désactiver la 2FA (mot de passe actuel requis, révoque les appareils)',
        security: sessionAuth,
        requestBody: body(disableTotpSchema),
        responses: { ...r204, ...r400, ...r401, 409: errorResponse('2FA not enabled'), ...r429 },
      },
    },
    '/api/auth/devices': {
      get: {
        tags: auth,
        summary: 'Appareils mémorisés du compte',
        security: sessionAuth,
        responses: { ...r200(), ...r401 },
      },
      delete: {
        tags: auth,
        summary: 'Oublier tous les appareils mémorisés',
        security: sessionAuth,
        responses: { ...r204, ...r401 },
      },
    },
    '/api/auth/devices/{id}': {
      delete: {
        tags: auth,
        summary: 'Oublier un appareil mémorisé',
        security: sessionAuth,
        parameters: pId,
        responses: { ...r204, ...r400, ...r401, ...r404 },
      },
    },
    '/api/auth/setup': {
      get: {
        tags: auth,
        summary: 'Premier démarrage : création du premier compte attendue ?',
        responses: r200(),
      },
      post: {
        tags: auth,
        summary: 'Créer le premier compte (admin), avec le jeton écrit dans les logs',
        requestBody: body(setupSchema),
        responses: {
          ...r200('Session started'),
          ...r400,
          403: errorResponse('Invalid setup token'),
          409: errorResponse('An account already exists'),
          ...r429,
        },
      },
    },
    '/api/auth/profile': {
      patch: {
        tags: auth,
        summary: 'Modifier son nom ou son e-mail (mot de passe actuel requis)',
        security: sessionAuth,
        requestBody: body(profileSchema),
        responses: { ...r200(), ...r400, ...r401, ...r409, ...r429 },
      },
    },
    '/api/auth/change-password': {
      post: {
        tags: auth,
        summary: 'Changer son mot de passe (ferme les autres sessions)',
        security: sessionAuth,
        requestBody: body(changePasswordSchema),
        responses: { ...r204, ...r400, ...r401, ...r429 },
      },
    },
    '/api/auth/password/forgot': {
      post: {
        tags: auth,
        summary:
          'Mot de passe oublié : lien par e-mail (réponse identique si le compte est inconnu)',
        requestBody: body(forgotPasswordSchema),
        responses: { ...r204, ...r400, ...r429 },
      },
    },
    '/api/auth/password/reset': {
      post: {
        tags: auth,
        summary: 'Nouveau mot de passe avec le jeton reçu (ferme toutes les sessions)',
        requestBody: body(resetPasswordSchema),
        responses: {
          ...r204,
          400: errorResponse('Validation error or invalid token'),
          ...r429,
        },
      },
    },
    '/api/auth/test-email': {
      post: {
        tags: auth,
        summary: "Envoyer un e-mail de test à l'admin connecté",
        security: sessionAuth,
        responses: {
          ...r204,
          400: errorResponse('No email on the account'),
          ...r401,
          ...r403,
          502: errorResponse('Sending failed'),
          503: errorResponse('SMTP not configured'),
        },
      },
    },
    '/api/auth/logout': {
      post: {
        tags: auth,
        summary: 'Déconnexion',
        responses: r204,
      },
    },
    '/api/auth/me': {
      get: {
        tags: auth,
        summary: 'Utilisateur connecté',
        responses: { ...r200(), ...r401 },
      },
    },
    '/api/users': {
      get: {
        tags: users,
        summary: 'Liste des comptes (statistiques propres à l’appli sous `stats`)',
        security: sessionAuth,
        responses: { ...r200(), ...r401, ...r403 },
      },
      post: {
        tags: users,
        summary: 'Créer un compte',
        security: sessionAuth,
        requestBody: body(createUserSchema),
        responses: { ...r201, ...r400, ...r401, ...r403, ...r409 },
      },
    },
    '/api/users/{id}': {
      patch: {
        tags: users,
        summary: 'Modifier un compte (nom, e-mail, mot de passe, rôle admin)',
        security: sessionAuth,
        parameters: pId,
        requestBody: body(updateUserSchema),
        responses: { ...r200(), ...r400, ...r401, ...r403, ...r404, ...r409 },
      },
      delete: {
        tags: users,
        summary: 'Supprimer un compte et ses données',
        security: sessionAuth,
        parameters: pId,
        responses: { ...r204, ...r400, ...r401, ...r403, ...r404, ...r409 },
      },
    },
    '/api/users/{id}/2fa': {
      delete: {
        tags: users,
        summary: 'Désactiver la 2FA d’un compte (téléphone perdu), révoque ses appareils',
        security: sessionAuth,
        parameters: pId,
        responses: {
          ...r204,
          ...r400,
          ...r401,
          ...r403,
          ...r404,
          409: errorResponse('2FA not enabled'),
        },
      },
    },
  };
}
