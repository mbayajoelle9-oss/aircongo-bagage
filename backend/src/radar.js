// Radar des vols : position des avions, état de la soute, bagages à bord, achat d'espace en ligne.
import { randomBytes } from 'node:crypto';
import { CONFIG, COMPAGNIES, OPERATEURS_MM, coordAeroport } from './config.js';
import { HttpError, listeBagages } from './logic.js';
import { capaciteVols } from './capacite.js';

const r2 = (n) => Math.round(n * 100) / 100;
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function distanceKm(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
export function cap(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}
// Point situé à la fraction f du grand cercle a → b.
export function interpoler(a, b, f) {
  const d = distanceKm(a, b) / 6371;
  if (d < 1e-9) return { lat: a.lat, lon: a.lon };
  const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(rad(a.lat)) * Math.cos(rad(a.lon)) + B * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon));
  const y = A * Math.cos(rad(a.lat)) * Math.sin(rad(a.lon)) + B * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon));
  const z = A * Math.sin(rad(a.lat)) + B * Math.sin(rad(b.lat));
  return { lat: r2(deg(Math.atan2(z, Math.hypot(x, y)))), lon: r2(deg(Math.atan2(y, x))) };
}

// Horaires de départ/arrivée (ms). Heures locales lues comme UTC+1 (Kinshasa) quand seul « HH:mm » est connu.
function horaires(v, pA, pB) {
  const retard = (v.retardMin ?? 0) * 60000;
  let dep = null, arr = null;
  if (v.departTs) { dep = Date.parse(v.departTs); arr = v.arriveeTs ? Date.parse(v.arriveeTs) : null; }
  else if (v.date && v.heureDepart) {
    dep = Date.parse(`${v.date}T${v.heureDepart}:00+01:00`);
    if (v.heureArrivee) { arr = Date.parse(`${v.date}T${v.heureArrivee}:00+01:00`); if (arr <= dep) arr += 86400000; }
  }
  if (!Number.isFinite(dep)) return null;
  if (!Number.isFinite(arr)) arr = dep + (distanceKm(pA, pB) / 750 * 60 + 20) * 60000;
  return { dep: dep + retard, arr: arr + retard };
}

export const LIBELLES_PHASE = { AU_SOL: 'Au sol', EN_VOL: 'En vol', ARRIVE: 'Arrivé', ANNULE: 'Annulé' };

function etatVol(v, now) {
  const pA = coordAeroport(v.depart), pB = coordAeroport(v.arrivee);
  if (!pA || !pB) return null; // aéroport inconnu : impossible de placer l'avion
  const h = horaires(v, pA, pB);
  let phase, f;
  const frac = h ? (now - h.dep) / (h.arr - h.dep) : 0.5;
  if (v.statut === 'ANNULE') { phase = 'ANNULE'; f = 0; }
  else if (v.statut === 'ATTERRI') { phase = 'ARRIVE'; f = 1; }
  else if (v.statut === 'EN_VOL') { phase = 'EN_VOL'; f = Math.min(0.97, Math.max(0.03, frac)); }
  else if (!h) { phase = 'AU_SOL'; f = 0; }
  else if (now < h.dep) { phase = 'AU_SOL'; f = 0; }
  else if (now < h.arr) { phase = 'EN_VOL'; f = Math.min(0.97, Math.max(0.03, frac)); }
  else { phase = 'ARRIVE'; f = 1; }
  return { phase, progression: r2(f), position: interpoler(pA, pB, f), cap: Math.round(cap(pA, pB)), h, pA, pB };
}

async function lignesRadar(repo, now) {
  const [vols, capa, reservations] = await Promise.all([repo.find('vols'), capaciteVols(repo), repo.find('reservations')]);
  const capParId = new Map(capa.map((c) => [c.id, c]));
  const out = [];
  for (const v of vols) {
    const e = etatVol(v, now);
    if (!e) continue;
    // Fenêtre d'affichage : de 12 h avant le départ à 3 h après l'arrivée (les vols sans horaire restent visibles).
    if (e.h && (now < e.h.dep - 12 * 3600000 || now > e.h.arr + 3 * 3600000)) continue;
    const c = capParId.get(v.id);
    out.push({
      id: v.id, numero: v.numero, compagnie: v.compagnie ?? null, depart: v.depart, arrivee: v.arrivee,
      villeDepart: e.pA.ville ?? e.pA.nom, villeArrivee: e.pB.ville ?? e.pB.nom,
      heureDepart: v.heureDepart ?? null, departTs: e.h ? new Date(e.h.dep).toISOString() : null, arriveeTs: e.h ? new Date(e.h.arr).toISOString() : null,
      statut: v.statut ?? null, phase: e.phase, libellePhase: LIBELLES_PHASE[e.phase], progression: e.progression,
      position: e.position, cap: e.cap, trace: [{ lat: e.pA.lat, lon: e.pA.lon }, { lat: e.pB.lat, lon: e.pB.lon }],
      passagers: reservations.filter((x) => x.volId === v.id).length,
      nbBagages: c.nbBagages, bagagesKg: c.bagagesKg, fretKg: c.fretKg, capaciteKg: c.capaciteKg,
      libreKg: c.libreKg, remplissagePct: c.remplissagePct, prixUsdKg: c.prixReventeUsdKg,
      achatOuvert: e.phase === 'AU_SOL' && c.libreKg > 0,
    });
  }
  return out.sort((a, b) => (a.departTs ?? '').localeCompare(b.departTs ?? ''));
}

