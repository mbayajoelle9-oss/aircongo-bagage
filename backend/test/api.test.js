import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRepo } from '../src/repo.memory.js';
import { chargerDemo, HttpError } from '../src/logic.js';
import { creerUtilisateur } from '../src/utilisateurs.js';
import { signerJeton, verifierJeton } from '../src/auth.js';
import { construireRoutes } from '../src/routes.js';
import { creerFournisseurAviationstack, creerFournisseur } from '../src/vols.js';

const SECRET = 'secret-de-test-assez-long-pour-etre-valide-123456';

// Simule l'adaptateur Express : trouve la route, extrait les paramètres, appelle le handler.
async function demarrer(options = {}) {
  const repo = new MemoryRepo();
  await chargerDemo(repo);
  await creerUtilisateur(repo, { nom: 'Admin Test', email: 'admin@test.cd', motDePasse: 'motdepasse-admin-1', role: 'ADMIN' });
  await creerUtilisateur(repo, { nom: 'Agent FIH', email: 'agent@test.cd', motDePasse: 'motdepasse-agent-1', role: 'AGENT', station: 'fih' });
  const routes = construireRoutes(repo, { jwtSecret: SECRET, demoResetAutorise: true, ...options });
  const call = async (method, url, { body = {}, token, query = {}, headers = {} } = {}) => {
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = new RegExp('^' + r.path.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$').exec(url);
      if (!m) continue;
      try {
        const json = await r.handler({ params: { ...m.groups }, body, query, headers: { ...headers, ...(token ? { authorization: 'Bearer ' + token } : {}) } });
        return { status: 200, json };
      } catch (e) {
        if (e instanceof HttpError) return { status: e.status, json: { erreur: e.message } };
        throw e;
      }
    }
    return { status: 404, json: null };
  };
  const login = async (email, motDePasse) => (await call('POST', '/api/auth/login', { body: { email, motDePasse } })).json.token;
  const AD = await login('admin@test.cd', 'motdepasse-admin-1');
  const AG = await login('agent@test.cd', 'motdepasse-agent-1');
  return { repo, call, AD, AG };
}

