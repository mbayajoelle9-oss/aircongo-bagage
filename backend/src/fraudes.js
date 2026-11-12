// Détection du « mbindiri » : un bagage glissé dans la soute à la place d'un autre, sans passer par la traçabilité.
// Règle : un bagage retrouvé à une étape avancée (chargement, transit, arrivée, remise) alors qu'il n'a JAMAIS été enregistré
// et/ou JAMAIS chargé, ou une étiquette totalement inconnue du système, déclenche une alerte fraude.
import { randomBytes } from 'node:crypto';
import { HttpError } from './logic.js';

export const STATUTS_FRAUDE = { OUVERTE: 'Ouverte', EN_ENQUETE: 'En enquête', CONFIRMEE: 'Fraude confirmée', FAUSSE_ALERTE: 'Fausse alerte' };
export const TYPES_FRAUDE = {
  NON_ENREGISTRE_NON_CHARGE: 'Ni enregistré ni chargé, mais retrouvé en circuit',
  NON_ENREGISTRE: 'Jamais enregistré (ni pesé) mais retrouvé en circuit',
  NON_CHARGE: 'Jamais chargé en soute mais retrouvé à destination',
  INCONNU_CHARGE: 'Étiquette inconnue chargée en soute',
  INCONNU_DESTINATION: 'Étiquette inconnue retrouvée à destination',
  ETIQUETTE_INCONNUE: 'Étiquette inconnue présentée à l’enregistrement',
};
const ETAPES_AVANCEES = ['ARRIVE', 'LIVRE', 'TRANSIT'];

// Étapes obligatoires manquantes dans l'historique du bagage avant le scan courant.
export function manquesObligatoires(etapesVues, etape) {
  const m = [];
  if (etape !== 'ENREGISTRE' && !etapesVues.has('ENREGISTRE')) m.push('ENREGISTRE');
  if (['TRANSIT', 'ARRIVE', 'LIVRE'].includes(etape) && !etapesVues.has('CHARGE')) m.push('CHARGE');
  return m;
}

export function typeFraude(manques, inconnu, etape) {
  if (inconnu) return etape === 'CHARGE' ? 'INCONNU_CHARGE' : etape === 'ENREGISTRE' ? 'ETIQUETTE_INCONNUE' : 'INCONNU_DESTINATION';
  if (manques.includes('ENREGISTRE') && manques.includes('CHARGE')) return 'NON_ENREGISTRE_NON_CHARGE';
  return manques.includes('ENREGISTRE') ? 'NON_ENREGISTRE' : 'NON_CHARGE';
}

export async function signalerFraude(repo, { code, etape, station, pointNom, agent, manques = [], inconnu = false, bagage = null, reservation = null, vol = null, ts }) {
  const type = typeFraude(manques, inconnu, etape);
  const gravite = type === 'ETIQUETTE_INCONNUE' ? 'MOYENNE' : ETAPES_AVANCEES.includes(etape) || type === 'NON_ENREGISTRE_NON_CHARGE' || type.startsWith('INCONNU') ? 'CRITIQUE' : 'ELEVEE';
  const ouverte = (await repo.find('fraudes', { code })).find((f) => f.type === type && (f.statut === 'OUVERTE' || f.statut === 'EN_ENQUETE'));
  if (ouverte) return { ...ouverte, doublon: true };
  const doc = await repo.insert('fraudes', {
    numero: `FR-${randomBytes(3).toString('hex').toUpperCase()}`,
    code, type, libelleType: TYPES_FRAUDE[type], gravite, etape, station: String(station ?? '').toUpperCase(), pointNom: pointNom ?? null,
    agent: String(agent ?? '').slice(0, 60), manques, inconnu,
    passager: reservation?.nom ?? null, pnr: reservation?.pnr ?? null, vol: vol?.numero ?? null, trajet: vol ? `${vol.depart} → ${vol.arrivee}` : null,
    statut: 'OUVERTE', notes: [], ts: ts ?? new Date().toISOString(),
  });
  return doc;
}

const RANG = { CRITIQUE: 0, ELEVEE: 1, MOYENNE: 2 };
export async function listerFraudes(repo) {
  const l = await repo.find('fraudes');
  const clos = (f) => f.statut === 'CONFIRMEE' || f.statut === 'FAUSSE_ALERTE';
  return l.map((f) => ({ ...f, libelleStatut: STATUTS_FRAUDE[f.statut] }))
    .sort((a, b) => (clos(a) - clos(b)) || (RANG[a.gravite] - RANG[b.gravite]) || b.ts.localeCompare(a.ts));
}

export async function fraudesOuvertes(repo) {
  return (await repo.find('fraudes')).filter((f) => f.statut === 'OUVERTE' || f.statut === 'EN_ENQUETE').length;
}

export async function majFraude(repo, numero, { statut, note }, agent) {
  const f = await repo.findOne('fraudes', { numero: String(numero ?? '').toUpperCase().trim() });
  if (!f) throw new HttpError(404, 'Alerte introuvable');
  if (statut && !STATUTS_FRAUDE[statut]) throw new HttpError(400, 'Statut inconnu');
  const texte = String(note ?? '').trim().slice(0, 500);
  const notes = texte ? [...(f.notes ?? []), { texte, agent: agent?.nom ?? '—', ts: new Date().toISOString() }] : f.notes ?? [];
  return repo.update('fraudes', f.id, { ...(statut ? { statut } : {}), notes });
}
