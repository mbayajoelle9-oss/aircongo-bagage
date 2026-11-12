// Logique métier. Indépendante d'Express et de MongoDB : elle ne parle qu'au « dépôt » (repo).
import { CONFIG, ETAPES, LIBELLES, STATIONS, POINTS_PAR_DEFAUT } from './config.js';
import { manquesObligatoires, signalerFraude, fraudesOuvertes } from './fraudes.js';

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
  const notifications = (await repo.find('notifications', { reservationId: reservation.id })).sort((a, b) => b.ts.localeCompare(a.ts));
  return {
    pnr: reservation.pnr,
    canalAlerte: reservation.canalAlerte || 'SMS',
    telephone: reservation.telephone ? reservation.telephone.replace(/\d(?=(?:\D*\d){3})/g, "•") : null,
    notifications: notifications.map(({ code, etape, station, canal, message, ts }) => ({ code, etape, station, canal, message, ts })),
    nom: reservation.nom,
    classe: reservation.classe,
    vol: { ...vol, libelleStatut: ({ PREVU: 'Prévu', RETARDE: 'Retardé', EN_VOL: 'En vol', ATTERRI: 'Atterri', ANNULE: 'Annulé', INCIDENT: 'Incident', DEROUTE: 'Dérouté' })[vol.statut] ?? null },
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

const heureLocale = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kinshasa' });
const MESSAGES = {
  ENREGISTRE: 'a été enregistré',
  CHARGE: 'a été chargé dans l’avion',
  TRANSIT: 'est en transit',
  ARRIVE: 'est arrivé à destination',
  LIVRE: 'vous a été remis',
};

// Alerte envoyée au passager à chaque scan. Le canal (SMS pour les téléphones simples, WhatsApp, ou simple
// notification dans le portail) est enregistré ; l'envoi réel via un fournisseur SMS est prévu en phase 2.
async function alerterPassager(repo, reservation, bagage, scan) {
  const st = STATIONS[scan.station];
  const ville = st ? `${st.ville} (${scan.station})` : scan.station;
  const lieu = scan.pointNom ? `« ${scan.pointNom} », ${ville}` : ville;
  return repo.insert('notifications', {
    reservationId: reservation.id,
    bagageId: bagage.id,
    code: bagage.code,
    etape: scan.etape,
    station: scan.station,
    canal: reservation.canalAlerte || 'SMS',
    telephone: reservation.telephone || null,
    message: `Air Congo : votre bagage ${bagage.code} ${MESSAGES[scan.etape]} à ${lieu}, ${heureLocale(scan.ts)}.`,
    statut: 'SIMULE',
    ts: scan.ts,
  });
}

export async function enregistrerScan(repo, { code, etape, station, agent, poidsKg, source, ts, pointId }) {
  const point = pointId ? await trouverPoint(repo, pointId) : null;
  if (point && !point.actif) throw new HttpError(409, 'Ce point de scan est désactivé');
  if (point) { etape = point.etape; station = point.station; } // le point de scan décide de l'étape et de la station
  const e = String(etape ?? '').toUpperCase();
  const idx = ETAPES.indexOf(e);
  if (idx < 0) throw new HttpError(400, `Étape invalide. Valeurs : ${ETAPES.join(', ')}`);
  if (!station || String(station).length > 10) throw new HttpError(400, 'Station requise');
  const bagage = await repo.findOne('bagages', { code: String(code ?? '').toUpperCase().trim() });
  if (!bagage) {
    // Étiquette inconnue : ni enregistrée ni tracée. Si elle apparaît en circuit, c'est un cas de « mbindiri » : on alerte.
    const f = await signalerFraude(repo, { code: String(code ?? '').toUpperCase().trim().slice(0, 30), etape: e, station, pointNom: point?.nom, agent, inconnu: true });
    throw new HttpError(404, `ALERTE FRAUDE ${f.numero} : étiquette inconnue, aucun enregistrement. ${e === 'CHARGE' ? 'Ne chargez pas ce bagage.' : 'Isolez ce bagage.'} L’alerte est transmise.`);
  }

  const { statut, dernierScan, scans: historique } = await statutBagage(repo, bagage);
  const dernierIdx = ETAPES.indexOf(statut); // -1 si PRE_ENREGISTRE
  // Plusieurs points peuvent partager la même étape (ex. comptoir puis tri) : on refuse seulement un retour
  // en arrière ou un second scan au même point.
  const memePoint = idx === dernierIdx && (dernierScan?.pointId ?? null) === (point?.id ?? null);
  if (idx < dernierIdx || memePoint) {
    throw new HttpError(409, `Déjà scanné à l'étape « ${LIBELLES[statut]} » ou plus avancé`);
  }
  const saut = idx > dernierIdx + 1;

  let bagageMaj = bagage;
  if (e === 'ENREGISTRE' && poidsKg != null && poidsKg !== '') {
    const p = Number(poidsKg);
    if (!Number.isFinite(p) || p <= 0 || p > 80) throw new HttpError(400, 'Poids invalide');
    bagageMaj = await repo.update('bagages', bagage.id, { poidsKg: round2(p), poidsReel: true });
  }

  // Détection du mbindiri : étapes obligatoires (enregistrement, chargement) jamais franchies avant cette étape ?
  const manques = manquesObligatoires(new Set(historique.map((x) => x.etape)), e);
  const scan = await repo.insert('scans', {
    bagageId: bagage.id,
    code: bagage.code,
    etape: e,
    station: String(station).toUpperCase(),
    pointId: point?.id ?? null,
    pointNom: point?.nom ?? null,
    lat: point?.lat ?? null,
    lon: point?.lon ?? null,
    agent: String(agent || 'agent').slice(0, 60),
    source: source === 'RFID' || (point?.rfid && bagage.niveau === 'VIP') ? 'RFID' : 'SCAN',
    saut,
    fraude: manques.length > 0,
    ts: ts || new Date().toISOString(),
  });

  const reservation = await repo.findOne('reservations', { id: bagage.reservationId });
  await alerterPassager(repo, reservation, bagage, scan);
  let fraude = null;
  if (manques.length) {
    const vol = reservation?.volId ? await repo.findOne('vols', { id: reservation.volId }) : null;
    fraude = await signalerFraude(repo, { code: bagage.code, etape: e, station, pointNom: point?.nom, agent, manques, bagage, reservation, vol, ts: scan.ts });
  }
  const dit = (m) => (m.length === 2 ? 'ni enregistré ni chargé' : m[0] === 'ENREGISTRE' ? 'jamais enregistré ni pesé' : 'jamais chargé en soute');
  return {
    scan,
    bagage: await vueBagage(repo, bagageMaj),
    excedent: await calculExcedent(repo, reservation),
    fraude: fraude ? { numero: fraude.numero, type: fraude.type, gravite: fraude.gravite } : null,
    avertissement: fraude ? `ALERTE FRAUDE ${fraude.numero} : ce bagage est ${dit(manques)}. Isolez-le et prévenez le superviseur.` : saut ? 'Une étape intermédiaire a été sautée' : null,
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

// ---- Points de scan (chaque point a ses coordonnées GPS) ----
export async function trouverPoint(repo, id) {
  const p = await repo.findOne('points', { id: String(id ?? '') });
  if (!p) throw new HttpError(404, 'Point de scan introuvable');
  return p;
}

export async function peuplerPoints(repo) {
  if ((await repo.count('points')) > 0) return;
  for (const p of POINTS_PAR_DEFAUT) await repo.insert('points', { rfid: false, ...p, actif: true, positionDemo: true });
}

export async function listerPoints(repo, { seulementActifs = false } = {}) {
  const l = await repo.find('points');
  return l.filter((p) => !seulementActifs || p.actif).sort((a, b) => a.station.localeCompare(b.station) || ETAPES.indexOf(a.etape) - ETAPES.indexOf(b.etape) || a.nom.localeCompare(b.nom));
}

function lireCoordonnees(lat, lon) {
  const la = Number(lat), lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
    throw new HttpError(400, 'Coordonnées GPS invalides (latitude entre −90 et 90, longitude entre −180 et 180)');
  }
  return { lat: Math.round(la * 1e6) / 1e6, lon: Math.round(lo * 1e6) / 1e6 };
}

export async function creerPoint(repo, { nom, station, etape, lat, lon, rfid }) {
  const n = String(nom ?? '').trim();
  if (n.length < 2 || n.length > 60) throw new HttpError(400, 'Nom du point requis (2 à 60 caractères)');
  const st = String(station ?? '').toUpperCase();
  if (!STATIONS[st]) throw new HttpError(400, `Station inconnue. Stations : ${Object.keys(STATIONS).join(', ')}`);
  const e = String(etape ?? '').toUpperCase();
  if (!ETAPES.includes(e)) throw new HttpError(400, `Étape invalide. Valeurs : ${ETAPES.join(', ')}`);
  const c = lireCoordonnees(lat, lon);
  let code, i = (await repo.count('points')) + 1;
  do { code = `${st}-P${String(i++).padStart(2, '0')}`; } while (await repo.findOne('points', { code }));
  return repo.insert('points', { code, nom: n, station: st, etape: e, ...c, rfid: Boolean(rfid), actif: true, positionDemo: false });
}

export async function modifierPoint(repo, id, { nom, lat, lon, actif, etape, rfid }) {
  const p = await trouverPoint(repo, id);
  const maj = {};
  if (nom !== undefined) {
    const n = String(nom).trim();
    if (n.length < 2 || n.length > 60) throw new HttpError(400, 'Nom du point requis (2 à 60 caractères)');
    maj.nom = n;
  }
  if (lat !== undefined || lon !== undefined) Object.assign(maj, lireCoordonnees(lat ?? p.lat, lon ?? p.lon), { positionDemo: false });
  if (actif !== undefined) maj.actif = Boolean(actif);
  if (rfid !== undefined) maj.rfid = Boolean(rfid);
  if (etape !== undefined) {
    const e = String(etape).toUpperCase();
    if (!ETAPES.includes(e)) throw new HttpError(400, `Étape invalide. Valeurs : ${ETAPES.join(', ')}`);
    maj.etape = e;
  }
  return repo.update('points', p.id, maj);
}

// Carte en direct : chaque point avec les bagages dont le dernier passage a eu lieu à ce point.
export async function carteEnDirect(repo) {
  const [points, liste] = await Promise.all([listerPoints(repo), contexte(repo)]);
  return points.map((p) => {
    const ici = liste.filter((b) => b.dernierScan?.pointId === p.id);
    return { ...p, bagages: ici.length, codes: ici.slice(0, 8).map((b) => b.code) };
  });
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
      trajetVol: { depart: volParId.get(r?.volId)?.depart, arrivee: volParId.get(r?.volId)?.arrivee },
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
    fraudesOuvertes: await fraudesOuvertes(repo),
    litigesOuverts: litiges.filter((l) => l.statut !== 'RESOLU').length,
    recettesExcedentUsd: round2(paiements.reduce((s, p) => s + p.montantUsd, 0)),
  };
}

export async function litiges(repo) {
  return (await repo.find('litiges')).sort((a, b) => b.creeLe.localeCompare(a.creeLe));
}

// ---- Données de démonstration (fictives) ----
export async function chargerDemo(repo) {
  await peuplerPoints(repo);
  await repo.reset(['vols', 'reservations', 'bagages', 'scans', 'litiges', 'paiements', 'notifications', 'ventesEspace', 'fraudes']); // les comptes utilisateurs sont conservés
  // Horaires relatifs à « maintenant » pour que la démo montre toujours un avion en vol et des avions au sol.
  const dans = (min) => new Date(Date.now() + min * 60000).toISOString();
  const jour = new Date().toISOString().slice(0, 10);
  const vol1 = await repo.insert('vols', { numero: 'DEMO-101', compagnie: 'Air Congo', date: jour, depart: 'FIH', arrivee: 'FBM', heureDepart: '08:30', departTs: dans(-40), arriveeTs: dans(80), capaciteKg: 150 });
  const vol2 = await repo.insert('vols', { numero: 'DEMO-205', compagnie: 'Air Congo', date: jour, depart: 'FIH', arrivee: 'GOM', heureDepart: '11:15', departTs: dans(120), arriveeTs: dans(235), capaciteKg: 100 });
  await repo.insert('vols', { numero: 'DEMO-310', compagnie: 'Air Congo', date: jour, depart: 'FBM', arrivee: 'FIH', heureDepart: '15:00', departTs: dans(300), arriveeTs: dans(420), capaciteKg: 120 });
  await repo.insert('vols', { numero: 'DEMO-420', compagnie: 'Congo Airways', date: jour, depart: 'FIH', arrivee: 'FKI', heureDepart: '10:00', departTs: dans(-15), arriveeTs: dans(100), capaciteKg: 90 });
  await repo.insert('reservations', { pnr: 'ACG123', nom: 'Mbemba Joseph', classe: 'ECO', volId: vol1.id, telephone: '+243 000 000 001' });
  await repo.insert('reservations', { pnr: 'ACV777', nom: 'Mutombo Sarah', classe: 'VIP', volId: vol1.id, telephone: '+243 000 000 002', canalAlerte: 'WHATSAPP' });
  await repo.insert('reservations', { pnr: 'ACB456', nom: 'Tshimanga Patrick', classe: 'BUSINESS', volId: vol2.id, telephone: '+243 000 000 003' });

  const m1 = await creerBagage(repo, 'ACG123', { poidsKg: 18 });
  const m2 = await creerBagage(repo, 'ACG123', { poidsKg: 12 });
  const v1 = await creerBagage(repo, 'ACV777', { poidsKg: 22 });
  const v2 = await creerBagage(repo, 'ACV777', { poidsKg: 15 });
  await creerBagage(repo, 'ACB456', { poidsKg: 20 });

  const il = (min) => new Date(Date.now() - min * 60000).toISOString();
  // Cas de démonstration du « mbindiri » : une étiquette inconnue du système retrouvée au tapis d'arrivée de Lubumbashi.
  await signalerFraude(repo, { code: 'AC555555', etape: 'ARRIVE', station: 'FBM', pointNom: 'Tapis bagages Lubumbashi', agent: 'Agent FBM', inconnu: true, ts: il(20) });
  const pt = async (code) => (await repo.findOne('points', { code })).id;
  const [ENR, TRI, CHG] = [await pt('FIH-ENR'), await pt('FIH-TRI'), await pt('FIH-CHG')];
  await enregistrerScan(repo, { code: m1.code, pointId: ENR, agent: 'Agent A', poidsKg: 18.4, ts: il(55) });
  await enregistrerScan(repo, { code: m2.code, pointId: ENR, agent: 'Agent A', poidsKg: 12.1, ts: il(54) });
  await enregistrerScan(repo, { code: m1.code, pointId: TRI, agent: 'Agent C', ts: il(47) });
  await enregistrerScan(repo, { code: m1.code, pointId: CHG, agent: 'Agent B', ts: il(40) });
  for (const b of [v1, v2]) {
    await enregistrerScan(repo, { code: b.code, pointId: ENR, agent: 'Agent A', ts: il(22) });
    await enregistrerScan(repo, { code: b.code, pointId: TRI, agent: 'Portique RFID', ts: il(16) });
    await enregistrerScan(repo, { code: b.code, pointId: CHG, agent: 'Portique RFID', ts: il(12) });
  }
  await repo.insert('ventesEspace', { volId: vol1.id, numeroVol: vol1.numero, kg: 20, prixUsdKg: 6, montantUsd: 120, client: 'Pharmacie Centrale (démo)', type: 'FRET', agent: 'Agent A', ts: il(30) });
}