test('connexion : identifiants valides, invalides, compte inconnu', async () => {
  const { call } = await demarrer();
  const ok = await call('POST', '/api/auth/login', { body: { email: 'ADMIN@test.cd ', motDePasse: 'motdepasse-admin-1' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.utilisateur.role, 'ADMIN');
  assert.equal(ok.json.utilisateur.hash, undefined); // le hash ne sort jamais
  const mauvais = await call('POST', '/api/auth/login', { body: { email: 'admin@test.cd', motDePasse: 'faux' } });
  const inconnu = await call('POST', '/api/auth/login', { body: { email: 'inconnu@test.cd', motDePasse: 'peu importe' } });
  assert.equal(mauvais.status, 401);
  assert.equal(inconnu.status, 401);
  assert.equal(mauvais.json.erreur, inconnu.json.erreur); // même message : pas de fuite sur l'existence du compte
  assert.equal((await call('POST', '/api/auth/login', { body: {} })).status, 401);
});

test('jetons : falsifié, expiré, absent', async () => {
  const { call, AD, repo } = await demarrer();
  assert.equal((await call('GET', '/api/auth/me', { token: AD })).status, 200);
  assert.equal((await call('GET', '/api/auth/me')).status, 401);
  assert.equal((await call('GET', '/api/auth/me', { token: AD.slice(0, -3) + 'abc' })).status, 401);
  const [corps, sig] = AD.split('.');
  const faux = Buffer.from(JSON.stringify({ sub: 'x', exp: 9999999999 })).toString('base64url');
  assert.equal((await call('GET', '/api/auth/me', { token: faux + '.' + sig })).status, 401);
  const admin = await repo.findOne('utilisateurs', { email: 'admin@test.cd' });
  const expire = signerJeton({ sub: admin.id }, SECRET, -10);
  assert.equal((await call('GET', '/api/auth/me', { token: expire })).status, 401);
  assert.equal(verifierJeton(AD, 'autre-secret'), null);
});

test('rôles : l’agent n’accède pas à l’administration', async () => {
  const { call, AD, AG } = await demarrer();
  assert.equal((await call('GET', '/api/admin/stats', { token: AG })).status, 403);
  assert.equal((await call('GET', '/api/admin/utilisateurs', { token: AG })).status, 403);
  assert.equal((await call('GET', '/api/admin/stats')).status, 401);
  assert.equal((await call('GET', '/api/admin/stats', { token: AD })).status, 200);
});

test('suivi passager : bon nom requis', async () => {
  const { call } = await demarrer();
  assert.equal((await call('GET', '/api/suivi/ACG123', { query: { nom: 'Mbemba' } })).status, 200);
  assert.equal((await call('GET', '/api/suivi/acg123', { query: { nom: 'mbemba' } })).status, 200);
  assert.equal((await call('GET', '/api/suivi/ACG123', { query: { nom: 'Dupont' } })).status, 403);
  assert.equal((await call('GET', '/api/suivi/ACG123')).status, 403);
  assert.equal((await call('GET', '/api/suivi/ZZZ999', { query: { nom: 'Mbemba' } })).status, 404);
});

test('données démo : excédent, alerte, VIP', async () => {
  const { call, AD } = await demarrer();
  const m = (await call('GET', '/api/suivi/ACG123', { query: { nom: 'Mbemba' } })).json;
  assert.equal(m.excedent.excesKg, 7.5);
  assert.equal(m.excedent.montantComptoirUsd, 75);
  assert.equal(m.excedent.montantEnLigneUsd, 60);
  const s = (await call('GET', '/api/admin/stats', { token: AD })).json;
  assert.equal(s.totalBagages, 5);
  assert.equal(s.vip, 2);
  assert.equal(s.alertes, 1);
});

test('scénario complet : pré-enregistrement -> livraison + paiement', async () => {
  const { call, AD, AG } = await demarrer();
  assert.equal((await call('POST', '/api/suivi/ACB456/bagages', { body: { nom: 'Tshimanga', poidsKg: 15 } })).status, 404); // le passager ne crée pas d'étiquette
  const ajout = await call('POST', '/api/agent/bagages', { token: AG, body: { pnr: 'ACB456', poidsKg: 15 } });
  assert.equal(ajout.status, 200);
  const code = ajout.json.code;
  assert.match(code, /^AC\d{6}$/);
  assert.equal(ajout.json.reservation.excedent.excesKg, 3);

  const paye = await call('POST', '/api/suivi/ACB456/payer', { body: { nom: 'Tshimanga' } });
  assert.equal(paye.json.paiement.montantUsd, 24);
  assert.equal((await call('POST', '/api/suivi/ACB456/payer', { body: { nom: 'Tshimanga' } })).status, 409);

  const pts = (await call('GET', '/api/agent/points', { token: AG })).json;
  const P = (c) => pts.find((p) => p.code === c).id;
  const scan = (token, body) => call('POST', '/api/agent/scans', { token, body: { code, ...body } });
  assert.equal((await scan(undefined, { pointId: P('FIH-ENR') })).status, 401);
  assert.equal((await scan(AG, { etape: 'ENREGISTRE' })).status, 400); // un agent doit choisir un point
  assert.equal((await scan(AG, { pointId: P('GOM-SOU') })).status, 403); // point d'une autre station
  const s1 = await scan(AG, { pointId: P('FIH-ENR'), etape: 'LIVRE', station: 'GOM', agent: 'Usurpateur', poidsKg: 15.2 });
  assert.equal(s1.status, 200);
  assert.equal(s1.json.scan.station, 'FIH'); // le point décide de la station
  assert.equal(s1.json.scan.etape, 'ENREGISTRE'); // et de l'étape
  assert.equal(s1.json.scan.agent, 'Agent FIH'); // l'identité vient du compte
  assert.equal(typeof s1.json.scan.lat, 'number');
  assert.equal(s1.json.bagage.poidsReel, true);
  assert.equal((await scan(AG, { pointId: P('FIH-ENR') })).status, 409); // même point deux fois
  assert.equal((await scan(AG, { pointId: P('FIH-TRI') })).status, 200); // autre point, même étape
  const s2 = await scan(AD, { etape: 'ARRIVE', station: 'GOM' });
  assert.ok(s2.json.avertissement);
  assert.equal(s2.json.scan.station, 'GOM'); // l'admin peut choisir
  const s3 = await scan(AG, { pointId: P('FIH-LIV') });
  assert.equal(s3.json.bagage.statut, 'LIVRE');
  assert.equal((await scan(AD, { etape: 'XYZ', station: 'FIH' })).status, 400);
  assert.equal((await call('GET', '/api/admin/stats', { token: AD })).json.recettesExcedentUsd, 24);
});

test('litiges : création par le passager, suivi par la compagnie', async () => {
  const { call, repo, AD } = await demarrer();
  const res = await repo.findOne('reservations', { pnr: 'ACG123' });
  const bag = (await repo.find('bagages', { reservationId: res.id }))[0];
  assert.equal((await call('POST', '/api/suivi/ACV777/litiges', { body: { nom: 'Kabila', code: bag.code, type: 'PERDU', description: 'Bagage non reçu' } })).status, 403);
  const ok = await call('POST', '/api/suivi/ACG123/litiges', { body: { nom: 'Mbemba', code: bag.code, type: 'RETARDE', description: 'Toujours pas arrivé' } });
  assert.equal(ok.json.numero, 'LIT-0001');
  assert.equal((await call('PATCH', '/api/admin/litiges/LIT-0001', { token: AD, body: { statut: 'EN_COURS' } })).json.statut, 'EN_COURS');
  assert.equal((await call('PATCH', '/api/admin/litiges/LIT-0001', { token: AD, body: { statut: 'NIMPORTE' } })).status, 400);
});

test('gestion des utilisateurs : création, doublon, désactivation immédiate', async () => {
  const { call, AD, AG } = await demarrer();
  const nouveau = { nom: 'Agent FBM', email: 'fbm@test.cd', motDePasse: 'mot-de-passe-long-1', role: 'AGENT', station: 'FBM' };
  const cree = await call('POST', '/api/admin/utilisateurs', { token: AD, body: nouveau });
  assert.equal(cree.status, 200);
  assert.equal(cree.json.station, 'FBM');
  assert.equal((await call('POST', '/api/admin/utilisateurs', { token: AD, body: nouveau })).status, 409);
  assert.equal((await call('POST', '/api/admin/utilisateurs', { token: AD, body: { ...nouveau, email: 'a@b.cd', motDePasse: 'court' } })).status, 400);
  assert.equal((await call('POST', '/api/admin/utilisateurs', { token: AD, body: { ...nouveau, email: 'b@b.cd', station: '' } })).status, 400);
  assert.equal((await call('POST', '/api/admin/utilisateurs', { token: AG, body: nouveau })).status, 403);

  const liste = (await call('GET', '/api/admin/utilisateurs', { token: AD })).json;
  assert.equal(liste.length, 3);
  assert.ok(liste.every((u) => u.hash === undefined));

  // désactivation : la session de l'agent cesse de fonctionner immédiatement
  const agent = liste.find((u) => u.email === 'agent@test.cd');
  assert.equal((await call('PATCH', `/api/admin/utilisateurs/${agent.id}`, { token: AD, body: { actif: false } })).status, 200);
  assert.equal((await call('GET', '/api/auth/me', { token: AG })).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { body: { email: 'agent@test.cd', motDePasse: 'motdepasse-agent-1' } })).status, 401);
  // l'admin ne peut pas se désactiver lui-même
  const admin = liste.find((u) => u.email === 'admin@test.cd');
  assert.equal((await call('PATCH', `/api/admin/utilisateurs/${admin.id}`, { token: AD, body: { actif: false } })).status, 400);
  // changement de mot de passe
  assert.equal((await call('PATCH', `/api/admin/utilisateurs/${agent.id}`, { token: AD, body: { actif: true, motDePasse: 'nouveau-mot-de-passe-9' } })).status, 200);
  assert.equal((await call('POST', '/api/auth/login', { body: { email: 'agent@test.cd', motDePasse: 'nouveau-mot-de-passe-9' } })).status, 200);
});

