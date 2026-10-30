import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { BASE_ERROR_MESSAGES, createErrorRegistry } from './apiErrors.js';
import { createErrorHandler } from './errorHandler.js';
import { createHttpErrors } from './errors.js';

const registry = createErrorRegistry({ ...BASE_ERROR_MESSAGES, 'item.not_found': 'Introuvable' });
const { HttpError, NotFoundError } = createHttpErrors(registry.renderMessage);

function setup() {
  const log = { warn: vi.fn(), error: vi.fn() };
  const app = express();
  app.use(express.json({ limit: '1kb' }));
  app.get('/missing', () => {
    throw new NotFoundError('item.not_found');
  });
  app.get('/locked', () => {
    throw new HttpError(429, 'common.forbidden');
  });
  app.post('/items', (req) => {
    z.object({ name: z.string() }).parse(req.body);
  });
  app.get('/boom', () => {
    throw new Error('panne');
  });
  app.get('/late', (_req, res, next) => {
    res.status(200).json({ ok: true });
    next(new Error('après coup'));
  });
  app.use(createErrorHandler({ HttpError, registry, log }));
  return { app, log };
}

describe('createErrorHandler', () => {
  it('répond le statut et le code d’une HttpError, journalisée en warn', async () => {
    const { app, log } = setup();

    const missing = await request(app).get('/missing');
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: { code: 'item.not_found', message: 'Introuvable' } });
    expect(log.warn).toHaveBeenCalledWith('GET /missing 404 — item.not_found');

    expect((await request(app).get('/locked')).status).toBe(429);
  });

  it('détaille une erreur Zod par champ', async () => {
    const { app } = setup();
    const res = await request(app).post('/items').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'validation.invalid',
      fields: [{ path: 'name', code: 'validation.required' }],
    });
  });

  it('code les erreurs des lecteurs de corps', async () => {
    const { app } = setup();

    const unreadable = await request(app)
      .post('/items')
      .set('Content-Type', 'application/json')
      .send('{"name":');
    expect(unreadable.status).toBe(400);
    expect(unreadable.body.error.code).toBe('common.invalid_request');

    const tooLarge = await request(app)
      .post('/items')
      .send({ name: 'x'.repeat(2000) });
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.body.error.code).toBe('common.payload_too_large');
  });

  it('répond 500 common.internal sans détail, la pile dans les logs', async () => {
    const { app, log } = setup();
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: 'common.internal', message: 'Erreur interne du serveur.' },
    });
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('GET /boom 500 — Error: panne'));
  });

  it('n’envoie rien si la réponse est déjà partie', async () => {
    const { app, log } = setup();
    const res = await request(app).get('/late');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(log.error).toHaveBeenCalled();
  });
});
