import { describe, expect, it } from 'vitest';

import { createMailer, readSmtpConfig } from './mailer.js';

describe('readSmtpConfig', () => {
  it('retourne null sans SMTP_HOST', () => {
    expect(readSmtpConfig({ SMTP_USER: 'a@b.fr' })).toBeNull();
  });

  it('retourne null sans expéditeur (ni SMTP_FROM ni SMTP_USER)', () => {
    expect(readSmtpConfig({ SMTP_HOST: 'smtp.test' })).toBeNull();
  });

  it('applique les défauts : port 587, non sécurisé, expéditeur = SMTP_USER', () => {
    expect(
      readSmtpConfig({ SMTP_HOST: 'smtp.test', SMTP_USER: 'me@test.fr', SMTP_PASS: 'p' }),
    ).toEqual({
      host: 'smtp.test',
      port: 587,
      secure: false,
      user: 'me@test.fr',
      pass: 'p',
      from: 'me@test.fr',
    });
  });

  it('le port 465 active SMTP_SECURE par défaut', () => {
    const config = readSmtpConfig({ SMTP_HOST: 'h', SMTP_PORT: '465', SMTP_FROM: 'x@y.fr' });
    expect(config?.port).toBe(465);
    expect(config?.secure).toBe(true);
  });

  it('SMTP_SECURE explicite l’emporte sur le port', () => {
    expect(
      readSmtpConfig({
        SMTP_HOST: 'h',
        SMTP_PORT: '465',
        SMTP_SECURE: 'false',
        SMTP_FROM: 'x@y.fr',
      })?.secure,
    ).toBe(false);
    expect(
      readSmtpConfig({ SMTP_HOST: 'h', SMTP_PORT: '587', SMTP_SECURE: 'true', SMTP_FROM: 'x@y.fr' })
        ?.secure,
    ).toBe(true);
  });

  it('SMTP_FROM l’emporte sur SMTP_USER', () => {
    expect(
      readSmtpConfig({ SMTP_HOST: 'h', SMTP_USER: 'u@y.fr', SMTP_FROM: 'noreply@y.fr' })?.from,
    ).toBe('noreply@y.fr');
  });
});

describe('createMailer', () => {
  it('n’est pas configuré sans variables SMTP et refuse d’envoyer', async () => {
    const mailer = createMailer({});
    expect(mailer.isConfigured()).toBe(false);
    await expect(mailer.send({ to: 'a@b.fr', subject: 's', text: 't' })).rejects.toThrow();
  });

  it('est configuré avec SMTP_HOST et un expéditeur', () => {
    expect(createMailer({ SMTP_HOST: 'smtp.test', SMTP_FROM: 'a@b.fr' }).isConfigured()).toBe(true);
  });
});