test('validations et réinitialisation démo (comptes conservés)', async () => {
  const { call, AD, AG } = await demarrer();
  assert.equal((await call('POST', '/api/agent/bagages', { token: AG, body: { pnr: 'ACG123', poidsKg: -3 } })).status, 400);
  assert.equal((await call('POST', '/api/agent/bagages', { token: AG, body: { pnr: 'ACG123', poidsKg: 500 } })).status, 400);
  assert.equal((await call('POST', '/api/agent/bagages', { body: { pnr: 'ACG123', poidsKg: 5 } })).status, 401);
  assert.equal((await call('GET', '/api/health')).json.ok, true);
  assert.equal((await call('POST', '/api/admin/demo/reset', { token: AG })).status, 403);
  assert.equal((await call('POST', '/api/admin/demo/reset', { token: AD })).status, 200);
  assert.equal((await call('GET', '/api/auth/me', { token: AD })).status, 200); // le compte existe toujours
  assert.equal((await call('GET', '/api/admin/stats', { token: AD })).json.totalBagages, 5);
});

test('alertes passager à chaque scan + stations connues', async () => {
  const { call, AD } = await demarrer();
  const v = (await call('GET', '/api/suivi/ACV777', { query: { nom: 'Kabila' } })).json;
  assert.equal(v.canalAlerte, 'WHATSAPP');
  assert.equal(v.notifications.length, 6); // 2 bagages x (comptoir, tri, chargement)
  assert.match(v.notifications[0].message, /^Air Congo : votre bagage AC\d{6} .* \(FIH\)/);
  assert.ok(!v.telephone.includes('000 000 002'));
  const cfg = (await call('GET', '/api/config')).json;
  assert.ok(cfg.stations.FIH && cfg.stations.FBM);
  const r = await call('POST', '/api/admin/utilisateurs', { token: AD, body: { nom: 'X Y', email: 'x@y.cd', motDePasse: 'motdepasse-123', role: 'AGENT', station: 'ZZZ' } });
  assert.equal(r.status, 400);
});

