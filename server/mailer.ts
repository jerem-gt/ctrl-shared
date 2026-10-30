import nodemailer from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  isConfigured(): boolean;
  send(message: MailMessage): Promise<void>;
}

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

/** Lit la config SMTP depuis l'environnement ; null si SMTP_HOST ou l'expéditeur manque. */
export function readSmtpConfig(env: NodeJS.ProcessEnv = process.env): SmtpConfig | null {
  const host = env.SMTP_HOST?.trim();
  if (!host) return null;
  const port = Number.parseInt(env.SMTP_PORT ?? '', 10) || 587;
  const secure = env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465;
  const user = env.SMTP_USER || undefined;
  const from = env.SMTP_FROM || user;
  if (!from) return null;
  return { host, port, secure, user, pass: env.SMTP_PASS || undefined, from };
}

export function createMailer(env: NodeJS.ProcessEnv = process.env): Mailer {
  const config = readSmtpConfig(env);
  if (!config) {
    return {
      isConfigured: () => false,
      send: () => Promise.reject(new Error('SMTP non configuré')),
    };
  }
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user ? { user: config.user, pass: config.pass } : undefined,
  });
  return {
    isConfigured: () => true,
    send: async ({ to, subject, text }) => {
      await transport.sendMail({ from: config.from, to, subject, text });
    },
  };
}
