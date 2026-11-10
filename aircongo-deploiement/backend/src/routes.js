// Table de routes indépendante du framework : { method, path, handler }.
// Express (app.js) n'est qu'un adaptateur très fin autour de cette table.
import {
  HttpError,
  trouverReservation,
  trouverBagage,
  verifierPassager,
  vueReservation,
  vueBagage,
  calculExcedent,
  creerBagage,
  enregistrerScan,
  payerExcedent,
  creerLitige,
  changerStatutLitige,
  listeBagages,
  alertes,
  stats,
  litiges,
  chargerDemo,
} from './logic.js';
import { CONFIG } from './config.js';

export function construireRoutes(repo, { agentKey, adminKey, demoResetAutorise = false }) {
  const exiger = (headers, roles) => {
    const k = headers['x-api-key'];
    const ok = (roles.includes('agent') && agentKey && k === agentKey) || (roles.includes('admin') && adminKey && k === adminKey);
    if (!ok) throw new HttpError(401, 'Clé d’accès invalide');
  };
  const r = (method, path, handler) => ({ method, path, handler });

  return [
    // ----- Passager (sans compte : réservation + nom) -----
    r('GET', '/api/suivi/:pnr', async ({ params, query }) => {
      const res = await trouverReservation(repo, params.pnr);
      verifierPassager(res, query.nom);
      return vueReservation(repo, res);
    }),
    r('POST', '/api/suivi/:pnr/bagages', async ({ params, body }) => {
      const res = await trouverReservation(repo, params.pnr);
      verifierPassager(res, body.nom);
      const b = await creerBagage(repo, res.pnr, { poidsKg: body.poidsKg });
      return { code: b.code, reservation: await vueReservation(repo, res) };
    }),
    r('POST', '/api/suivi/:pnr/payer', async ({ params, body }) => {
      const res = await trouverReservation(repo, params.pnr);
      verifierPassager(res, body.nom);
      return payerExcedent(repo, res.pnr, 'EN_LIGNE'); // paiement simulé en démo
    }),
    r('POST', '/api/suivi/:pnr/litiges', async ({ params, body }) => {
      const res = await trouverReservation(repo, params.pnr);
      verifierPassager(res, body.nom);
      const b = await trouverBagage(repo, body.code);
      if (b.reservationId !== res.id) throw new HttpError(403, 'Ce bagage n’appartient pas à cette réservation');
      return creerLitige(repo, body);
    }),

    // ----- Agent en station -----
    r('GET', '/api/agent/bagages/:code', async ({ params, headers }) => {
      exiger(headers, ['agent', 'admin']);
      const b = await trouverBagage(repo, params.code);
      const res = await repo.findOne('reservations', { id: b.reservationId });
      return {
        bagage: await vueBagage(repo, b),
        passager: res.nom,
        pnr: res.pnr,
        classe: res.classe,
        excedent: await calculExcedent(repo, res),
      };
    }),
    r('POST', '/api/agent/scans', async ({ body, headers }) => {
      exiger(headers, ['agent', 'admin']);
      return enregistrerScan(repo, body);
    }),
    r('POST', '/api/agent/payer/:pnr', async ({ params, headers }) => {
      exiger(headers, ['agent', 'admin']);
      return payerExcedent(repo, params.pnr, 'COMPTOIR');
    }),

    // ----- Tableau de bord Air Congo -----
    r('GET', '/api/admin/stats', async ({ headers }) => (exiger(headers, ['admin']), stats(repo))),
    r('GET', '/api/admin/bagages', async ({ headers }) => (exiger(headers, ['admin']), listeBagages(repo))),
    r('GET', '/api/admin/alertes', async ({ headers }) => (exiger(headers, ['admin']), alertes(repo))),
    r('GET', '/api/admin/litiges', async ({ headers }) => (exiger(headers, ['admin']), litiges(repo))),
    r('PATCH', '/api/admin/litiges/:numero', async ({ params, body, headers }) => {
      exiger(headers, ['admin']);
      return changerStatutLitige(repo, params.numero, body.statut);
    }),
    r('POST', '/api/admin/demo/reset', async ({ headers }) => {
      exiger(headers, ['admin']);
      if (!demoResetAutorise) throw new HttpError(403, 'Réinitialisation désactivée (SEED_DEMO=true pour l’activer)');
      await chargerDemo(repo);
      return { ok: true };
    }),

    r('GET', '/api/config', async () => ({
      franchiseKg: CONFIG.franchiseKg,
      tarifExcedentUsd: CONFIG.tarifExcedentUsd,
      remisePrepaiement: CONFIG.remisePrepaiement,
    })),
    r('GET', '/api/health', async () => ({ ok: true })),
  ];
}
