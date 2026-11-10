// Logique métier. Indépendante d'Express et de MongoDB : elle ne parle qu'au « dépôt » (repo).
import { CONFIG, ETAPES, LIBELLES } from './config.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const norm = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
const round2 = (n) => Math.round(n * 100) / 100;

export async function trouverReservation(repo, pnr) {
  const r = await repo.findOne('reservations', { pnr: String(pnr ?? '').toUpperCase().trim() });
  if (!r) throw new HttpError(404, 'Réservation introuvable');
  return r;
}

export async function trouverBagage(repo, code) {
  const b = await repo.findOne('bagages', { code: String(code ?? '').toUpperCase().trim() });
  if (!b) throw new HttpError(404, 'Bagage introuvable');
  return b;
}

export function verifierPassager(reservation, nom) {
  if (!nom || norm(nom).length < 2 || !norm(reservation.nom).includes(norm(nom))) {
    throw new HttpError(403, 'Nom du passager incorrect');
  }
}

const triParDate = (scans) => [...scans].sort((a, b) => a.ts.localeCompare(b.ts));

function statutDepuis(scans) {
  const tries = triParDate(scans);
  const dernier = tries[tries.length - 1] ?? null;
  const statut = dernier ? dernier.etape : 'PRE_ENREGISTRE';
  return { statut, libelle: LIBELLES[statut], dernierScan: dernier, scans: tries };
}

async function scansDe(repo, bagageId) {
  return repo.find('scans', { bagageId });
}

export async function statutBagage(repo, bagage) {
  return statutDepuis(await scansDe(repo, bagage.id));
}

function vueBagageDepuis(bagage, scans) {
  const { statut, libelle, dernierScan, scans: tries } = statutDepuis(scans);
  return {
    code: bagage.code,
    poidsKg: bagage.poidsKg,
    poidsReel: bagage.poidsReel,
    niveau: bagage.niveau,
    statut,
    libelle,
    dernierScan,
    scans: tries,
  };
}

export async function vueBagage(repo, bagage) {
  return vueBagageDepuis(bagage, await scansDe(repo, bagage.id));
}

export async function calculExcedent(repo, reservation) {
  const bagages = await repo.find('bagages', { reservationId: reservation.id });
  const paiements = await repo.find('paiements', { reservationId: reservation.id });
  const totalKg = round2(bagages.reduce((s, b) => s + b.poidsKg, 0));
  const franchiseKg = CONFIG.franchiseKg[reservation.classe] ?? CONFIG.franchiseKg.ECO;
  const excesKg = Math.max(0, round2(totalKg - franchiseKg));
  const kgPayes = round2(paiements.reduce((s, p) => s + p.kg, 0));
  const kgRestants = Math.max(0, round2(excesKg - kgPayes));
  return {
    totalKg,
    franchiseKg,
    excesKg,
    kgPayes,
    kgRestants,
    montantComptoirUsd: round2(kgRestants * CONFIG.tarifExcedentUsd),
    montantEnLigneUsd: round2(kgRestants * CONFIG.tarifExcedentUsd * (1 - CONFIG.remisePrepaiement)),
    payeUsd: round2(paiements.reduce((s, p) => s + p.montantUsd, 0)),
  };
}

export async function vueReservation(repo, reservation) {
  const vol = await repo.findOne('vols', { id: reservation.volId });
  const docs = await repo.find('bagages', { reservationId: reservation.id });
  const bagages = await Promise.all(docs.map((b) => vueBagage(repo, b)));
  return {
    pnr: reservation.pnr,
    nom: reservation.nom,
    classe: reservation.classe,
    vol,
    bagages,
    excedent: await calculExcedent(repo, reservation),
  };
}

export async function creerBagage(repo, pnr, { poidsKg }) {
  const reservation = await trouverReservation(repo, pnr);
  const poids = Number(poidsKg);
  if (!Number.isFinite(poids) || poids <= 0 || poids > 80) {
    throw new HttpError(400, 'Poids invalide (entre 0 et 80 kg)');
  }
  if ((await repo.count('bagages', { reservationId: reservation.id })) >= 5) {
    throw new HttpError(400, 'Maximum 5 bagages par réservation');
  }
  let code;
  do {
    code = 'AC' + String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
  } while (await repo.findOne('bagages', { code }));
  return repo.insert('bagages', {
    code,
    reservationId: reservation.id,
    poidsKg: round2(poids),
    poidsReel: false,
    niveau: reservation.classe === 'VIP' ? 'VIP' : 'STANDARD',
    creeLe: new Date().toISOString(),
  });
}

