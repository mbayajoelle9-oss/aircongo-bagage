import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRepo } from '../src/repo.memory.js';
import { chargerDemo, HttpError } from '../src/logic.js';
import { construireRoutes } from '../src/routes.js';

// Simule ce que fait l'adaptateur Express : trouve la route, extrait les paramètres, appelle le handler.
async function demarrer() {
  const repo = new MemoryRepo();
  await chargerDemo(repo);
  const routes = construireRoutes(repo, { agentKey: 'cle-agent-test', adminKey: 'cle-admin-test', demoResetAutorise: true });
  const call = async (method, url, { body = {}, key, query = {} } = {}) => {
    for (const r of routes) {
      if (r.method !== method) continue;
      const re = new RegExp('^' + r.path.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$');
      const m = re.exec(url);
      if (!m) continue;
      try {
        const json = await r.handler({ params: { ...m.groups }, body, query, headers: key ? { 'x-api-key': key } : {} });
        return { status: 200, json };
      } catch (e) {
        if (e instanceof HttpError) return { status: e.status, json: { erreur: e.message } };
        throw e;
      }
    }
    return { status: 404, json: null };
  };
  return { repo, call };
}
const AG = 'cle-agent-test';
const AD = 'cle-admin-test';

test('suivi passager : bon nom requis', async () => {
  const { call } = await demarrer();
  assert.equal((await call('GET', '/api/suivi/ACG123', { query: { nom: 'Mbemba' } })).status, 200);
  assert.equal((await call('GET', '/api/suivi/acg123', { query: { nom: 'mbemba' } })).status, 200);
  assert.equal((await call('GET', '/api/suivi/ACG123', { query: { nom: 'Dupont' } })).status, 403);
  assert.equal((await call('GET', '/api/suivi/ACG123')).status, 403);
  assert.equal((await call('GET', '/api/suivi/ZZZ999', { query: { nom: 'Mbemba' } })).status, 404);
});

test('données démo : excédent, alerte, VIP', async () => {
  const { call } = await demarrer();
  const m = (await call('GET', '/api/suivi/ACG123', { query: { nom: 'Mbemba' } })).json;
  assert.equal(m.excedent.excesKg, 7.5); // 30,5 kg - 23 kg
  assert.equal(m.excedent.montantComptoirUsd, 75);
  assert.equal(m.excedent.montantEnLigneUsd, 60);
  const s = (await call('GET', '/api/admin/stats', { key: AD })).json;
  assert.equal(s.totalBagages, 5);
  assert.equal(s.vip, 2);
  assert.equal(s.alertes, 1);
});

test('scénario complet : pré-enregistrement -> livraison + paiement', async () => {
  const { call } = await demarrer();
  const ajout = await call('POST', '/api/suivi/ACB456/bagages', { body: { nom: 'Tshimanga', poidsKg: 15 } });
  assert.equal(ajout.status, 200);
  const code = ajout.json.code;
  assert.match(code, /^AC\d{6}$/);
  assert.equal(ajout.json.reservation.excedent.excesKg, 3);

  const paye = await call('POST', '/api/suivi/ACB456/payer', { body: { nom: 'Tshimanga' } });
  assert.equal(paye.json.paiement.montantUsd, 24);
  assert.equal(paye.json.excedent.kgRestants, 0);
  assert.equal((await call('POST', '/api/suivi/ACB456/payer', { body: { nom: 'Tshimanga' } })).status, 409);

  assert.equal((await call('POST', '/api/agent/scans', { body: { code, etape: 'ENREGISTRE', station: 'FIH' } })).status, 401);
  assert.equal((await call('POST', '/api/agent/scans', { body: { code, etape: 'ENREGISTRE', station: 'FIH' }, key: 'mauvaise' })).status, 401);

  const s1 = await call('POST', '/api/agent/scans', { body: { code, etape: 'ENREGISTRE', station: 'FIH', poidsKg: 15.2 }, key: AG });
  assert.equal(s1.status, 200);
  assert.equal(s1.json.bagage.poidsReel, true);
  assert.equal((await call('POST', '/api/agent/scans', { body: { code, etape: 'ENREGISTRE', station: 'FIH' }, key: AG })).status, 409);
  const s2 = await call('POST', '/api/agent/scans', { body: { code, etape: 'ARRIVE', station: 'GOM' }, key: AG });
  assert.equal(s2.status, 200);
  assert.ok(s2.json.avertissement);
  const s3 = await call('POST', '/api/agent/scans', { body: { code, etape: 'LIVRE', station: 'GOM' }, key: AG });
  assert.equal(s3.json.bagage.statut, 'LIVRE');
  assert.equal((await call('POST', '/api/agent/scans', { body: { code, etape: 'XYZ', station: 'GOM' }, key: AG })).status, 400);

  const s = (await call('GET', '/api/admin/stats', { key: AD })).json;
  assert.equal(s.recettesExcedentUsd, 24);
  assert.equal((await call('GET', '/api/admin/stats', { key: AG })).status, 401); // la clé agent n'ouvre pas l'admin
});

test('litiges : création par le passager, suivi par la compagnie', async () => {
  const { call, repo } = await demarrer();
  const res = await repo.findOne('reservations', { pnr: 'ACG123' });
  const bag = (await repo.find('bagages', { reservationId: res.id }))[0];
  const mauvais = await call('POST', '/api/suivi/ACV777/litiges', { body: { nom: 'Kabila', code: bag.code, type: 'PERDU', description: 'Bagage non reçu' } });
  assert.equal(mauvais.status, 403);
  const ok = await call('POST', '/api/suivi/ACG123/litiges', { body: { nom: 'Mbemba', code: bag.code, type: 'RETARDE', description: 'Toujours pas arrivé' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.numero, 'LIT-0001');
  const maj = await call('PATCH', '/api/admin/litiges/LIT-0001', { body: { statut: 'EN_COURS' }, key: AD });
  assert.equal(maj.json.statut, 'EN_COURS');
  assert.equal((await call('PATCH', '/api/admin/litiges/LIT-0001', { body: { statut: 'NIMPORTE' }, key: AD })).status, 400);
  assert.equal((await call('GET', '/api/admin/litiges', { key: AD })).json.length, 1);
});

test('validations', async () => {
  const { call } = await demarrer();
  assert.equal((await call('POST', '/api/suivi/ACG123/bagages', { body: { nom: 'Mbemba', poidsKg: -3 } })).status, 400);
  assert.equal((await call('POST', '/api/suivi/ACG123/bagages', { body: { nom: 'Mbemba', poidsKg: 500 } })).status, 400);
  assert.equal((await call('POST', '/api/suivi/ACG123/bagages', { body: { nom: 'Mbemba', poidsKg: 'abc' } })).status, 400);
  assert.equal((await call('GET', '/api/health')).json.ok, true);
});

test('reset démo protégé', async () => {
  const { call } = await demarrer();
  assert.equal((await call('POST', '/api/admin/demo/reset', { key: AG })).status, 401);
  assert.equal((await call('POST', '/api/admin/demo/reset', { key: AD })).status, 200);
  assert.equal((await call('GET', '/api/admin/stats', { key: AD })).json.totalBagages, 5);
});