test('points de scan GPS : gestion par l\'admin, trajet du bagage, carte en direct', async () => {
  const { call, repo, AD, AG } = await demarrer();
  const liste = (await call('GET', '/api/admin/points', { token: AD })).json;
  assert.ok(liste.length >= 10 && liste.every((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)));
  assert.equal((await call('GET', '/api/admin/points', { token: AG })).status, 403);
  const cree = await call('POST', '/api/admin/points', { token: AD, body: { nom: 'Contrôle douane', station: 'fih', etape: 'enregistre', lat: -4.3868, lon: 15.4437 } });
  assert.equal(cree.status, 200);
  assert.equal(cree.json.positionDemo, false);
  assert.equal((await call('POST', '/api/admin/points', { token: AD, body: { nom: 'X', station: 'FIH', etape: 'CHARGE', lat: 200, lon: 0 } })).status, 400);
  assert.equal((await call('POST', '/api/admin/points', { token: AD, body: { nom: 'Point', station: 'ZZZ', etape: 'CHARGE', lat: 1, lon: 1 } })).status, 400);
  const maj = await call('PATCH', `/api/admin/points/${cree.json.id}`, { token: AD, body: { lat: -4.39, lon: 15.45, actif: false } });
  assert.equal(maj.json.lat, -4.39);
  assert.equal((await call('POST', '/api/agent/scans', { token: AD, body: { code: 'AC000000', pointId: cree.json.id } })).status, 404);
  const bag = (await repo.find('bagages')).find((b) => b.niveau === 'VIP');
  const inactif = await call('POST', '/api/agent/scans', { token: AD, body: { code: bag.code, pointId: cree.json.id } });
  assert.equal(inactif.status, 409); // point désactivé
  // le trajet du bagage VIP : 3 points avec coordonnées, source RFID aux portiques
  const vue = (await call('GET', '/api/suivi/ACV777', { query: { nom: 'Kabila' } })).json;
  const sc = vue.bagages[0].scans;
  assert.deepEqual(sc.map((x) => x.pointNom), ['Comptoir d’enregistrement', 'Tri bagages et sûreté', 'Chargement avion']);
  assert.deepEqual(sc.map((x) => x.source), ['SCAN', 'RFID', 'RFID']);
  const carte = (await call('GET', '/api/admin/carte', { token: AD })).json;
  assert.equal(carte.find((p) => p.code === 'FIH-CHG').bagages, 3); // 2 VIP + 1 standard
  assert.equal(carte.reduce((n, p) => n + p.bagages, 0), 4); // le 5e bagage n'est pas encore scanné
});

// Réponse type d'aviationstack (les heures sont celles de l'aéroport).
const reponseAviation = (delay = 0, status = 'scheduled') => ({
  data: [{
    flight_date: '2026-11-12', flight_status: status,
    departure: { iata: 'FIH', scheduled: '2026-11-12T08:30:00+00:00', estimated: '2026-11-12T08:55:00+00:00', delay, terminal: 'A', gate: '4' },
    arrival: { iata: 'FBM', scheduled: '2026-11-12T10:40:00+00:00' },
    airline: { name: 'Air Congo' }, flight: { iata: 'ZY100' },
  }],
});