export async function enregistrerScan(repo, { code, etape, station, agent, poidsKg, source, ts }) {
  const bagage = await trouverBagage(repo, code);
  const e = String(etape ?? '').toUpperCase();
  const idx = ETAPES.indexOf(e);
  if (idx < 0) throw new HttpError(400, `Étape invalide. Valeurs : ${ETAPES.join(', ')}`);
  if (!station || String(station).length > 10) throw new HttpError(400, 'Station requise');

  const { statut } = await statutBagage(repo, bagage);
  const dernierIdx = ETAPES.indexOf(statut); // -1 si PRE_ENREGISTRE
  if (idx <= dernierIdx) {
    throw new HttpError(409, `Déjà scanné à l'étape « ${LIBELLES[statut]} » ou plus avancé`);
  }
  const saut = idx > dernierIdx + 1;

  let bagageMaj = bagage;
  if (e === 'ENREGISTRE' && poidsKg != null && poidsKg !== '') {
    const p = Number(poidsKg);
    if (!Number.isFinite(p) || p <= 0 || p > 80) throw new HttpError(400, 'Poids invalide');
    bagageMaj = await repo.update('bagages', bagage.id, { poidsKg: round2(p), poidsReel: true });
  }

  const scan = await repo.insert('scans', {
    bagageId: bagage.id,
    code: bagage.code,
    etape: e,
    station: String(station).toUpperCase(),
    agent: String(agent || 'agent').slice(0, 60),
    source: source === 'RFID' ? 'RFID' : 'SCAN',
    saut,
    ts: ts || new Date().toISOString(),
  });

  const reservation = await repo.findOne('reservations', { id: bagage.reservationId });
  return {
    scan,
    bagage: await vueBagage(repo, bagageMaj),
    excedent: await calculExcedent(repo, reservation),
    avertissement: saut ? 'Une étape intermédiaire a été sautée' : null,
  };
}

export async function payerExcedent(repo, pnr, canal) {
  const reservation = await trouverReservation(repo, pnr);
  const c = canal === 'COMPTOIR' ? 'COMPTOIR' : 'EN_LIGNE';
  const ex = await calculExcedent(repo, reservation);
  if (ex.kgRestants <= 0) throw new HttpError(409, 'Aucun excédent à payer');
  const paiement = await repo.insert('paiements', {
    reservationId: reservation.id,
    kg: ex.kgRestants,
    montantUsd: c === 'EN_LIGNE' ? ex.montantEnLigneUsd : ex.montantComptoirUsd,
    canal: c,
    ts: new Date().toISOString(),
  });
  return { paiement, excedent: await calculExcedent(repo, reservation) };
}

export async function creerLitige(repo, { code, type, description }) {
  const bagage = await trouverBagage(repo, code);
  const types = ['PERDU', 'ENDOMMAGE', 'RETARDE', 'CONTENU_MANQUANT'];
  const t = String(type ?? '').toUpperCase();
  if (!types.includes(t)) throw new HttpError(400, `Type invalide. Valeurs : ${types.join(', ')}`);
  const texte = String(description ?? '').trim();
  if (texte.length < 5) throw new HttpError(400, 'Description trop courte');
  if (texte.length > 1000) throw new HttpError(400, 'Description trop longue');
  const numero = 'LIT-' + String((await repo.count('litiges')) + 1).padStart(4, '0');
  return repo.insert('litiges', {
    numero,
    bagageId: bagage.id,
    code: bagage.code,
    type: t,
    description: texte,
    statut: 'OUVERT',
    creeLe: new Date().toISOString(),
  });
}

export async function changerStatutLitige(repo, numero, statut) {
  const l = await repo.findOne('litiges', { numero });
  if (!l) throw new HttpError(404, 'Litige introuvable');
  if (!['OUVERT', 'EN_COURS', 'RESOLU'].includes(statut)) throw new HttpError(400, 'Statut invalide');
  return repo.update('litiges', l.id, { statut });
}

// ---- Vues d'ensemble (une seule lecture de chaque collection) ----
async function contexte(repo) {
  const [bagages, reservations, vols, scans] = await Promise.all([
    repo.find('bagages'),
    repo.find('reservations'),
    repo.find('vols'),
    repo.find('scans'),
  ]);
  const scansParBagage = new Map();
  for (const s of scans) {
    if (!scansParBagage.has(s.bagageId)) scansParBagage.set(s.bagageId, []);
    scansParBagage.get(s.bagageId).push(s);
  }
  const resParId = new Map(reservations.map((r) => [r.id, r]));
  const volParId = new Map(vols.map((v) => [v.id, v]));
  return bagages.map((b) => {
    const r = resParId.get(b.reservationId);
    return {
      ...vueBagageDepuis(b, scansParBagage.get(b.id) ?? []),
      passager: r?.nom,
      pnr: r?.pnr,
      vol: volParId.get(r?.volId)?.numero,
    };
  });
}

