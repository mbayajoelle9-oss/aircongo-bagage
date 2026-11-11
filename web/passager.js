import { lancerRadar } from '/radar.js';
import { api, esc, usd, pill, frise, heure, dateHeure, toast, ouvrirDialogue, qrImage, zoneCarte, montrerCarte, CANAUX, STATUTS } from '/common.js';

let acces;
try { acces = JSON.parse(sessionStorage.getItem('ac_pax')); } catch { acces = null; }
if (!acces?.pnr || !acces?.nom) location.replace('/index.html');

const vue = document.getElementById('vue');
document.getElementById('sortir').onclick = () => { sessionStorage.removeItem('ac_pax'); location.href = '/index.html'; };

const TYPES = { PERDU: 'Bagage perdu', ENDOMMAGE: 'Bagage endommagé', RETARDE: 'Bagage retardé', CONTENU_MANQUANT: 'Contenu manquant' };
const url = () => `/api/suivi/${encodeURIComponent(acces.pnr)}?nom=${encodeURIComponent(acces.nom)}`;
const corps = (extra = {}) => ({ nom: acces.nom, ...extra });
let donnees = null;
let ouverts = new Set();

async function charger(silencieux) {
  try {
    const nouvelles = await api('GET', url(), undefined, { auth: false });
    if (silencieux && donnees && JSON.stringify(nouvelles) === JSON.stringify(donnees)) return; // évite de recharger les cartes
    donnees = nouvelles;
    await afficher();
  } catch (e) {
    if (silencieux) return;
    vue.innerHTML = `<div class="carte"><div class="erreur" style="margin:0">${esc(e.message)}</div><p><a href="/index.html">Retour à la connexion</a></p></div>`;
  }
}

const CLASSE_VOL = { PREVU: 'bleu', RETARDE: 'rouge', EN_VOL: 'bleu', ATTERRI: 'vert' };
function volEtat(v) {
  const bits = [];
  if (v.date) bits.push(new Date(v.date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }));
  if (v.terminal) bits.push(`Terminal ${esc(v.terminal)}`);
  if (v.porte) bits.push(`Porte ${esc(v.porte)}`);
  if (v.retardMin > 0) bits.push(`Retard estimé : ${v.retardMin} min${v.heureDepartEstimee ? ` (départ vers ${esc(v.heureDepartEstimee)})` : ''}`);
  if (!v.libelleStatut && !bits.length) return '';
  return `<div class="vol-etat">${v.libelleStatut ? `<span class="pill ${CLASSE_VOL[v.statut] ?? 'rouge'}">${esc(v.libelleStatut)}</span> ` : ''}<span>${bits.join(' · ')}</span></div>`;
}

