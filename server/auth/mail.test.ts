import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { createMailTexts, mailDisplayName, renderMailText } from './mail.js';

const BRAND = { appName: 'TestCtrl', headerColor: '#0f172a', buttonColor: '#0284c7' };
const LINK = 'https://app.test/reset-password?token=abc&x=1';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-'));
afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

describe('mailDisplayName', () => {
  it('ajoute APP_INSTANCE au nom de l’appli', () => {
    expect(mailDisplayName('ShelfCtrl', { APP_INSTANCE: ' Dev ' })).toBe('ShelfCtrl Dev');
  });

  it('garde le nom seul sans APP_INSTANCE ou s’il est vide', () => {
    expect(mailDisplayName('ShelfCtrl', {})).toBe('ShelfCtrl');
    expect(mailDisplayName('ShelfCtrl', { APP_INSTANCE: '  ' })).toBe('ShelfCtrl');
  });
});

describe('createMailTexts', () => {
  it('réinitialisation en français : objet, texte et HTML avec le bouton', () => {
    const mail = createMailTexts(BRAND, { APP_INSTANCE: 'Dev' }).reset('fr', LINK, 30);

    expect(mail.subject).toBe('TestCtrl Dev : réinitialisation du mot de passe');
    expect(mail.text).toContain(`Choisir un nouveau mot de passe :\n${LINK}`);
    expect(mail.text).toContain('valable 30 minutes');
    expect(mail.html).toContain('<html lang="fr">');
    expect(mail.html).toContain('TestCtrl Dev</td>');
    expect(mail.html).toContain('href="https://app.test/reset-password?token=abc&amp;x=1"');
    expect(mail.html).toContain('background:#0284c7');
    expect(mail.html).toContain('<!--[if mso]><table role="presentation" width="480"');
    expect(mail.html).not.toContain('cid:');
    expect(mail.attachments).toBeUndefined();
  });

  it('réinitialisation en anglais, sans instance', () => {
    const mail = createMailTexts(BRAND, {}).reset('en', LINK, 30);

    expect(mail.subject).toBe('TestCtrl: password reset');
    expect(mail.text).toContain('Hello,');
    expect(mail.text).toContain(`Choose a new password:
${LINK}`);
    expect(mail.html).toContain('<html lang="en">');
    expect(mail.html).toContain('Choose a new password');
  });

  it('joint le logo en image intégrée', () => {
    const logoPath = path.join(tmpDir, 'logo.png');
    fs.writeFileSync(logoPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const mail = createMailTexts({ ...BRAND, logoPath }, {}).reset('fr', LINK, 30);

    expect(mail.attachments).toEqual([
      expect.objectContaining({ cid: 'logo@ctrl-shared', contentType: 'image/png' }),
    ]);
    expect(mail.html).toContain('src="cid:logo@ctrl-shared"');
  });

  it('se passe du logo s’il est illisible', () => {
    const mail = createMailTexts(
      { ...BRAND, logoPath: path.join(tmpDir, 'absent.png') },
      {},
    ).test();

    expect(mail.attachments).toBeUndefined();
    expect(mail.html).not.toContain('cid:');
  });

  it('échappe le HTML des textes', () => {
    const mail = createMailTexts({ ...BRAND, appName: '<b>App</b>' }, {}).test();

    expect(mail.html).toContain('&lt;b&gt;App&lt;/b&gt;');
    expect(mail.html).not.toContain('<b>App</b>');
  });

  it('e-mail de test bilingue, sans bouton', () => {
    const mail = createMailTexts(BRAND, { APP_INSTANCE: 'Dev' }).test();

    expect(mail.subject).toBe('TestCtrl Dev : E-mail de test / Test email');
    expect(mail.text).toBe(
      "L'envoi d'e-mails depuis TestCtrl Dev fonctionne.\n\n" +
        'Sending emails from TestCtrl Dev works.\n\n' +
        'Message envoyé automatiquement par TestCtrl Dev. Sent automatically by TestCtrl Dev.',
    );
    expect(mail.html).not.toContain('<a href');
  });
});

describe('renderMailText', () => {
  it('met paragraphes, note et pied de page bout à bout', () => {
    expect(
      renderMailText({ lang: 'fr', title: 'T', paragraphs: ['a', 'b'], note: 'n', footer: 'f' }),
    ).toBe('a\n\nb\n\nn\n\nf');
  });
});
