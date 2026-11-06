import fs from 'node:fs';

import type { MailAttachment, MailMessage } from '../mailer.js';

/** Message d'un e-mail : texte seul, ou HTML avec sa version texte (et ses images intégrées). */
export type MailContent = Omit<MailMessage, 'to'>;

/** Textes des e-mails, dans la langue demandée (`L` : langues de l'appli). */
export interface MailTexts<L extends string> {
  /** Lien de réinitialisation du mot de passe, valable `minutes`. */
  reset: (lang: L, link: string, minutes: number) => MailContent;
  /** E-mail de test (la langue du compte n'est pas connue). */
  test: () => MailContent;
}

/** Langues des e-mails fournis par `createMailTexts`. */
export type MailLang = 'fr' | 'en';

/** Identité visuelle de l'appli dans ses e-mails. */
export interface MailBrand {
  /** Nom de l'appli, suivi de `APP_INSTANCE` s'il est défini (« ShelfCtrl Dev »). */
  appName: string;
  /** Fond du bandeau (texte blanc). */
  headerColor: string;
  /** Fond du bouton (texte blanc) et couleur des liens. */
  buttonColor: string;
  /** Logo PNG carré, joint au message (image intégrée) ; absent ou illisible : bandeau sans image. */
  logoPath?: string;
}

/** Nom affiché de l'appli : `APP_INSTANCE` (« Dev ») distingue une instance de la production. */
export function mailDisplayName(appName: string, env: NodeJS.ProcessEnv = process.env): string {
  const instance = env.APP_INSTANCE?.trim();
  return instance ? `${appName} ${instance}` : appName;
}

interface MailButton {
  label: string;
  url: string;
  /** Introduit le lien en clair, sous le bouton. */
  fallback: string;
}

/** Contenu d'un e-mail, rendu en HTML et en texte. */
interface MailBlocks {
  lang: MailLang;
  title: string;
  paragraphs: string[];
  button?: MailButton;
  note?: string;
  footer: string;
}

