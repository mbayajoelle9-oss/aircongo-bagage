// Réclamations bagages en ligne : le passager déclare sans faire la queue ; les dossiers VIP vérifiés passent en priorité.
import { randomBytes } from 'node:crypto';
import { HttpError } from './logic.js';

export const STATUTS_RECLAMATION = { NOUVELLE: 'Nouvelle', EN_COURS: 'En cours de traitement', RESOLUE: 'Résolue', REJETEE: 'Rejetée' };
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const nettoyer = (v) => String(v ?? '').trim();

export async function creerReclamation(repo, body, now = Date.now()) {
  const nom = nettoyer(body.nom);
  if (nom.length < 2 || nom.length > 80) throw new HttpError(400, 'Le nom du passager est requis (2 à 80 caractères)');
  const vol = nettoyer(body.vol).toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z0-9-]{2,12}$/.test(vol)) throw new HttpError(400, 'Numéro de vol invalide (ex. KQ554)');
  const date = nettoyer(body.date);
  const t = Date.parse(`${date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(t)) throw new HttpError(400, 'Date du vol invalide');
  if (t > now + 2 * 86400000) throw new HttpError(400, 'La date du vol ne peut pas être dans le futur');
  if (t < now - 90 * 86400000) throw new HttpError(400, 'Vol de plus de 90 jours : présentez-vous au bureau des réclamations');
  const reference = nettoyer(body.reference).toUpperCase();
  if (!/^[A-Z0-9]{4,10}$/.test(reference)) throw new HttpError(400, 'Référence de réservation (PNR) invalide');
  const billet = nettoyer(body.numeroBillet).replace(/[\s-]/g, '');
  if (!/^\d{10,14}$/.test(billet)) throw new HttpError(400, 'Numéro de billet invalide (10 à 14 chiffres)');
  const description = nettoyer(body.description).slice(0, 1000);
  const codeEtiquette = nettoyer(body.codeEtiquette).toUpperCase();
  if (codeEtiquette && !/^[A-Z0-9-]{4,20}$/.test(codeEtiquette)) throw new HttpError(400, 'Numéro d’étiquette invalide');
  const telephone = nettoyer(body.telephone);
  if (telephone && !/^\+?[\d\s.-]{6,20}$/.test(telephone)) throw new HttpError(400, 'Téléphone invalide');

  const res = await repo.findOne('reservations', { pnr: reference });
  const verifiee = !!res && norm(res.nom) === norm(nom);
  const prioritaire = verifiee && res.classe === 'VIP';
  const numero = `RC-${randomBytes(3).toString('hex').toUpperCase()}`;
  await repo.insert('reclamations', {
    numero, nom, vol, date, reference, numeroBillet: billet, description, codeEtiquette: codeEtiquette || undefined, telephone: telephone || undefined,
    classe: verifiee ? res.classe : undefined, verifiee, priorite: prioritaire ? 'PRIORITAIRE' : 'NORMALE',
    statut: 'NOUVELLE', notes: [], ts: new Date(now).toISOString(),
  });
  return {
    numero, priorite: prioritaire ? 'PRIORITAIRE' : 'NORMALE', verifiee,
    message: prioritaire
      ? 'Dossier VIP vérifié : il est traité en priorité, sans file d’attente. Un agent vous contacte.'
      : verifiee ? 'Réclamation enregistrée. Un agent la traitera dans les meilleurs délais.'
        : 'Réclamation enregistrée. Votre réservation n’a pas pu être vérifiée automatiquement : un agent contrôlera vos informations.',
  };
}

export async function suiviReclamation(repo, numero, nom) {
  const r = await repo.findOne('reclamations', { numero: nettoyer(numero).toUpperCase() });
  if (!r || norm(r.nom) !== norm(nom)) throw new HttpError(404, 'Réclamation introuvable (vérifiez le numéro et le nom)');
  return { numero: r.numero, statut: r.statut, libelleStatut: STATUTS_RECLAMATION[r.statut], priorite: r.priorite, ts: r.ts, vol: r.vol, date: r.date, reponse: [...(r.notes ?? [])].reverse().find((n) => n.public)?.texte ?? null };
}

export async function listerReclamations(repo) {
  const l = await repo.find('reclamations');
  const rang = (r) => (r.statut === 'RESOLUE' || r.statut === 'REJETEE' ? 2 : r.priorite === 'PRIORITAIRE' ? 0 : 1);
  return l.map((r) => ({ ...r, libelleStatut: STATUTS_RECLAMATION[r.statut] })).sort((a, b) => rang(a) - rang(b) || a.ts.localeCompare(b.ts));
}

export async function majReclamation(repo, numero, { statut, note, public: publique }, agent) {
  const r = await repo.findOne('reclamations', { numero: nettoyer(numero).toUpperCase() });
  if (!r) throw new HttpError(404, 'Réclamation introuvable');
  if (statut && !STATUTS_RECLAMATION[statut]) throw new HttpError(400, 'Statut inconnu');
  const texte = nettoyer(note).slice(0, 500);
  const notes = texte ? [...(r.notes ?? []), { texte, public: !!publique, agent: agent?.nom ?? agent?.email ?? '—', ts: new Date().toISOString() }] : r.notes ?? [];
  return repo.update('reclamations', r.id, { ...(statut ? { statut } : {}), notes });
}