async function afficher() {
  const d = donnees, ex = d.excedent;
  const qrs = await Promise.all(d.bagages.map((b) => qrImage(b.code)));
  const nbSans = d.bagages.filter((b) => b.statut === 'PRE_ENREGISTRE').length;

  vue.innerHTML = `
  <section class="billet">
    <div class="tete"><span>${esc(d.nom)}</span><span>Réservation ${esc(d.pnr)} · ${esc(d.classe)}</span></div>
    <div class="corps">
      <div class="ville"><b>${esc(d.vol.depart)}</b><span>Départ ${esc(d.vol.heureDepart)}</span></div>
      <div class="trait"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12h18M14 6l6 6-6 6"/></svg></div>
      <div class="ville d"><b>${esc(d.vol.arrivee)}</b><span>Vol ${esc(d.vol.numero)}</span></div>
    </div>
    ${volEtat(d.vol)}
    <div class="pied"><div><b>${d.bagages.length}</b>bagage(s)</div><div><b>${ex.totalKg} kg</b>poids total</div><div><b>${ex.franchiseKg} kg</b>franchise incluse</div></div>
  </section>

  ${ex.kgRestants > 0 ? `<section class="carte excedent-pax"><h2>Excédent de bagage</h2>
    <p style="margin:4px 0 12px">Vous dépassez la franchise de <b>${ex.excesKg} kg</b>. Réglez en ligne maintenant et évitez la file au comptoir.</p>
    <div class="prix"><div><span class="muted petit">Au comptoir</span><b class="barre-prix">${usd(ex.montantComptoirUsd)}</b></div><div><span class="muted petit">En ligne (−20 %)</span><b class="vert-t">${usd(ex.montantEnLigneUsd)}</b></div></div>
    <button class="btn vert bloc" id="payer" style="margin-top:14px">Payer ${usd(ex.montantEnLigneUsd)} en ligne</button>
    <p class="muted petit" style="margin:8px 0 0">Paiement simulé dans cette démonstration.</p></section>`
    : ex.excesKg > 0 ? '<section class="carte"><div class="excedent ok">Excédent réglé. Merci !</div></section>' : ''}

  <div class="actions-pax"><a class="btn sec" href="#radarVue">✈ Mon vol sur le radar</a><a class="btn vert" href="#radarVue">Acheter de l’espace en soute</a></div>
  <section class="carte"><h2 style="margin:0">Mes bagages <span class="live">● suivi en direct</span></h2>
    ${nbSans ? `<p class="muted petit" style="margin:10px 0 0">Votre étiquette est émise par Air Congo. Le bagage apparaît ici dès son premier passage en station.</p>` : ''}
    ${d.bagages.length ? d.bagages.map((b, i) => `
      <article class="sac" style="margin-top:18px;padding-top:18px;border-top:1px solid var(--bord)">
        <div class="qr">${qrs[i] || `<div class="sans">QR indisponible<br>utilisez le code</div>`}</div>
        <div>
          <div class="code mono">${esc(b.code)}</div>
          <div style="margin:6px 0">${pill(b.statut)} <span class="muted petit">${b.poidsKg} kg ${b.poidsReel ? '(pesé)' : '(déclaré)'}</span> ${b.niveau === 'VIP' ? '<span class="pill vip">VIP · RFID</span>' : ''}</div>
          ${b.statut === 'PRE_ENREGISTRE' ? '<p class="muted petit" style="margin:8px 0 0">En attente de dépôt en station.</p>' : frise(b.statut)}
          <div class="legende-carte">Chemin suivi par le bagage, point de scan par point de scan :</div>${zoneCarte(280)}
          <details data-code="${esc(b.code)}" ${ouverts.has(b.code) ? 'open' : ''}><summary>Historique (${b.scans.length})</summary>
            ${b.scans.length ? `<ul class="fil">${b.scans.map((s) => `<li><span class="t">${heure(s.ts)}</span><span>${esc(s.pointNom ?? STATUTS[s.etape]?.label ?? s.etape)}<br><span class="muted petit">${esc(STATUTS[s.etape]?.label ?? s.etape)} · ${esc(s.station)}</span></span></li>`).join('')}</ul>` : '<p class="muted petit">Aucun mouvement pour l’instant.</p>'}
          </details>
          <button class="btn danger mini" data-litige="${esc(b.code)}" style="margin-top:10px">Signaler un problème</button>
        </div>
      </article>`).join('') : '<p class="muted" style="margin-top:14px">Aucun bagage n’est encore associé à cette réservation. Présentez-vous au comptoir Air Congo : l’agent émet l’étiquette de chaque bagage.</p>'}
  </section>
  <section class="carte"><h2>Alertes de suivi</h2>
    <p class="muted petit" style="margin:0 0 6px">${d.telephone ? `Envoyées par ${esc(CANAUX[d.canalAlerte] ?? d.canalAlerte)} au ${esc(d.telephone)}. ` : ''}Aucune application à installer : ce suivi fonctionne sur tout téléphone et ordinateur, et les SMS sur les téléphones simples.</p>
    ${d.notifications.length ? `<ul class="notifs">${d.notifications.slice(0, 12).map((n) => `<li><span class="canal">${esc(CANAUX[n.canal] ?? n.canal)}</span><span>${esc(n.message)}</span></li>`).join('')}</ul>` : '<p class="muted">Aucune alerte pour le moment. Vous en recevrez une à chaque scan de vos bagages.</p>'}
  </section>
  <p class="muted petit" style="text-align:center">Mise à jour automatique · dernière à ${heure(new Date().toISOString())}</p>`;

  document.querySelectorAll('.osm').forEach((el, i) => montrerCarte(el, { scans: d.bagages[i].scans }));
  document.querySelectorAll('details[data-code]').forEach((el) => (el.ontoggle = () => (el.open ? ouverts.add(el.dataset.code) : ouverts.delete(el.dataset.code))));

  const p = document.getElementById('payer');
  if (p) p.onclick = async () => {
    p.disabled = true;
    try { await api('POST', `/api/suivi/${encodeURIComponent(acces.pnr)}/payer`, corps(), { auth: false }); toast('Paiement reçu'); await charger(); }
    catch (e) { toast(e.message, 'err'); p.disabled = false; }
  };
  document.querySelectorAll('[data-litige]').forEach((b) => (b.onclick = () => litige(b.dataset.litige)));
}

function litige(code) {
  const d = ouvrirDialogue(`<h2>Signaler un problème</h2><p class="muted petit mono" style="margin:2px 0 0">${esc(code)}</p>
    <form id="f"><label class="champ">Nature du problème<select class="input" name="type">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
    <label class="champ">Description<textarea class="input" name="description" rows="4" minlength="5" maxlength="1000" required placeholder="Décrivez ce qui s'est passé…"></textarea></label>
    <div id="e" class="erreur" hidden></div>
    <div class="actions"><button type="button" class="btn sec" id="ann">Annuler</button><button class="btn" type="submit">Envoyer la déclaration</button></div></form>`);
  d.querySelector('#ann').onclick = () => d.close();
  d.querySelector('#f').onsubmit = async (ev) => {
    ev.preventDefault();
    try {
      const r = await api('POST', `/api/suivi/${encodeURIComponent(acces.pnr)}/litiges`, corps({ code, type: ev.target.type.value, description: ev.target.description.value }), { auth: false });
      d.close(); toast(`Déclaration enregistrée : dossier ${r.numero}`);
    } catch (e) { const el = d.querySelector('#e'); el.textContent = e.message; el.hidden = false; }
  };
}

await charger();
if (donnees) { // le radar est monté une seule fois, hors de la zone rafraîchie ; l'avion du passager est ouvert d'emblée
  document.getElementById('radarVue').hidden = false;
  lancerRadar(document.getElementById('radarZone'), { personnel: false, filtre: donnees.vol.numero, ouvrir: donnees.vol.numero, mesBagages: () => donnees?.bagages ?? [] }).catch((e) => console.error('radar', e));
}
const t = setInterval(() => { if (!document.hidden && !document.querySelector('dialog[open]')) charger(true); }, 8000);
window.addEventListener('pagehide', () => clearInterval(t));
