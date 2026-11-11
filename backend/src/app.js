import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { construireRoutes } from './routes.js';
import { HttpError } from './logic.js';

export function creerApp(repo, options) {
  const app = express();
  app.set('trust proxy', 1); // Render est derrière un proxy
  app.disable('x-powered-by');
  app.use(helmet());

  const origines = (options.frontendUrl || '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
  app.use(
    cors({
      origin: origines.length ? origines : false, // aucune origine autorisée si FRONTEND_URL est vide
      methods: ['GET', 'POST', 'PATCH'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  // Anti-devinette : connexion du personnel et suivi passager (réservation + nom)
  app.use(
    '/api/auth/login',
    rateLimit({ windowMs: 15 * 60_000, limit: 15, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false, message: { erreur: 'Trop de tentatives, réessayez dans quelques minutes' } }),
  );
  app.use('/api/suivi', rateLimit({ windowMs: 60_000, limit: 40, standardHeaders: true, legacyHeaders: false }));
  app.use('/api/radar', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));
  app.use('/api/espace', rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { erreur: 'Trop de demandes, réessayez dans une minute' } }));
  app.use('/api/rfid', rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false }));
  app.use('/api/agent', rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false }));
  app.use('/api/admin', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));

  for (const route of construireRoutes(repo, options)) {
    app[route.method.toLowerCase()](route.path, async (req, res, next) => {
      try {
        const sortie = await route.handler({
          params: req.params,
          body: req.body ?? {},
          query: req.query,
          headers: req.headers,
        });
        res.set('Cache-Control', 'no-store').json(sortie);
      } catch (e) {
        next(e);
      }
    });
  }

  app.use((req, res) => res.status(404).json({ erreur: 'Route inconnue' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ erreur: err.message });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ erreur: 'JSON invalide' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ erreur: 'Requête trop volumineuse' });
    if (err?.code === 11000) return res.status(409).json({ erreur: 'Conflit : doublon' });
    console.error(err);
    res.status(500).json({ erreur: 'Erreur interne' });
  });
  return app;
}
