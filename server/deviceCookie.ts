import { randomBytes } from 'node:crypto';

import type { Request, Response } from 'express';

import { readCookie } from './cookies.js';
import { sha256Hex } from './crypto.js';
import type { TrustedDevicesRepo } from './trustedDevices.js';
import { deviceLabel } from './userAgent.js';

export const DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface DeviceCookieOptions {
  /** Nom propre à l'appli (`shelfctrl_device`…) : cookies et noms d'hôte sont partagés sur le NAS. */
  name: string;
  /** `SECURE_COOKIE=true` : cookie `Secure`, mais seulement si la requête est en HTTPS. */
  secure: boolean;
}

/** Cookie « se souvenir de cet appareil » : un seul par navigateur, lu par les seules routes d'auth. */
export function createDeviceCookies(devices: TrustedDevicesRepo, options: DeviceCookieOptions) {
  const { name } = options;
  // Comme le cookie de session (secure: 'auto') : Secure seulement si la requête est en HTTPS.
  const cookieOptions = (req: Request) => ({
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: options.secure && req.secure,
    path: '/api/auth',
  });

  /** Empreinte du jeton porté par la requête, `undefined` sans cookie. */
  const currentHash = (req: Request): string | undefined => {
    const token = readCookie(req.headers.cookie, name);
    return token ? sha256Hex(token) : undefined;
  };

  const clear = (req: Request, res: Response) => {
    res.clearCookie(name, cookieOptions(req));
  };

  return {
    currentHash,
    clear,

    /** Vrai si le cookie de la requête désigne un appareil (non expiré ou non) du compte. */
    belongsTo: (req: Request, userId: number): boolean => {
      const hash = currentHash(req);
      return hash !== undefined && devices.getByHash(hash)?.user_id === userId;
    },

    /** Mémorise l'appareil courant ; remplace l'éventuel appareil déjà porté par le cookie. */
    remember: (req: Request, res: Response, userId: number): void => {
      const now = Date.now();
      devices.purgeExpired(now);
      const previous = currentHash(req);
      if (previous) {
        devices.deleteByHash(previous);
      }
      const token = randomBytes(32).toString('base64url');
      devices.insert(
        userId,
        sha256Hex(token),
        deviceLabel(req.get('user-agent')),
        now,
        now + DEVICE_TTL_MS,
      );
      res.cookie(name, token, { ...cookieOptions(req), maxAge: DEVICE_TTL_MS });
    },

    /**
     * Vrai si le cookie désigne un appareil valide du compte. Un cookie mort est effacé ; celui
     * d'un autre compte est conservé (navigateur partagé).
     */
    isTrusted: (req: Request, res: Response, userId: number): boolean => {
      const hash = currentHash(req);
      if (!hash) {
        return false;
      }
      const now = Date.now();
      devices.purgeExpired(now);
      const device = devices.getByHash(hash);
      if (device === undefined) {
        clear(req, res);
        return false;
      }
      if (device.user_id !== userId) {
        return false;
      }
      devices.touch(device.id, now);
      return true;
    },
  };
}

export type DeviceCookies = ReturnType<typeof createDeviceCookies>;