test('vols automatiques : import, mise à jour des retards, erreurs du fournisseur', async () => {
  let reponse = reponseAviation(0), appels = [];
  const fetchFactice = async (url) => { appels.push(String(url)); return { json: async () => reponse }; };
  const fournisseur = creerFournisseurAviationstack({ cle: 'CLE', fetchImpl: fetchFactice });
  const { call, AD, AG } = await demarrer({ fournisseurVols: fournisseur });

  assert.equal((await call('GET', '/api/admin/vols', { token: AG })).status, 403);
  const liste0 = (await call('GET', '/api/admin/vols', { token: AD })).json;
  assert.equal(liste0.actif, true);
  assert.equal(liste0.vols.length, 4); // vols de démonstration

  assert.equal((await call('POST', '/api/admin/vols/importer', { token: AD, body: { numero: 'pas un vol' } })).status, 400);
  assert.equal((await call('POST', '/api/admin/vols/importer', { token: AD, body: { numero: 'zy100', date: '12/11/2026' } })).status, 400);

  const imp = await call('POST', '/api/admin/vols/importer', { token: AD, body: { numero: 'zy100', date: '2026-11-12' } });
  assert.equal(imp.status, 200);
  assert.deepEqual([imp.json.numero, imp.json.depart, imp.json.arrivee, imp.json.heureDepart, imp.json.statut, imp.json.source], ['ZY100', 'FIH', 'FBM', '08:30', 'PREVU', 'API']);
  assert.match(appels[0], /access_key=CLE.*flight_iata=ZY100.*flight_date=2026-11-12|flight_iata=ZY100/);

  // Retard détecté à l'actualisation, sans doublon de vol
  reponse = reponseAviation(25);
  const sync = await call('POST', '/api/admin/vols/synchroniser', { token: AD });
  assert.deepEqual(sync.json, { maj: 1, erreurs: [] });
  const liste = (await call('GET', '/api/admin/vols', { token: AD })).json.vols;
  const vol = liste.filter((v) => v.numero === 'ZY100');
  assert.equal(vol.length, 1);
  assert.equal(vol[0].statut, 'RETARDE');
  assert.equal(vol[0].retardMin, 25);

  // Aucun résultat / erreur d'API
  reponse = { data: [] };
  assert.equal((await call('POST', '/api/admin/vols/importer', { token: AD, body: { numero: 'ZY999', date: '2026-11-12' } })).status, 404);
  reponse = { error: { code: 104, message: 'usage_limit_reached' } };
  const err = await call('POST', '/api/admin/vols/importer', { token: AD, body: { numero: 'ZY100' } });
  assert.equal(err.status, 502);
  assert.match(err.json.erreur, /usage_limit_reached/);
});

test('vols automatiques : désactivés sans clé, et statut visible côté passager', async () => {
  assert.equal(creerFournisseur({}), null);
  assert.equal(creerFournisseur({ FLIGHT_API_KEY: 'x' }).nom, 'aviationstack');
  assert.throws(() => creerFournisseur({ FLIGHT_API_KEY: 'x', FLIGHT_API_PROVIDER: 'inconnu' }));
  const { call, AD, repo } = await demarrer();
  assert.equal((await call('GET', '/api/admin/vols', { token: AD })).json.actif, false);
  assert.equal((await call('POST', '/api/admin/vols/importer', { token: AD, body: { numero: 'ZY100' } })).status, 503);
  const vol = await repo.findOne('vols', { numero: 'DEMO-101' });
  await repo.update('vols', vol.id, { statut: 'RETARDE', retardMin: 40, date: '2026-11-12' });
  const v = (await call('GET', '/api/suivi/ACG123', { query: { nom: 'Mbemba' } })).json;
  assert.equal(v.vol.libelleStatut, 'Retardé');
  assert.equal(v.vol.retardMin, 40);
});

test('lecteurs RFID : authentification par clé, passages enregistrés, relectures ignorées', async () => {
  const CLE = 'cle-lecteur-de-test-0123456789abcdef';
  const { call, repo, AD } = await demarrer({ cleLecteurRfid: CLE });
  const sansCle = await call('POST', '/api/rfid/lecture', { body: { code: 'AC000000', point: 'FIH-TRI' } });
  assert.equal(sansCle.status, 401);
  const mauvaise = await call('POST', '/api/rfid/lecture', { body: { code: 'AC000000', point: 'FIH-TRI' }, headers: { 'x-lecteur-cle': 'autre' } });
  assert.equal(mauvaise.status, 401);

  // bagage VIP en attente : ACB456 n'est pas VIP, on crée un bagage pour la passagère VIP via le personnel
  const res = await repo.findOne('reservations', { pnr: 'ACV777' });
  const b = (await repo.find('bagages', { reservationId: res.id }))[0];
  const h = { 'x-lecteur-cle': CLE };
  const reLecture = await call('POST', '/api/rfid/lecture', { headers: h, body: { lectures: [{ code: b.code, point: 'FIH-TRI' }, { code: b.code, point: 'fih-sou' }, { code: 'AC999999', point: 'FIH-TRI' }, { code: b.code, point: 'XXX-1' }] } });
  assert.equal(reLecture.status, 200);
  const [r1, r2, r3, r4] = reLecture.json.resultats;
  assert.equal(r1.ok, true); assert.equal(r1.ignore, true); // déjà passé par ce point : relecture sans erreur
  assert.equal(r2.ok, true); assert.equal(r2.statut, 'ARRIVE'); // avance à l'étape suivante
  assert.equal(r3.ok, false); // bagage inconnu
  assert.equal(r4.ok, false); // point inconnu
  const sc = (await call('GET', '/api/suivi/ACV777', { query: { nom: 'Kabila' } })).json.bagages.find((x) => x.code === b.code).scans.at(-1);
  assert.equal(sc.source, 'RFID');
  assert.equal(sc.agent, 'Portique FIH-SOU');
  // désactivé sans clé configurée
  const { call: call2 } = await demarrer();
  assert.equal((await call2('POST', '/api/rfid/lecture', { body: { code: 'x', point: 'y' }, headers: h })).status, 503);
});

