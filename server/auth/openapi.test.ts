import { describe, expect, it } from 'vitest';

import { createAuthApp } from '../testing/authApp.js';
import { createAuthOpenApiPaths } from './openapi.js';

interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
  handle: { stack?: Layer[] };
}

/** Routes d'un routeur Express 5, sous-routeurs montés à la racine compris (`METHOD /chemin`). */
function routesOf(router: { stack?: Layer[] }, prefix: string): string[] {
  return (router.stack ?? []).flatMap((layer) => {
    if (layer.route) {
      const path = `${prefix}${layer.route.path}`.replace(/\/$/, '').replaceAll(/:(\w+)/g, '{$1}');
      return Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${path}`);
    }
    return layer.handle.stack ? routesOf(layer.handle, prefix) : [];
  });
}

const paths = createAuthOpenApiPaths({ languages: ['fr', 'en'], tags: { auth: 'A', users: 'U' } });
const documented = Object.entries(paths).flatMap(([path, item]) =>
  Object.keys(item).map((method) => `${method.toUpperCase()} ${path}`),
);

describe('createAuthOpenApiPaths', () => {
  it('documente exactement les routes du module d’auth', () => {
    const { authModule } = createAuthApp();
    const routes = [
      ...routesOf(authModule.authRouter as never, '/api/auth'),
      ...routesOf(authModule.usersRouter as never, '/api/users'),
    ];

    expect(documented.toSorted()).toEqual(routes.toSorted());
  });

  it('protège par la session les routes qui l’exigent, et elles seules', () => {
    const open = Object.entries(paths).flatMap(([path, item]) =>
      Object.entries(item)
        .filter(([, op]) => !('security' in op))
        .map(([method]) => `${method.toUpperCase()} ${path}`),
    );

    expect(open.toSorted()).toEqual(
      [
        'GET /api/auth/me',
        'GET /api/auth/setup',
        'POST /api/auth/2fa/verify',
        'POST /api/auth/login',
        'POST /api/auth/logout',
        'POST /api/auth/password/forgot',
        'POST /api/auth/password/reset',
        'POST /api/auth/setup',
      ].toSorted(),
    );
  });

  it('applique les tags et les langues de l’appli', () => {
    const fr = createAuthOpenApiPaths({
      languages: ['fr'],
      tags: { auth: 'Auth', users: 'Comptes' },
    });
    const setup = fr['/api/auth/setup'].post.requestBody.content['application/json']
      .schema as unknown as {
      properties: { lang: { enum: string[] } };
    };

    expect(fr['/api/users'].get.tags).toEqual(['Comptes']);
    expect(fr['/api/auth/me'].get.tags).toEqual(['Auth']);
    expect(setup.properties.lang.enum).toEqual(['fr']);
  });
});