const LOGO_CID = 'logo@ctrl-shared';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Marge du bouton en bordures pleines, et non en `padding` : Outlook l'ignore sur un lien. */
function buttonHtml(button: MailButton, color: string): string {
  const url = escapeHtml(button.url);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 20px;">
<tr><td style="background:${color};border-radius:8px;">
<a href="${url}" style="display:inline-block;border:solid ${color};border-width:12px 24px;border-radius:8px;background:${color};color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">${escapeHtml(button.label)}</a>
</td></tr></table>`;
}

function fallbackHtml(button: MailButton, color: string): string {
  const url = escapeHtml(button.url);
  return `<p style="margin:20px 0 0;color:#64748b;font-size:13px;">${escapeHtml(button.fallback)}<br>
<a href="${url}" style="color:${color};word-break:break-all;">${url}</a></p>`;
}

/**
 * Mise en page commune : carte centrée, bandeau aux couleurs de l'appli, bouton. Tableaux et
 * styles en ligne, seuls respectés par Gmail et Outlook ; Outlook ignore `max-width` : un tableau
 * de 480 px, en commentaire conditionnel, ne s'applique qu'à lui.
 */
function renderMailHtml(
  name: string,
  brand: MailBrand,
  blocks: MailBlocks,
  logo: MailAttachment | undefined,
): string {
  const logoCell = logo
    ? `<td style="padding-right:12px;vertical-align:middle;"><img src="cid:${logo.cid}" width="40" height="40" alt="" style="display:block;border:0;border-radius:8px;"></td>`
    : '';
  const paragraphs = blocks.paragraphs
    .map((paragraph) => `<p style="margin:0 0 12px;">${escapeHtml(paragraph)}</p>`)
    .join('\n');
  const button = blocks.button ? buttonHtml(blocks.button, brand.buttonColor) : '';
  const note = blocks.note
    ? `<p style="margin:0;color:#64748b;font-size:13px;">${escapeHtml(blocks.note)}</p>`
    : '';
  const fallback = blocks.button ? fallbackHtml(blocks.button, brand.buttonColor) : '';

  return `<!doctype html>
<html lang="${blocks.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(blocks.title)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;">
<tr><td align="center" style="padding:32px 16px;">
<!--[if mso]><table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;font-family:${FONT};">
<tr><td style="background:${brand.headerColor};padding:20px 24px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
${logoCell}<td style="vertical-align:middle;color:#ffffff;font-size:18px;font-weight:700;">${escapeHtml(name)}</td>
</tr></table>
</td></tr>
<tr><td style="padding:28px 24px 24px;color:#334155;font-size:15px;line-height:1.6;">
<h1 style="margin:0 0 16px;color:#0f172a;font-size:20px;line-height:1.3;">${escapeHtml(blocks.title)}</h1>
${paragraphs}
${button}
${note}
${fallback}
</td></tr>
<tr><td style="padding:16px 24px 24px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:12px;line-height:1.5;">${escapeHtml(blocks.footer)}</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

/** Deux-points typographiques : espace avant en français. */
const COLON: Record<MailLang, string> = { fr: ' :', en: ':' };

/** Version texte du même contenu, pour les clients sans HTML. */
export function renderMailText(blocks: MailBlocks): string {
  const parts = [...blocks.paragraphs];
  if (blocks.button) {
    parts.push(`${blocks.button.label}${COLON[blocks.lang]}\n${blocks.button.url}`);
  }
  if (blocks.note) {
    parts.push(blocks.note);
  }
  parts.push(blocks.footer);
  return parts.join('\n\n');
}

const TEXTS = {
  fr: {
    resetSubject: (name: string) => `${name} : réinitialisation du mot de passe`,
    resetTitle: 'Réinitialiser votre mot de passe',
    greeting: 'Bonjour,',
    resetBody: (name: string) =>
      `Une réinitialisation du mot de passe de votre compte ${name} a été demandée.`,
    resetButton: 'Choisir un nouveau mot de passe',
    resetNote: (minutes: number) =>
      `Ce lien est valable ${minutes} minutes et ne sert qu'une fois.`,
    fallback: 'Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :',
    resetFooter:
      "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.",
    testTitle: 'E-mail de test',
    testBody: (name: string) => `L'envoi d'e-mails depuis ${name} fonctionne.`,
    footer: (name: string) => `Message envoyé automatiquement par ${name}.`,
  },
  en: {
    resetSubject: (name: string) => `${name}: password reset`,
    resetTitle: 'Reset your password',
    greeting: 'Hello,',
    resetBody: (name: string) => `A password reset was requested for your ${name} account.`,
    resetButton: 'Choose a new password',
    resetNote: (minutes: number) =>
      `This link is valid for ${minutes} minutes and can only be used once.`,
    fallback: "If the button doesn't work, copy this link into your browser:",
    resetFooter:
      'If you did not request this, you can ignore this message: your password stays unchanged.',
    testTitle: 'Test email',
    testBody: (name: string) => `Sending emails from ${name} works.`,
    footer: (name: string) => `Sent automatically by ${name}.`,
  },
} satisfies Record<MailLang, unknown>;

function readLogo(logoPath: string | undefined): MailAttachment | undefined {
  if (!logoPath) {
    return undefined;
  }
  try {
    return {
      filename: 'logo.png',
      content: fs.readFileSync(logoPath),
      contentType: 'image/png',
      cid: LOGO_CID,
    };
  } catch {
    // Logo illisible : e-mails sans logo (au projet de le signaler s'il le juge anormal).
    return undefined;
  }
}

/**
 * E-mails du module d'auth (mot de passe oublié, test), en français et en anglais, en HTML avec
 * leur version texte. Le nom affiché suit `APP_INSTANCE` (`env`), le logo est lu une fois.
 */
export function createMailTexts(
  brand: MailBrand,
  env: NodeJS.ProcessEnv = process.env,
): MailTexts<MailLang> {
  const name = mailDisplayName(brand.appName, env);
  const logo = readLogo(brand.logoPath);

  function build(subject: string, blocks: MailBlocks): MailContent {
    return {
      subject,
      text: renderMailText(blocks),
      html: renderMailHtml(name, brand, blocks, logo),
      attachments: logo ? [logo] : undefined,
    };
  }

  return {
    reset: (lang, link, minutes) => {
      const t = TEXTS[lang];
      return build(t.resetSubject(name), {
        lang,
        title: t.resetTitle,
        paragraphs: [t.greeting, t.resetBody(name)],
        button: { label: t.resetButton, url: link, fallback: t.fallback },
        note: t.resetNote(minutes),
        footer: t.resetFooter,
      });
    },
    // Langue du compte inconnue : bilingue.
    test: () =>
      build(`${name} : ${TEXTS.fr.testTitle} / ${TEXTS.en.testTitle}`, {
        lang: 'fr',
        title: `${TEXTS.fr.testTitle} · ${TEXTS.en.testTitle}`,
        paragraphs: [TEXTS.fr.testBody(name), TEXTS.en.testBody(name)],
        footer: `${TEXTS.fr.footer(name)} ${TEXTS.en.footer(name)}`,
      }),
  };
}