test('capacité de soute et revente de l\'espace libre', async () => {
  const { call, AD, AG } = await demarrer();
  assert.equal((await call('GET', '/api/admin/capacite', { token: AG })).status, 403);
  const cap = (await call('GET', '/api/admin/capacite', { token: AD })).json;
  const v101 = cap.vols.find((v) => v.numero === 'DEMO-101');
  assert.equal(v101.capaciteKg, 150);
  assert.equal(v101.fretKg, 20);
  assert.equal(v101.recettesFretUsd, 120);
  assert.equal(v101.libreKg, Math.round((150 - v101.bagagesKg - 20) * 100) / 100);
  assert.equal(v101.potentielUsd, Math.round(v101.libreKg * 6 * 100) / 100);
  assert.equal(cap.ventes.length, 1);

  const vendre = (token, body) => call('POST', '/api/agent/ventes-espace', { token, body });
  assert.equal((await vendre(undefined, { volId: v101.id, kg: 5, client: 'X Y' })).status, 401);
  assert.equal((await vendre(AG, { volId: v101.id, kg: 5000, client: 'Gros client' })).status, 409); // trop lourd
  assert.equal((await vendre(AG, { volId: v101.id, kg: -2, client: 'Gros client' })).status, 400);
  assert.equal((await vendre(AG, { volId: v101.id, kg: 5, client: '' })).status, 400);
  assert.equal((await vendre(AG, { volId: 'inconnu', kg: 5, client: 'Client' })).status, 404);
  const ok = await vendre(AG, { volId: v101.id, kg: 10, client: 'Boutique Mode', prixUsdKg: 8 });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.montantUsd, 80);
  assert.equal(ok.json.agent, 'Agent FIH');
  const apres = (await call('GET', '/api/admin/capacite', { token: AD })).json.vols.find((v) => v.numero === 'DEMO-101');
  assert.equal(apres.fretKg, 30);
  assert.equal(apres.recettesFretUsd, 200);
  assert.equal(apres.libreKg, Math.round((v101.libreKg - 10) * 100) / 100);

  const maj = await call('PATCH', `/api/admin/vols/${v101.id}`, { token: AD, body: { capaciteKg: 400, prixReventeUsdKg: 5 } });
  assert.equal(maj.json.capaciteKg, 400);
  assert.equal((await call('PATCH', `/api/admin/vols/${v101.id}`, { token: AD, body: { capaciteKg: -1 } })).status, 400);
  assert.equal((await call('PATCH', `/api/admin/vols/${v101.id}`, { token: AG, body: { capaciteKg: 400 } })).status, 403);
});