export async function radarVols(repo, { compagnie, now = Date.now() } = {}) {
  let l = await lignesRadar(repo, now);
  const q = norm(compagnie);
  if (q) l = l.filter((v) => norm(v.compagnie).includes(q) || norm(v.numero).includes(q.replace(/ /g, '')));
  return { maj: new Date(now).toISOString(), vols: l };
}

// Fiche d'un vol. Les détails bagage (noms, codes) ne sont jamais donnés au public.
export async function ficheVol(repo, volId, { avecBagages = false, now = Date.now() } = {}) {
  const vol = (await lignesRadar(repo, now)).find((v) => v.id === String(volId ?? ''));
  if (!vol) throw new HttpError(404, 'Vol introuvable ou hors de la fenêtre d’affichage');
  if (!avecBagages) return vol;
  const sacs = (await listeBagages(repo)).filter((b) => b.vol === vol.numero && b.trajetVol?.depart === vol.depart && b.trajetVol?.arrivee === vol.arrivee);
  return {
    ...vol,
    bagages: sacs.map((b) => ({ code: b.code, passager: b.passager, pnr: b.pnr, classe: b.classe ?? null, poidsKg: b.poidsKg ?? null, statut: b.statut, libelle: b.libelle, source: b.dernierScan?.source ?? null, station: b.dernierScan?.station ?? null, ts: b.dernierScan?.ts ?? null })),
  };
}

export async function chercherCompagnies(repo, q) {
  const n = norm(q);
  const noms = new Map(COMPAGNIES.map((c) => [norm(c.nom), { nom: c.nom, code: c.code }]));
  for (const v of await repo.find('vols')) if (v.compagnie && !noms.has(norm(v.compagnie))) noms.set(norm(v.compagnie), { nom: v.compagnie, code: null });
  return [...noms.values()].filter((c) => !n || norm(c.nom).includes(n) || norm(c.code ?? '') === n).slice(0, 10);
}

const normaliserTel = (t) => {
  const c = String(t ?? '').replace(/[\s.-]/g, '');
  const m = /^(?:\+?243|0)(\d{9})$/.exec(c);
  if (!m) throw new HttpError(400, 'Numéro Mobile Money invalide (ex. 0812345678 ou +243812345678)');
  return `+243${m[1]}`;
};

// Achat d'espace en soute par un passager ou un client, payé par Mobile Money.
// Le paiement est SIMULÉ : en production, `fournisseurPaiement.initier()` appellerait un agrégateur de paiement mobile.
export async function acheterEspace(repo, { volId, kg, nom, telephone, operateur }, { now = Date.now() } = {}) {
  const vol = await ficheVol(repo, volId, { now });
  if (vol.phase !== 'AU_SOL') throw new HttpError(409, 'Ce vol a déjà décollé ou est terminé : la vente d’espace est fermée');
  const poids = Number(kg);
  if (!Number.isFinite(poids) || poids <= 0) throw new HttpError(400, 'Poids invalide');
  if (poids > CONFIG.achatMaxKg) throw new HttpError(400, `Maximum ${CONFIG.achatMaxKg} kg par achat en ligne (au-delà, contactez le comptoir)`);
  const client = String(nom ?? '').trim();
  if (client.length < 2 || client.length > 80) throw new HttpError(400, 'Votre nom est requis (2 à 80 caractères)');
  if (!OPERATEURS_MM[operateur]) throw new HttpError(400, 'Opérateur Mobile Money inconnu');
  const tel = normaliserTel(telephone);
  if (poids > vol.libreKg) throw new HttpError(409, `Espace insuffisant : ${vol.libreKg} kg libres sur ${vol.numero}`);
  const reference = `ES-${randomBytes(4).toString('hex').toUpperCase()}`;
  const vente = await repo.insert('ventesEspace', {
    volId: vol.id, numeroVol: vol.numero, kg: r2(poids), prixUsdKg: vol.prixUsdKg, montantUsd: r2(poids * vol.prixUsdKg),
    client, type: 'EN_LIGNE', agent: 'Mobile Money', telephone: tel, operateur, reference, paiement: 'SIMULE', ts: new Date(now).toISOString(),
  });
  return {
    reference, numeroVol: vol.numero, trajet: `${vol.depart} → ${vol.arrivee}`, kg: vente.kg, montantUsd: vente.montantUsd,
    operateur: OPERATEURS_MM[operateur], telephone: `${tel.slice(0, 7)}•••${tel.slice(-3)}`, paiement: 'SIMULE',
    message: 'Paiement simulé (démonstration) : aucun argent n’a été prélevé. Présentez cette référence au comptoir avec votre colis.',
  };
}