export async function listeBagages(repo) {
  return (await contexte(repo)).sort((a, b) => (b.dernierScan?.ts ?? '').localeCompare(a.dernierScan?.ts ?? ''));
}

function alertesDepuis(liste, maintenant) {
  const limite = CONFIG.alerteMinutes * 60 * 1000;
  const res = [];
  for (const b of liste) {
    // Blocages réels : enregistré mais jamais chargé, ou arrivé mais jamais remis.
    if (!b.dernierScan || !['ENREGISTRE', 'ARRIVE'].includes(b.statut)) continue;
    const age = maintenant - new Date(b.dernierScan.ts).getTime();
    if (age > limite) {
      res.push({
        code: b.code,
        passager: b.passager,
        dernierStatut: b.libelle,
        station: b.dernierScan.station,
        minutesSansMouvement: Math.round(age / 60000),
      });
    }
  }
  return res;
}

export async function alertes(repo, maintenant = Date.now()) {
  return alertesDepuis(await contexte(repo), maintenant);
}

export async function stats(repo, maintenant = Date.now()) {
  const liste = await contexte(repo);
  const [litiges, paiements] = await Promise.all([repo.find('litiges'), repo.find('paiements')]);
  const parStatut = {};
  for (const b of liste) parStatut[b.statut] = (parStatut[b.statut] ?? 0) + 1;
  return {
    totalBagages: liste.length,
    vip: liste.filter((b) => b.niveau === 'VIP').length,
    parStatut,
    alertes: alertesDepuis(liste, maintenant).length,
    litigesOuverts: litiges.filter((l) => l.statut !== 'RESOLU').length,
    recettesExcedentUsd: round2(paiements.reduce((s, p) => s + p.montantUsd, 0)),
  };
}

export async function litiges(repo) {
  return (await repo.find('litiges')).sort((a, b) => b.creeLe.localeCompare(a.creeLe));
}

// ---- Données de démonstration (fictives) ----
export async function chargerDemo(repo) {
  await repo.reset(['vols', 'reservations', 'bagages', 'scans', 'litiges', 'paiements']); // les comptes utilisateurs sont conservés
  const vol1 = await repo.insert('vols', { numero: 'DEMO-101', depart: 'FIH', arrivee: 'FBM', heureDepart: '08:30' });
  const vol2 = await repo.insert('vols', { numero: 'DEMO-205', depart: 'FIH', arrivee: 'GOM', heureDepart: '11:15' });
  await repo.insert('reservations', { pnr: 'ACG123', nom: 'Mbemba Joseph', classe: 'ECO', volId: vol1.id, telephone: '+243 000 000 001' });
  await repo.insert('reservations', { pnr: 'ACV777', nom: 'Kabila Sarah', classe: 'VIP', volId: vol1.id, telephone: '+243 000 000 002' });
  await repo.insert('reservations', { pnr: 'ACB456', nom: 'Tshimanga Patrick', classe: 'BUSINESS', volId: vol2.id, telephone: '+243 000 000 003' });

  const m1 = await creerBagage(repo, 'ACG123', { poidsKg: 18 });
  const m2 = await creerBagage(repo, 'ACG123', { poidsKg: 12 });
  const v1 = await creerBagage(repo, 'ACV777', { poidsKg: 22 });
  const v2 = await creerBagage(repo, 'ACV777', { poidsKg: 15 });
  await creerBagage(repo, 'ACB456', { poidsKg: 20 });

  const il = (min) => new Date(Date.now() - min * 60000).toISOString();
  await enregistrerScan(repo, { code: m1.code, etape: 'ENREGISTRE', station: 'FIH', agent: 'Agent A', poidsKg: 18.4, ts: il(55) });
  await enregistrerScan(repo, { code: m2.code, etape: 'ENREGISTRE', station: 'FIH', agent: 'Agent A', poidsKg: 12.1, ts: il(54) });
  await enregistrerScan(repo, { code: m1.code, etape: 'CHARGE', station: 'FIH', agent: 'Agent B', ts: il(40) });
  for (const b of [v1, v2]) {
    await enregistrerScan(repo, { code: b.code, etape: 'ENREGISTRE', station: 'FIH', agent: 'Agent A', source: 'RFID', ts: il(20) });
    await enregistrerScan(repo, { code: b.code, etape: 'CHARGE', station: 'FIH', agent: 'Portique RFID', source: 'RFID', ts: il(12) });
  }
}