test('radar : positions, bagages réservés au personnel, recherche par compagnie', async () => {
  const { call, AD, AG } = await demarrer();
  const radar = (await call('GET', '/api/radar')).json; // public
  assert.equal(radar.vols.length, 4);
  const v101 = radar.vols.find((v) => v.numero === 'DEMO-101');
  const v205 = radar.vols.find((v) => v.numero === 'DEMO-205');
  assert.equal(v101.phase, 'EN_VOL');
  assert.ok(v101.progression > 0.3 && v101.progression < 0.6);
  // L'avion est bien entre Kinshasa (lon 15,4) et Lubumbashi (lon 27,5)
  assert.ok(v101.position.lon > 15.4 && v101.position.lon < 27.6 && v101.position.lat < -4 && v101.position.lat > -11.6);
  assert.equal(v205.phase, 'AU_SOL');
  assert.equal(v205.achatOuvert, true);
  assert.equal(v101.achatOuvert, false);
  assert.equal(JSON.stringify(radar).includes('Mbemba'), false); // aucun nom de passager en public

  // Recherche par nom de compagnie (sans accents ni casse)
  assert.equal((await call('GET', '/api/radar', { query: { compagnie: 'air CONGO' } })).json.vols.length, 3);
  assert.equal((await call('GET', '/api/radar', { query: { compagnie: 'congo airways' } })).json.vols.length, 1);
  assert.equal((await call('GET', '/api/radar', { query: { compagnie: 'Lufthansa' } })).json.vols.length, 0);
  const sugg = (await call('GET', '/api/radar/compagnies', { query: { q: 'kenya' } })).json;
  assert.equal(sugg[0].nom, 'Kenya Airways');

  // Bagages d'un avion en vol : personnel seulement
  assert.equal((await call('GET', `/api/agent/radar/vols/${v101.id}`)).status, 401);
  const fiche = (await call('GET', `/api/agent/radar/vols/${v101.id}`, { token: AG })).json;
  assert.equal(fiche.bagages.length, 4);
  assert.ok(fiche.bagages.every((b) => b.code && b.passager));
  assert.equal((await call('GET', `/api/radar/vols/${v101.id}`)).json.bagages, undefined);

  // Achat d'espace en ligne (Mobile Money simulé) : seulement avant le décollage
  const acheter = (body) => call('POST', '/api/espace/acheter', { body });
  const bon = { volId: v205.id, kg: 10, nom: 'Marie Kasongo', telephone: '0812345678', operateur: 'MPESA' };
  assert.equal((await acheter({ ...bon, volId: v101.id })).status, 409); // déjà décollé
  assert.equal((await acheter({ ...bon, kg: 500 })).status, 400); // plafond en ligne
  assert.equal((await acheter({ ...bon, kg: 0 })).status, 400);
  assert.equal((await acheter({ ...bon, telephone: '123' })).status, 400);
  assert.equal((await acheter({ ...bon, operateur: 'PAYPAL' })).status, 400);
  assert.equal((await acheter({ ...bon, nom: '' })).status, 400);
  assert.equal((await acheter({ ...bon, volId: 'inconnu' })).status, 404);
  const avant = v205.libreKg;
  const rec = await acheter(bon);
  assert.equal(rec.status, 200);
  assert.match(rec.json.reference, /^ES-[0-9A-F]{8}$/);
  assert.equal(rec.json.montantUsd, 60);
  assert.equal(rec.json.paiement, 'SIMULE');
  assert.equal(rec.json.telephone.includes('812345'), false); // numéro masqué
  const apres = (await call('GET', '/api/radar')).json.vols.find((v) => v.numero === 'DEMO-205');
  assert.equal(apres.libreKg, Math.round((avant - 10) * 100) / 100);
  assert.equal((await acheter({ ...bon, kg: 50 })).status, 200); // il reste de la place
  assert.equal((await acheter({ ...bon, kg: 30 })).status, 409); // espace insuffisant refusé
  const cap = (await call('GET', '/api/admin/capacite', { token: AD })).json;
  assert.ok(cap.ventes.some((x) => x.reference === rec.json.reference && x.type === 'EN_LIGNE'));
});

