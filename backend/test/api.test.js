import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRepo } from '../src/repo.memory.js';
import { chargerDemo, HttpError } from '../src/logic.js';
import { creerUtilisateur } from '../src/utilisateurs.js';
import { signerJeton, verifierJeton } from '../src/auth.js';
import { construireRoutes } from '../src/routes.js';

const SECRET = 'secret-de-test-assez-long-pour-etre-valide-123456';

// Simule l'adaptateur Express : trouve la route, extrait les paramètres, appelle le handler.
async function demarrer() {
  const repo = new MemoryRepo();
  await chargerDemo(repo);
  await creerUtilisateur(repo, { nom: 'Admin Test', email: 'admin@test.cd', motDePasse: 'motdepasse-admin-1', role: 'ADMIN' });
  await creerUtilisateur(repo, { nom: 'Agent FIH', email: 'agent@test.cd', motDePasse: 'motdepasse-agent-1', role: 'AGENT', station: 'fih' });
  const routes = construireRoutes(repo, { jwtSecret: SECRET, demoResetAutorise: true });
  const call = async (method, url, { body = {}, token, query = {} } = {}) => {
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = new RegExp('^' + r.path.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$').exec(url);
      if (!m) continue;
      try {
        const json = await r.handler({ params: { ...m.groups }, body, query, headers: token ? { authorization: 'Bearer ' + token } : {} });
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

  assert.equal((await call('POST', '/api/agent/scans', { body: { code, etape: 'ENREGISTRE' } })).status, 401);
  const s1 = await call('POST', '/api/agent/scans', { token: AG, body: { code, etape: 'ENREGISTRE', station: 'GOM', agent: 'Usurpateur', poidsKg: 15.2 } });
  assert.equal(s1.status, 200);
  assert.equal(s1.json.scan.station, 'FIH'); // la station de l'agent l'emporte
  assert.equal(s1.json.scan.agent, 'Agent FIH'); // l'identité vient du compte
  assert.equal(s1.json.bagage.poidsReel, true);
  assert.equal((await call('POST', '/api/agent/scans', { token: AG, body: { code, etape: 'ENREGISTRE' } })).status, 409);
  const s2 = await call('POST', '/api/agent/scans', { token: AD, body: { code, etape: 'ARRIVE', station: 'GOM' } });
  assert.ok(s2.json.avertissement);
  assert.equal(s2.json.scan.station, 'GOM'); // l'admin peut choisir
  const s3 = await call('POST', '/api/agent/scans', { token: AG, body: { code, etape: 'LIVRE' } });
  assert.equal(s3.json.bagage.statut, 'LIVRE');
  assert.equal((await call('POST', '/api/agent/scans', { token: AG, body: { code, etape: 'XYZ' } })).status, 400);
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
  assert.equal(v.notifications.length, 4); // 2 bagages x (enregistré, chargé)
  assert.match(v.notifications[0].message, /^Air Congo : votre bagage AC\d{6} .* \(FIH\)/);
  assert.ok(!v.telephone.includes('000 000 002'));
  const cfg = (await call('GET', '/api/config')).json;
  assert.ok(cfg.stations.FIH && cfg.stations.FBM);
  const r = await call('POST', '/api/admin/utilisateurs', { token: AD, body: { nom: 'X Y', email: 'x@y.cd', motDePasse: 'motdepasse-123', role: 'AGENT', station: 'ZZZ' } });
  assert.equal(r.status, 400);
});
