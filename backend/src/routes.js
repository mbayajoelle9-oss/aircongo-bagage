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
  trouverPoint,
  listerPoints,
  creerPoint,
  modifierPoint,
  carteEnDirect,
} from './logic.js';
import { connexion, authentifier, vueUtilisateur, creerUtilisateur, listerUtilisateurs, modifierUtilisateur } from './utilisateurs.js';
import { CONFIG, STATIONS } from './config.js';
import { capaciteVols, configurerVol, vendreEspace, listerVentes } from './capacite.js';
import { cleLecteurValide, traiterLectures } from './rfid.js';
import { rechercherVols, importerVol, synchroniserVols, listerVols } from './vols.js';

export function construireRoutes(repo, { jwtSecret, demoResetAutorise = false, fournisseurVols = null, cleLecteurRfid = null }) {
  const exiger = (headers, roles) => authentifier(repo, jwtSecret, headers, roles);
  const r = (method, path, handler) => ({ method, path, handler });
  const PERSONNEL = ['AGENT', 'ADMIN'];
  const ADMIN = ['ADMIN'];

  return [
    // ----- Connexion du personnel -----
    r('POST', '/api/auth/login', async ({ body }) => connexion(repo, jwtSecret, body)),
    r('GET', '/api/auth/me', async ({ headers }) => vueUtilisateur(await exiger(headers, PERSONNEL))),

    // ----- Passager (sans compte : réservation + nom) -----
    r('GET', '/api/suivi/:pnr', async ({ params, query }) => {
      const res = await trouverReservation(repo, params.pnr);
      verifierPassager(res, query.nom);
      return vueReservation(repo, res);
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
      await exiger(headers, PERSONNEL);
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
    r('GET', '/api/agent/reservations/:pnr', async ({ params, headers }) => {
      await exiger(headers, PERSONNEL);
      return vueReservation(repo, await trouverReservation(repo, params.pnr));
    }),
    // L'étiquette (code + QR) est émise par Air Congo, jamais par le passager.
    r('POST', '/api/agent/bagages', async ({ body, headers }) => {
      await exiger(headers, PERSONNEL);
      const res = await trouverReservation(repo, body.pnr);
      const b = await creerBagage(repo, res.pnr, { poidsKg: body.poidsKg });
      return { code: b.code, reservation: await vueReservation(repo, res) };
    }),
    r('GET', '/api/agent/points', async ({ headers }) => {
      await exiger(headers, PERSONNEL);
      return listerPoints(repo, { seulementActifs: true });
    }),
    r('POST', '/api/agent/scans', async ({ body, headers }) => {
      const u = await exiger(headers, PERSONNEL);
      if (u.role === 'AGENT') {
        if (!body.pointId) throw new HttpError(400, 'Choisissez le point de scan');
        if ((await trouverPoint(repo, body.pointId)).station !== u.station) throw new HttpError(403, 'Ce point appartient à une autre station');
      }
      return enregistrerScan(repo, {
        ...body,
        agent: u.nom, // l'agent est toujours celui qui est connecté
        station: u.role === 'AGENT' ? u.station : body.station, // un agent ne scanne que dans sa station
      });
    }),
    r('POST', '/api/agent/payer/:pnr', async ({ params, headers }) => {
      await exiger(headers, PERSONNEL);
      return payerExcedent(repo, params.pnr, 'COMPTOIR');
    }),

    // ----- Tableau de bord Air Congo (administrateur) -----
    r('GET', '/api/admin/vols', async ({ headers }) => {
      await exiger(headers, ['ADMIN']);
      return { actif: Boolean(fournisseurVols), fournisseur: fournisseurVols?.nom ?? null, vols: await listerVols(repo) };
    }),
    r('GET', '/api/admin/vols/recherche', async ({ query, headers }) => { await exiger(headers, ['ADMIN']); return rechercherVols(fournisseurVols, query); }),
    r('POST', '/api/admin/vols/importer', async ({ body, headers }) => { await exiger(headers, ['ADMIN']); return importerVol(repo, fournisseurVols, body); }),
    r('POST', '/api/admin/vols/synchroniser', async ({ headers }) => { await exiger(headers, ['ADMIN']); return synchroniserVols(repo, fournisseurVols); }),
    // Lecteurs RFID : authentifiés par une clé partagée (en-tête x-lecteur-cle), pas par un compte utilisateur.
    r('POST', '/api/rfid/lecture', async ({ body, headers }) => {
      if (!cleLecteurRfid) throw new HttpError(503, 'Lecteurs RFID non configurés (RFID_READER_KEY)');
      if (!cleLecteurValide(cleLecteurRfid, headers['x-lecteur-cle'])) throw new HttpError(401, 'Clé de lecteur invalide');
      return traiterLectures(repo, Array.isArray(body.lectures) ? body.lectures : [body]);
    }),
    r('GET', '/api/admin/capacite', async ({ headers }) => {
      await exiger(headers, ['ADMIN']);
      return { vols: await capaciteVols(repo), ventes: await listerVentes(repo) };
    }),
    r('PATCH', '/api/admin/vols/:id', async ({ params, body, headers }) => { await exiger(headers, ['ADMIN']); return configurerVol(repo, params.id, body); }),
    r('POST', '/api/agent/ventes-espace', async ({ body, headers }) => {
      const u = await exiger(headers, PERSONNEL);
      return vendreEspace(repo, { ...body, agent: u.nom });
    }),
    r('GET', '/api/admin/points', async ({ headers }) => { await exiger(headers, ['ADMIN']); return listerPoints(repo); }),
    r('GET', '/api/admin/carte', async ({ headers }) => { await exiger(headers, ['ADMIN']); return carteEnDirect(repo); }),
    r('POST', '/api/admin/points', async ({ body, headers }) => { await exiger(headers, ['ADMIN']); return creerPoint(repo, body); }),
    r('PATCH', '/api/admin/points/:id', async ({ params, body, headers }) => { await exiger(headers, ['ADMIN']); return modifierPoint(repo, params.id, body); }),
    r('GET', '/api/admin/stats', async ({ headers }) => (await exiger(headers, ADMIN), stats(repo))),
    r('GET', '/api/admin/bagages', async ({ headers }) => (await exiger(headers, ADMIN), listeBagages(repo))),
    r('GET', '/api/admin/alertes', async ({ headers }) => (await exiger(headers, ADMIN), alertes(repo))),
    r('GET', '/api/admin/litiges', async ({ headers }) => (await exiger(headers, ADMIN), litiges(repo))),
    r('PATCH', '/api/admin/litiges/:numero', async ({ params, body, headers }) => {
      await exiger(headers, ADMIN);
      return changerStatutLitige(repo, params.numero, body.statut);
    }),
    r('GET', '/api/admin/utilisateurs', async ({ headers }) => (await exiger(headers, ADMIN), listerUtilisateurs(repo))),
    r('POST', '/api/admin/utilisateurs', async ({ body, headers }) => {
      await exiger(headers, ADMIN);
      return creerUtilisateur(repo, body);
    }),
    r('PATCH', '/api/admin/utilisateurs/:id', async ({ params, body, headers }) => {
      const moi = await exiger(headers, ADMIN);
      return modifierUtilisateur(repo, moi, params.id, body);
    }),
    r('POST', '/api/admin/demo/reset', async ({ headers }) => {
      await exiger(headers, ADMIN);
      if (!demoResetAutorise) throw new HttpError(403, 'Réinitialisation désactivée (SEED_DEMO=true pour l’activer)');
      await chargerDemo(repo);
      return { ok: true };
    }),

    r('GET', '/api/config', async () => ({
      franchiseKg: CONFIG.franchiseKg,
      tarifExcedentUsd: CONFIG.tarifExcedentUsd,
      remisePrepaiement: CONFIG.remisePrepaiement,
      stations: STATIONS,
    })),
    r('GET', '/api/health', async () => ({ ok: true })),
  ];
}
