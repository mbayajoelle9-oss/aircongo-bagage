import { STATIONS } from './config.js';
import { HttpError } from './logic.js';
import { hasherMotDePasse, verifierMotDePasse, signerJeton, verifierJeton } from './auth.js';

const ROLES = ['ADMIN', 'AGENT'];
const reEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const vueUtilisateur = (u) => ({
  id: u.id,
  nom: u.nom,
  email: u.email,
  role: u.role,
  station: u.station ?? null,
  actif: u.actif,
  creeLe: u.creeLe,
  derniereConnexion: u.derniereConnexion ?? null,
});

function validerMotDePasse(mdp) {
  if (typeof mdp !== 'string' || mdp.length < 10) {
    throw new HttpError(400, 'Mot de passe trop court (10 caractères minimum)');
  }
  if (mdp.length > 100) throw new HttpError(400, 'Mot de passe trop long');
}

export async function creerUtilisateur(repo, { nom, email, motDePasse, role, station }) {
  const n = String(nom ?? '').trim();
  const e = String(email ?? '').trim().toLowerCase();
  const r = String(role ?? '').toUpperCase();
  if (n.length < 2 || n.length > 80) throw new HttpError(400, 'Nom invalide');
  if (!reEmail.test(e)) throw new HttpError(400, 'Adresse e-mail invalide');
  if (!ROLES.includes(r)) throw new HttpError(400, `Rôle invalide. Valeurs : ${ROLES.join(', ')}`);
  validerMotDePasse(motDePasse);
  let st = null;
  if (r === 'AGENT') {
    st = String(station ?? '').trim().toUpperCase();
    if (!STATIONS[st]) throw new HttpError(400, `Station inconnue. Stations : ${Object.keys(STATIONS).join(', ')}`);
  }
  if (await repo.findOne('utilisateurs', { email: e })) throw new HttpError(409, 'Cette adresse e-mail existe déjà');
  const u = await repo.insert('utilisateurs', {
    nom: n,
    email: e,
    role: r,
    station: st,
    actif: true,
    hash: await hasherMotDePasse(motDePasse),
    creeLe: new Date().toISOString(),
  });
  return vueUtilisateur(u);
}

// Hash factice pour que la durée de réponse ne révèle pas si l'adresse existe.
const HASH_FACTICE = await hasherMotDePasse('mot-de-passe-factice-' + Math.random());

export async function connexion(repo, secret, { email, motDePasse }) {
  const u = await repo.findOne('utilisateurs', { email: String(email ?? '').trim().toLowerCase() });
  const ok = await verifierMotDePasse(motDePasse, u?.hash ?? HASH_FACTICE);
  if (!u || !ok || !u.actif) throw new HttpError(401, 'Identifiants invalides');
  await repo.update('utilisateurs', u.id, { derniereConnexion: new Date().toISOString() });
  return { token: signerJeton({ sub: u.id }, secret), utilisateur: vueUtilisateur(u) };
}

// Vérifie le jeton ET que le compte existe encore et est actif (désactivation immédiate).
export async function authentifier(repo, secret, headers, rolesAutorises) {
  const m = /^Bearer (.+)$/.exec(String(headers.authorization ?? ''));
  const charge = m ? verifierJeton(m[1], secret) : null;
  const u = charge ? await repo.findOne('utilisateurs', { id: charge.sub }) : null;
  if (!u || !u.actif) throw new HttpError(401, 'Session expirée, veuillez vous reconnecter');
  if (rolesAutorises && !rolesAutorises.includes(u.role)) throw new HttpError(403, 'Accès non autorisé pour votre rôle');
  return u;
}

export async function listerUtilisateurs(repo) {
  return (await repo.find('utilisateurs')).map(vueUtilisateur).sort((a, b) => a.nom.localeCompare(b.nom));
}

export async function modifierUtilisateur(repo, moi, id, { actif, motDePasse }) {
  const u = await repo.findOne('utilisateurs', { id });
  if (!u) throw new HttpError(404, 'Utilisateur introuvable');
  const patch = {};
  if (typeof actif === 'boolean') {
    if (u.id === moi.id && actif === false) throw new HttpError(400, 'Vous ne pouvez pas désactiver votre propre compte');
    patch.actif = actif;
  }
  if (motDePasse !== undefined) {
    validerMotDePasse(motDePasse);
    patch.hash = await hasherMotDePasse(motDePasse);
  }
  if (!Object.keys(patch).length) throw new HttpError(400, 'Aucune modification demandée');
  return vueUtilisateur(await repo.update('utilisateurs', id, patch));
}