test('import des vols par nom de compagnie', async () => {
  const sans = await demarrer();
  assert.equal((await sans.call('POST', '/api/admin/vols/importer-compagnie', { token: sans.AD, body: { compagnie: 'Kenya Airways' } })).status, 503);
  const appels = [];
  const bientot = new Date(Date.now() + 2 * 3600000).toISOString(); // heure locale UTC+1 dans 1 h
  const plusTard = new Date(Date.now() + 6 * 3600000).toISOString();
  const fetchImpl = async (u) => { appels.push(String(u)); return { json: async () => ({ data: [
    { flight_date: bientot.slice(0, 10), flight_status: 'scheduled', departure: { iata: 'NBO', scheduled: bientot }, arrival: { iata: 'FIH', scheduled: plusTard }, airline: { name: 'Kenya Airways' }, flight: { iata: 'KQ554' } },
  ] }) }; };
  const { call, AD } = await demarrer({ fournisseurVols: creerFournisseurAviationstack({ cle: 'CLE', fetchImpl }) });
  assert.equal((await call('POST', '/api/admin/vols/importer-compagnie', { token: AD, body: { compagnie: 'K' } })).status, 400);
  const r = await call('POST', '/api/admin/vols/importer-compagnie', { token: AD, body: { compagnie: 'kenya airways' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.importes, 1);
  assert.match(appels[0], /airline_iata=KQ/);
  const l = (await call('GET', '/api/radar', { query: { compagnie: 'Kenya' } })).json.vols;
  assert.equal(l.length, 1);
  assert.equal(l[0].arrivee, 'FIH'); // NBO est placé grâce à la table d'aéroports
});

test('vols importés : toujours sur le radar, même vol passé ou aéroport inconnu', async () => {
  const vol = { flight_date: '2026-11-10', flight_status: 'scheduled', departure: { iata: 'YTS', scheduled: '2026-11-10T09:45:00+00:00' }, arrival: { iata: 'YAT', scheduled: '2026-11-10T11:00:00+00:00' }, airline: { name: 'Congo Airways' }, flight: { iata: '8Z600' } };
  let aeroports = [];
  const fetchImpl = async (u) => ({ json: async () => (String(u).includes('/airports') ? { data: aeroports } : { data: [vol] }) });
  const { call, AD } = await demarrer({ fournisseurVols: creerFournisseurAviationstack({ cle: 'CLE', fetchImpl }) });
  await call('POST', '/api/admin/vols/importer-compagnie', { token: AD, body: { compagnie: 'Congo Airways' } });
  // Aéroports introuvables : le vol est listé, sans position
  let radar = (await call('GET', '/api/radar')).json.vols.find((v) => v.numero === '8Z600');
  assert.ok(radar);
  assert.equal(radar.position, null);
  const l = (await call('GET', '/api/admin/vols', { token: AD })).json.vols;
  assert.match(l.find((v) => v.numero === '8Z600').raisonAbsenceRadar, /Aéroport inconnu : YTS, YAT/);
  assert.equal(l.find((v) => v.numero === 'DEMO-205').raisonAbsenceRadar, null);
  // Le fournisseur donne les coordonnées au prochain « Actualiser » : l'avion est dessiné, même si le vol date d'hier
  aeroports = [{ iata_code: 'YTS', airport_name: 'Timmins', latitude: '48.569', longitude: '-81.376' }, { iata_code: 'YAT', airport_name: 'Attawapiskat', latitude: '52.927', longitude: '-82.432' }];
  await call('POST', '/api/admin/vols/synchroniser', { token: AD });
  radar = (await call('GET', '/api/radar')).json.vols.find((v) => v.numero === '8Z600');
  assert.ok(radar.position && radar.phase === 'ARRIVE');
  assert.equal((await call('GET', '/api/admin/vols', { token: AD })).json.vols.find((v) => v.numero === '8Z600').raisonAbsenceRadar, null);
});

test('réservations : saisie au comptoir et import CSV de la liste des passagers', async () => {
  const { call, AD, AG } = await demarrer();
  const creer = (token, body) => call('POST', '/api/agent/reservations', { token, body });
  assert.equal((await creer(undefined, { pnr: 'XY1234', nom: 'A B', vol: 'DEMO-205' })).status, 401);
  assert.equal((await creer(AG, { pnr: 'x', nom: 'Jean Mukendi', vol: 'DEMO-205' })).status, 400);
  assert.equal((await creer(AG, { pnr: 'XY1234', nom: 'Jean Mukendi', vol: 'NOPE-1' })).status, 404);
  assert.equal((await creer(AG, { pnr: 'XY1234', nom: 'Jean Mukendi', vol: 'DEMO-205', classe: 'LUXE' })).status, 400);
  const ok = await creer(AG, { pnr: 'xy1234', nom: 'Jean Mukendi', vol: 'demo-205', classe: 'vip', telephone: '0812345678', canalAlerte: 'WHATSAPP' });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.creee, true);
  // le passager peut ensuite suivre avec PNR + nom
  assert.equal((await call('GET', '/api/suivi/XY1234', { query: { nom: 'Jean Mukendi' } })).status, 200);

  const csv = 'PNR;Nom;Classe;Vol;Téléphone;Canal\nAB1001;Kasongo Marie;ECO;DEMO-101;0811111111;SMS\nAB1002;"Ilunga, Paul";BUSINESS;DEMO-101;;WHATSAPP\nAB1001;Doublon;ECO;DEMO-101;;\nAB1003;Sans Vol;ECO;ZZ999;;\nXY1234;Jean Mukendi;ECO;DEMO-205;;';
  assert.equal((await call('POST', '/api/admin/reservations/importer', { token: AG, body: { csv } })).status, 403);
  const imp = (await call('POST', '/api/admin/reservations/importer', { token: AD, body: { csv } })).json;
  assert.equal(imp.crees, 2);
  assert.equal(imp.mis_a_jour, 1);
  assert.deepEqual(imp.erreurs.map((e) => e.ligne), [4, 5]);
  assert.match(imp.erreurs[1].message, /Vol introuvable/);
  assert.equal((await call('GET', '/api/suivi/AB1002', { query: { nom: 'Ilunga, Paul' } })).status, 200);
  assert.equal((await call('POST', '/api/admin/reservations/importer', { token: AD, body: { csv: 'pnr;nom\nA;B' } })).status, 400); // colonne vol absente
  const liste = (await call('GET', '/api/admin/reservations', { token: AD })).json;
  assert.ok(liste.some((r) => r.pnr === 'AB1001' && r.vol === 'DEMO-101'));
});

test('radar : recherche par numéro de vol avec tiret', async () => {
  const { call } = await demarrer();
  assert.equal((await call('GET', '/api/radar', { query: { compagnie: 'DEMO-205' } })).json.vols.length, 1);
  assert.equal((await call('GET', '/api/radar', { query: { compagnie: 'demo 205' } })).json.vols.length, 1);
});
