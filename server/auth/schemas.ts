import { z } from 'zod';

/** Normalisé (espaces retirés, minuscules) : l'unicité et la recherche se font sur cette forme. */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const usernameSchema = z.string().trim().min(1).max(64);
export const newPasswordSchema = z.string().min(8).max(200);
/** Identifiant numérique en paramètre de route (compte, appareil). */
export const idParamSchema = z.coerce.number().int().positive();

export const loginSchema = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(200),
});

export const profileSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    username: usernameSchema.optional(),
    email: emailSchema.nullable().optional(),
  })
  .refine((d) => d.username !== undefined || d.email !== undefined, {
    message: 'Au moins un champ requis',
  });

export const changePasswordSchema = z.object({
  current: z.string().min(1).max(200),
  next: newPasswordSchema,
});

const totpCodeSchema = z.string().length(6);

/** Le secret à confirmer est gardé en session par `/2fa/setup` : seul le code est envoyé. */
export const enableTotpSchema = z.object({
  code: totpCodeSchema,
});

export const disableTotpSchema = z.object({
  password: z.string().min(1).max(200),
});

export const verifyTotpSchema = z.object({
  code: totpCodeSchema,
  /** Se souvenir de cet appareil pendant 30 jours. */
  remember: z.boolean().optional().default(false),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1).max(200),
  password: newPasswordSchema,
});

export const updateUserSchema = z
  .object({
    username: usernameSchema.optional(),
    password: newPasswordSchema.optional(),
    email: emailSchema.nullable().optional(),
    isAdmin: z.boolean().optional(),
  })
  .refine(
    (d) =>
      d.username !== undefined ||
      d.password !== undefined ||
      d.email !== undefined ||
      d.isAdmin !== undefined,
    { message: 'Au moins un champ requis' },
  );

/**
 * Schémas qui portent la langue (`lang`, une des langues de l'appli, la première par défaut) :
 * données initiales d'un compte créé, langue de l'e-mail du mot de passe oublié.
 */
export function createLangSchemas<L extends string>(languages: readonly [L, ...L[]]) {
  const langSchema = z.enum(languages).default(languages[0]);
  return {
    setupSchema: z.object({
      token: z.string().min(1),
      username: usernameSchema,
      password: newPasswordSchema,
      lang: langSchema,
    }),
    forgotPasswordSchema: z.object({
      identifier: z.string().trim().min(1).max(254),
      lang: langSchema,
    }),
    createUserSchema: z.object({
      username: usernameSchema,
      password: newPasswordSchema,
      email: emailSchema.nullable().optional(),
      isAdmin: z.boolean().optional(),
      lang: langSchema,
    }),
  };
}

export type LangSchemas<L extends string> = ReturnType<typeof createLangSchemas<L>>;
