// Récupération automatique des vols (horaires, statut, retards) auprès d'un fournisseur de données aériennes.
// Fournisseur géré : aviationstack (clé gratuite : 100 requêtes/mois). D'autres fournisseurs (Flightradar24 API,
// AeroDataBox…) se branchent en ajoutant une fonction qui renvoie le même format normalisé.
import { HttpError } from './logic.js';

const STATUTS_API = {
  scheduled: 'PREVU', active: 'EN_VOL', landed: 'ATTERRI', cancelled: 'ANNULE', incident: 'INCIDENT', diverted: 'DEROUTE',
};
export const LIBELLES_VOL = {
  PREVU: 'Prévu', RETARDE: 'Retardé', EN_VOL: 'En vol', ATTERRI: 'Atterri', ANNULE: 'Annulé', INCIDENT: 'Incident', DEROUTE: 'Dérouté',
};

const hhmm = (iso) => (typeof iso === 'string' && /T\d\d:\d\d/.test(iso) ? iso.slice(11, 16) : null); // heure locale de l'aéroport
const jour = (iso) => (typeof iso === 'string' ? iso.slice(0, 10) : null);

// Transforme une réponse aviationstack en vol normalisé.
export function normaliserAviationstack(d) {
  const dep = d.departure ?? {}, arr = d.arrival ?? {};
  const numero = String(d.flight?.iata ?? d.flight?.icao ?? '').toUpperCase();
  if (!numero || !dep.iata || !arr.iata) return null;
  const retard = Number(dep.delay) > 0 ? Number(dep.delay) : 0;
  let statut = STATUTS_API[d.flight_status] ?? 'PREVU';
  if (statut === 'PREVU' && retard >= 15) statut = 'RETARDE';
  return {
    numero,
    date: d.flight_date ?? jour(dep.scheduled),
    compagnie: d.airline?.name ?? null,
    depart: String(dep.iata).toUpperCase(),
    arrivee: String(arr.iata).toUpperCase(),
    heureDepart: hhmm(dep.scheduled),
    heureArrivee: hhmm(arr.scheduled),
    heureDepartEstimee: hhmm(dep.estimated ?? dep.actual),
    statut,
    retardMin: retard,
    terminal: dep.terminal ?? null,
    porte: dep.gate ?? null,
  };
}

export function creerFournisseurAviationstack({ cle, url = 'http://api.aviationstack.com/v1', fetchImpl = fetch }) {
  const appeler = async (params) => {
    const q = new URLSearchParams({ access_key: cle, limit: '10', ...params });
    let rep;
    try { rep = await fetchImpl(`${url}/flights?${q}`, { signal: AbortSignal.timeout(10000) }); }
    catch { throw new HttpError(502, 'Le service de données de vols est injoignable'); }
    const json = await rep.json().catch(() => null);
    if (!json || json.error) throw Object.assign(new HttpError(502, `Service de vols : ${json?.error?.message ?? 'réponse invalide'}`), { codeApi: json?.error?.code });
    return Array.isArray(json.data) ? json.data : [];
  };
  return {
    nom: 'aviationstack',
    async rechercher({ numero, date }) {
      const base = { flight_iata: numero };
      let data;
      try { data = await appeler(date ? { ...base, flight_date: date } : base); }
      catch (e) {
        // Le filtre par date est réservé aux forfaits payants : on retente sans, puis on filtre nous-mêmes.
        if (!date || !e.codeApi) throw e;
        data = await appeler(base);
      }
      const vols = data.map(normaliserAviationstack).filter(Boolean);
      return date ? vols.filter((v) => v.date === date) : vols;
    },
  };
}

// Choisit le fournisseur d'après les variables d'environnement ; null si non configuré.
export function creerFournisseur(env = process.env, fetchImpl = fetch) {
  const { FLIGHT_API_PROVIDER, FLIGHT_API_KEY, FLIGHT_API_URL } = env;
  if (!FLIGHT_API_KEY) return null;
  if (!FLIGHT_API_PROVIDER || FLIGHT_API_PROVIDER === 'aviationstack') return creerFournisseurAviationstack({ cle: FLIGHT_API_KEY, url: FLIGHT_API_URL || undefined, fetchImpl });
  throw new Error(`FLIGHT_API_PROVIDER inconnu : ${FLIGHT_API_PROVIDER} (valeur gérée : aviationstack)`);
}

function exiger(fournisseur) {
  if (!fournisseur) throw new HttpError(503, 'Récupération automatique non configurée : ajoutez FLIGHT_API_KEY dans les variables Render');
  return fournisseur;
}

const verifierNumero = (n) => {
  const v = String(n ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/.test(v)) throw new HttpError(400, 'Numéro de vol invalide (ex. KQ554)');
  return v;
};
const verifierDate = (d) => {
  if (d === undefined || d === '') return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d)) || Number.isNaN(Date.parse(d))) throw new HttpError(400, 'Date invalide (format AAAA-MM-JJ)');
  return String(d);
};

export async function rechercherVols(fournisseur, { numero, date }) {
  return exiger(fournisseur).rechercher({ numero: verifierNumero(numero), date: verifierDate(date) });
}

// Crée ou met à jour le vol (clé : numéro + date) sans toucher aux réservations déjà rattachées.
async function enregistrerVol(repo, v) {
  const existant = await repo.findOne('vols', { numero: v.numero, date: v.date });
  const doc = { ...v, source: 'API', majLe: new Date().toISOString() };
  return existant ? repo.update('vols', existant.id, doc) : repo.insert('vols', doc);
}

export async function importerVol(repo, fournisseur, { numero, date }) {
  const trouves = await rechercherVols(fournisseur, { numero, date });
  if (!trouves.length) throw new HttpError(404, 'Aucun vol trouvé pour ce numéro et cette date');
  return enregistrerVol(repo, trouves[0]);
}

// Actualise les vols déjà importés (hier et à venir), dans la limite de `max` requêtes pour ménager le forfait.
export async function synchroniserVols(repo, fournisseur, { max = 20 } = {}) {
  exiger(fournisseur);
  const hier = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const a_suivre = (await repo.find('vols')).filter((v) => v.source === 'API' && (v.date ?? '') >= hier).slice(0, max);
  const resultat = { maj: 0, erreurs: [] };
  for (const v of a_suivre) {
    try {
      const [frais] = await fournisseur.rechercher({ numero: v.numero, date: v.date });
      if (frais) { await enregistrerVol(repo, frais); resultat.maj++; }
    } catch (e) { resultat.erreurs.push(`${v.numero} : ${e.message}`); if (e.status === 502) break; }
  }
  return resultat;
}

export async function listerVols(repo) {
  const l = await repo.find('vols');
  const reservations = await repo.find('reservations');
  return l.map((v) => ({ ...v, libelleStatut: LIBELLES_VOL[v.statut] ?? null, passagers: reservations.filter((r) => r.volId === v.id).length }))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || (a.heureDepart ?? '').localeCompare(b.heureDepart ?? ''));
}
