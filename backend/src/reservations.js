// Réservations (PNR) : saisie au comptoir et import de la liste des passagers fournie par Air Congo (CSV).
import { HttpError } from './logic.js';

const CLASSES = ['ECO', 'BUSINESS', 'VIP'];
const CANAUX = ['SMS', 'WHATSAPP', 'WEB'];
const MAX_LIGNES = 2000;

const nettoyer = (v) => String(v ?? '').trim();

// Valide une ligne et la transforme en réservation (sans l'enregistrer).
async function preparer(repo, brut, volsCache) {
  const pnr = nettoyer(brut.pnr).toUpperCase();
  if (!/^[A-Z0-9]{4,10}$/.test(pnr)) throw new HttpError(400, 'Numéro de réservation invalide (4 à 10 lettres/chiffres)');
  const nom = nettoyer(brut.nom);
  if (nom.length < 2 || nom.length > 80) throw new HttpError(400, 'Nom invalide (2 à 80 caractères)');
  const classe = nettoyer(brut.classe).toUpperCase() || 'ECO';
  if (!CLASSES.includes(classe)) throw new HttpError(400, `Classe inconnue : ${classe} (ECO, BUSINESS ou VIP)`);
  const canal = nettoyer(brut.canalAlerte ?? brut.canal).toUpperCase() || 'SMS';
  if (!CANAUX.includes(canal)) throw new HttpError(400, `Canal d’alerte inconnu : ${canal} (SMS, WHATSAPP ou WEB)`);
  const tel = nettoyer(brut.telephone);
  if (tel && !/^\+?[\d\s.-]{6,20}$/.test(tel)) throw new HttpError(400, 'Téléphone invalide');
  const numero = nettoyer(brut.vol).toUpperCase().replace(/\s+/g, '');
  if (!numero) throw new HttpError(400, 'Numéro de vol requis');
  const date = nettoyer(brut.date);
  const vols = (volsCache ?? (await repo.find('vols'))).filter((v) => String(v.numero).toUpperCase() === numero && (!date || v.date === date));
  if (!vols.length) throw new HttpError(404, `Vol introuvable : ${numero}${date ? ' le ' + date : ''} (importez-le d’abord dans la page Vols)`);
  const vol = vols.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))[0];
  return { pnr, nom, classe, volId: vol.id, telephone: tel || undefined, canalAlerte: canal };
}

async function enregistrer(repo, doc) {
  const existante = await repo.findOne('reservations', { pnr: doc.pnr });
  if (existante) return { reservation: await repo.update('reservations', existante.id, doc), creee: false };
  return { reservation: await repo.insert('reservations', doc), creee: true };
}

export async function creerReservation(repo, body) {
  const doc = await preparer(repo, body);
  const { reservation, creee } = await enregistrer(repo, doc);
  return { ...reservation, creee };
}

// Découpe une ligne CSV (séparateur « ; » ou « , » détecté sur l'en-tête, guillemets gérés).
function decouper(ligne, sep) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < ligne.length; i++) {
    const c = ligne[i];
    if (q) { if (c === '"') { if (ligne[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === sep) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

const ALIAS = { pnr: 'pnr', reservation: 'pnr', reference: 'pnr', nom: 'nom', passager: 'nom', name: 'nom', classe: 'classe', class: 'classe', vol: 'vol', numerovol: 'vol', flight: 'vol', date: 'date', telephone: 'telephone', tel: 'telephone', phone: 'telephone', canal: 'canalAlerte', canalalerte: 'canalAlerte' };
const cle = (h) => ALIAS[h.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '')];

export async function importerReservations(repo, csv) {
  const texte = String(csv ?? '').replace(/^﻿/, '');
  const lignes = texte.split(/\r?\n/).filter((l) => l.trim());
  if (lignes.length < 2) throw new HttpError(400, 'Fichier vide : une ligne d’en-tête puis une ligne par passager');
  if (lignes.length - 1 > MAX_LIGNES) throw new HttpError(400, `Trop de lignes (maximum ${MAX_LIGNES} par import)`);
  const sep = (lignes[0].match(/;/g) ?? []).length >= (lignes[0].match(/,/g) ?? []).length ? ';' : ',';
  const colonnes = decouper(lignes[0], sep).map(cle);
  for (const requis of ['pnr', 'nom', 'vol']) if (!colonnes.includes(requis)) throw new HttpError(400, `Colonne manquante : « ${requis} » (colonnes attendues : pnr, nom, classe, vol, date, telephone, canal)`);
  const vols = await repo.find('vols');
  const res = { crees: 0, mis_a_jour: 0, erreurs: [] };
  const vus = new Set();
  for (let i = 1; i < lignes.length; i++) {
    const cases = decouper(lignes[i], sep);
    const brut = {};
    colonnes.forEach((c, k) => { if (c) brut[c] = cases[k]; });
    try {
      const doc = await preparer(repo, brut, vols);
      if (vus.has(doc.pnr)) throw new HttpError(409, `Réservation ${doc.pnr} en double dans le fichier`);
      vus.add(doc.pnr);
      (await enregistrer(repo, doc)).creee ? res.crees++ : res.mis_a_jour++;
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      res.erreurs.push({ ligne: i + 1, message: e.message });
    }
  }
  return res;
}

export async function listerReservations(repo) {
  const [rs, vols, bagages] = await Promise.all([repo.find('reservations'), repo.find('vols'), repo.find('bagages')]);
  const vol = new Map(vols.map((v) => [v.id, v]));
  return rs.map((r) => ({ pnr: r.pnr, nom: r.nom, classe: r.classe, telephone: r.telephone ?? null, canalAlerte: r.canalAlerte ?? 'SMS', vol: vol.get(r.volId)?.numero ?? '—', date: vol.get(r.volId)?.date ?? null, bagages: bagages.filter((b) => b.reservationId === r.id).length })).sort((a, b) => a.nom.localeCompare(b.nom)).slice(0, 500);
}
