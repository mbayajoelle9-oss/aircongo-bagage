import { lancerRadar } from '/radar.js';
import { api, session, esc, heure, dateHeure, usd, pill, frise, icone, toast, ouvrirDialogue, qrImage, zoneCarte, montrerCarte, chargerStations, CANAUX, STATUTS } from '/common.js';

const moi = session.user;
let STATIONS_INFO = {};
const ESPACE = document.body.dataset.espace;
if (!session.token || !moi) location.replace('/index.html');
// Console web : réservée à l'administration. Les agents travaillent sur leur téléphone (/agent.html).
else if (ESPACE === 'admin' && moi.role !== 'ADMIN') location.replace('/agent.html');

const $ = (id) => document.getElementById(id);
const vue = $('vue');
const EST_ADMIN = moi?.role === 'ADMIN';
let STATIONS = [];

const TYPES_LITIGE = { PERDU: 'Perdu', ENDOMMAGE: 'Endommagé', RETARDE: 'Retardé', CONTENU_MANQUANT: 'Contenu manquant' };
const STATUTS_LITIGE = { OUVERT: 'Ouvert', EN_COURS: 'En cours', RESOLU: 'Résolu' };

const PAGES = [
  { id: 'radar', titre: 'Radar des vols', ico: 'avion', admin: false },
  { id: 'dashboard', titre: 'Tableau de bord', ico: 'grille', admin: true },
  { id: 'capacite', titre: 'Capacité & revente', ico: 'dollar', admin: true },
  { id: 'vols', titre: 'Vols', ico: 'avion', admin: true },
  { id: 'reservations', titre: 'Passagers', ico: 'equipe', admin: false },
  { id: 'carte', titre: 'Carte & points', ico: 'epingle', admin: true },
  { id: 'bagages', titre: 'Bagages', ico: 'bagage', admin: true },
  { id: 'litiges', titre: 'Litiges', ico: 'alerte', admin: true },
  { id: 'utilisateurs', titre: 'Utilisateurs', ico: 'equipe', admin: true },
  { id: 'scanner', titre: 'Scanner', ico: 'scan', admin: false },
].filter((p) => EST_ADMIN || !p.admin).sort((a, b) => (EST_ADMIN ? 0 : (a.id === 'radar') - (b.id === 'radar')));

let nettoyages = [];
const surDepart = (fn) => nettoyages.push(fn);

// ---------- Menu ----------
$('moiNom').textContent = moi?.nom ?? '';
$('moiRole').textContent = EST_ADMIN ? 'Administrateur' : `Agent · station ${moi?.station ?? ''}`;
$('sortir').innerHTML = `${icone('sortie')} Se déconnecter`;
$('sortir').onclick = () => { session.clear(); location.href = '/index.html'; };

function menu(actif) {
  $('nav').innerHTML = PAGES.map((p) => `<a href="#/${p.id}" class="${p.id === actif ? 'actif' : ''}">${icone(p.ico)}<span>${p.titre}</span></a>`).join('');
}

// ---------- Routage ----------
async function naviguer() {
  if (!STATIONS.length) { STATIONS_INFO = await chargerStations(); STATIONS = Object.keys(STATIONS_INFO); }
  nettoyages.forEach((f) => f());
  nettoyages = [];
  const id = location.hash.replace('#/', '') || PAGES[0].id;
  const page = PAGES.find((p) => p.id === id) ?? PAGES[0];
  menu(page.id);
  vue.innerHTML = '<div class="chargement">Chargement…</div>';
  try {
    await ({ radar: vueRadar, dashboard: vueDashboard, carte: vueCarte, vols: vueVols, capacite: vueCapacite, reservations: vueReservations, bagages: vueBagages, litiges: vueLitiges, utilisateurs: vueUtilisateurs, scanner: vueScanner })[page.id]();
  } catch (e) {
    vue.innerHTML = `<div class="carte"><div class="erreur" style="margin:0">${esc(e.message)}</div></div>`;
  }
}
window.addEventListener('hashchange', naviguer);

const entete = (titre, sous, droite = '') =>
  `<div class="entete"><div><h1>${esc(titre)}</h1><p>${esc(sous)}</p></div><div>${droite}</div></div>`;

// ============================================================
// Tableau de bord
// ============================================================
async function vueDashboard() {
  vue.innerHTML =
    entete('Tableau de bord', 'Situation des bagages en temps réel', '<span class="muted petit" id="maj"></span>') +
    '<div class="kpis" id="kpis"></div>' +
    '<div class="grille2"><div class="carte"><h2>Répartition par étape</h2><div id="barres" class="barres"></div></div>' +
    '<div class="carte"><h2>Alertes</h2><div id="alertes"></div></div></div>' +
    '<div class="carte"><h2>Activité récente</h2><ul class="fil" id="fil"></ul></div>';

  const charger = async () => {
    const [s, a, b, cap] = await Promise.all([api('GET', '/api/admin/stats'), api('GET', '/api/admin/alertes'), api('GET', '/api/admin/bagages'), api('GET', '/api/admin/capacite')]);
    const libre = cap.vols.reduce((n, v) => n + v.libreKg, 0), potentiel = cap.vols.reduce((n, v) => n + v.potentielUsd, 0), fret = cap.vols.reduce((n, v) => n + v.recettesFretUsd, 0);
    const p = s.parStatut;
    const circulation = ['ENREGISTRE', 'CHARGE', 'TRANSIT', 'ARRIVE'].reduce((n, k) => n + (p[k] ?? 0), 0);
    $('kpis').innerHTML = [
      ['Bagages suivis', s.totalBagages, ''],
      ['En circulation', circulation, ''],
      ['Alertes', s.alertes, s.alertes ? 'rouge' : 'vert'],
      ['Litiges ouverts', s.litigesOuverts, s.litigesOuverts ? 'jaune' : 'vert'],
      ['Recettes excédents', usd(s.recettesExcedentUsd), 'vert'],
      ['Espace libre à revendre', `${Math.round(libre)} kg · ${usd(potentiel)}`, libre > 0 ? 'jaune' : ''],
      ['Recettes fret', usd(fret), 'vert'],
    ].map(([t, v, c]) => `<div class="kpi ${c}"><span>${t}</span><b>${esc(v)}</b></div>`).join('');

    const ordre = [['PRE_ENREGISTRE', 'pre'], ['ENREGISTRE', ''], ['CHARGE', ''], ['TRANSIT', ''], ['ARRIVE', 'arr'], ['LIVRE', 'fin']];
    $('barres').innerHTML = ordre.map(([k, c]) => {
      const n = p[k] ?? 0;
      const pct = s.totalBagages ? Math.round((n / s.totalBagages) * 100) : 0;
      return `<div class="barre ${c}"><span>${esc(STATUTS[k].label)}</span><div class="piste"><i style="width:${pct}%"></i></div><b>${n}</b></div>`;
    }).join('');

    $('alertes').innerHTML = a.length
      ? a.map((x) => `<div class="alerte-ligne"><span>${icone('alerte')}</span><div><b>${esc(x.code)}</b> · ${esc(x.passager)}<br><span class="petit">${esc(x.dernierStatut)} à ${esc(x.station)} depuis ${x.minutesSansMouvement} min</span></div></div>`).join('')
      : '<div class="ok-ligne">Aucun bagage bloqué.</div>';

    const evenements = b.flatMap((x) => x.scans.map((sc) => ({ ...sc, passager: x.passager }))).sort((m, n) => n.ts.localeCompare(m.ts)).slice(0, 8);
    $('fil').innerHTML = evenements.length
      ? evenements.map((e) => `<li><span class="t">${heure(e.ts)}</span><span><b class="mono">${esc(e.code)}</b> · ${esc(e.passager)}<br><span class="muted petit">${esc(STATUTS[e.etape]?.label ?? e.etape)} · ${esc(e.pointNom ?? e.station)} (${esc(e.station)}) · ${esc(e.agent)}${e.source === 'RFID' ? ' · <b>RFID</b>' : ''}</span></span></li>`).join('')
      : '<li class="muted">Aucun mouvement pour le moment.</li>';
    $('maj').textContent = 'Mis à jour à ' + heure(new Date().toISOString());
  };
  await charger();
  const t = setInterval(() => { if (!document.hidden) charger().catch(() => {}); }, 5000);
  surDepart(() => clearInterval(t));
}

// ============================================================
// Bagages
// ============================================================
async function vueBagages() {
  const liste = await api('GET', '/api/admin/bagages');
  vue.innerHTML =
    entete('Bagages', `${liste.length} bagage(s) enregistré(s)`, `<button class="btn" id="etiq">${icone('plus')} Nouvelle étiquette</button>`) +
    `<div class="carte"><div class="outils">
      <input class="input" id="q" placeholder="Rechercher un code, un passager, un vol…" aria-label="Rechercher">
      <select class="input" id="f" style="max-width:200px" aria-label="Filtrer par statut"><option value="">Tous les statuts</option>${Object.entries(STATUTS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select>
    </div><div class="tableau"><table><thead><tr><th>Code</th><th>Passager</th><th>Vol</th><th>Poids</th><th>Statut</th><th>Dernier mouvement</th><th>Suivi</th></tr></thead><tbody id="corps"></tbody></table></div></div>`;

  const afficher = () => {
    const q = $('q').value.trim().toLowerCase(), f = $('f').value;
    const l = liste.filter((b) => (!f || b.statut === f) && (!q || [b.code, b.passager, b.vol, b.pnr].join(' ').toLowerCase().includes(q)));
    $('corps').innerHTML = l.length
      ? l.map((b) => `<tr class="clic" data-code="${esc(b.code)}"><td class="mono"><b>${esc(b.code)}</b></td><td>${esc(b.passager)}</td><td>${esc(b.vol)}</td><td>${b.poidsKg} kg</td><td>${pill(b.statut)}</td><td>${b.dernierScan ? esc(b.dernierScan.station) + ' · ' + dateHeure(b.dernierScan.ts) : '—'}</td><td>${b.niveau === 'VIP' ? '<span class="pill vip">RFID</span>' : '<span class="pill gris">Scan</span>'}</td></tr>`).join('')
      : '<tr><td colspan="7" class="vide">Aucun bagage ne correspond.</td></tr>';
    document.querySelectorAll('#corps tr.clic').forEach((tr) => (tr.onclick = () => detailBagage(liste.find((b) => b.code === tr.dataset.code))));
  };
  $('etiq').onclick = () => nouvelleEtiquette(() => vueBagages());
  $('q').oninput = afficher; $('f').onchange = afficher;
  afficher();
}

function detailBagage(b) {
  const d = ouvrirDialogue(`
    <h2 class="mono">${esc(b.code)}</h2>
    <p class="muted" style="margin:2px 0 0">${esc(b.passager)} · réservation ${esc(b.pnr)} · vol ${esc(b.vol)}</p>
    <p style="margin:10px 0 0">${pill(b.statut)} <span class="muted petit">${b.poidsKg} kg ${b.poidsReel ? '(pesé)' : '(déclaré)'} · suivi ${b.niveau === 'VIP' ? 'RFID' : 'par scan'}</span></p>
    ${frise(b.statut)}
    ${zoneCarte(300)}
    <p class="legende-carte">Points de scan franchis (vert, numérotés) ; les points bleus sont les autres points de contrôle.</p>
    <h3 style="margin-top:18px">Historique</h3>
    ${b.scans.length ? `<ul class="fil">${b.scans.map((s) => `<li><span class="t">${heure(s.ts)}</span><span>${esc(s.pointNom ?? STATUTS[s.etape]?.label ?? s.etape)}<br><span class="muted petit">${esc(STATUTS[s.etape]?.label ?? s.etape)} · ${esc(s.station)} · ${esc(s.agent)}${s.source === 'RFID' ? ' · RFID' : ''}${s.saut ? ' · étape sautée' : ''}</span></span></li>`).join('')}</ul>` : '<p class="muted">Aucun mouvement.</p>'}
    <div class="actions"><button class="btn sec" value="x">Fermer</button></div>`);
  d.querySelector('button').onclick = () => d.close();
  api('GET', '/api/admin/points').catch(() => []).then((points) => montrerCarte(d.querySelector('.osm'), { scans: b.scans, points }));
}

// ============================================================
// Litiges
// ============================================================
async function vueLitiges() {
  const liste = await api('GET', '/api/admin/litiges');
  vue.innerHTML =
    entete('Litiges', `${liste.filter((l) => l.statut !== 'RESOLU').length} dossier(s) en cours`) +
    `<div class="carte"><div class="tableau"><table><thead><tr><th>N°</th><th>Bagage</th><th>Type</th><th>Description</th><th>Date</th><th>Statut</th></tr></thead><tbody>${
      liste.length
        ? liste.map((l) => `<tr><td><b>${esc(l.numero)}</b></td><td class="mono">${esc(l.code)}</td><td>${esc(TYPES_LITIGE[l.type] ?? l.type)}</td><td style="max-width:340px">${esc(l.description)}</td><td>${dateHeure(l.creeLe)}</td><td><select class="input" style="margin:0;min-width:130px" data-num="${esc(l.numero)}" aria-label="Statut du dossier ${esc(l.numero)}">${Object.entries(STATUTS_LITIGE).map(([k, v]) => `<option value="${k}" ${k === l.statut ? 'selected' : ''}>${v}</option>`).join('')}</select></td></tr>`).join('')
        : '<tr><td colspan="6" class="vide">Aucun litige déclaré.</td></tr>'
    }</tbody></table></div></div>`;
  document.querySelectorAll('select[data-num]').forEach((s) => (s.onchange = async () => {
    try {
      await api('PATCH', `/api/admin/litiges/${encodeURIComponent(s.dataset.num)}`, { statut: s.value });
      toast(`Dossier ${s.dataset.num} : ${STATUTS_LITIGE[s.value]}`);
    } catch (e) { toast(e.message, 'err'); }
  }));
}

// ============================================================
// Utilisateurs
// ============================================================
async function vueUtilisateurs() {
  const liste = await api('GET', '/api/admin/utilisateurs');
  vue.innerHTML =
    entete('Utilisateurs', 'Comptes du personnel et rôles', `<button class="btn" id="nouveau">${icone('plus')} Nouvel utilisateur</button>`) +
    `<div class="carte"><div class="tableau"><table><thead><tr><th>Nom</th><th>E-mail</th><th>Rôle</th><th>Station</th><th>État</th><th>Dernière connexion</th><th></th></tr></thead><tbody>${
      liste.map((u) => `<tr><td><b>${esc(u.nom)}</b></td><td>${esc(u.email)}</td><td>${u.role === 'ADMIN' ? 'Administrateur' : 'Agent'}</td><td>${esc(u.station ?? '—')}</td><td>${u.actif ? '<span class="pill vert">Actif</span>' : '<span class="pill rouge">Désactivé</span>'}</td><td>${dateHeure(u.derniereConnexion)}</td><td style="white-space:nowrap">
        <button class="btn sec mini" data-mdp="${esc(u.id)}" data-nom="${esc(u.nom)}">Mot de passe</button>
        ${u.id === moi.id ? '' : `<button class="btn ${u.actif ? 'danger' : 'sec'} mini" data-actif="${esc(u.id)}" data-etat="${u.actif}">${u.actif ? 'Désactiver' : 'Réactiver'}</button>`}</td></tr>`).join('')
    }</tbody></table></div></div>`;

  $('nouveau').onclick = () => {
    const d = ouvrirDialogue(`<h2>Nouvel utilisateur</h2><p class="muted petit" style="margin:2px 0 0">Le compte est actif immédiatement.</p>
      <form id="fNouveau">
        <label class="champ">Nom complet<input class="input" name="nom" required minlength="2"></label>
        <label class="champ">Adresse e-mail<input class="input" name="email" type="email" required></label>
        <label class="champ">Mot de passe (10 caractères minimum)<input class="input" name="motDePasse" type="password" minlength="10" required autocomplete="new-password"></label>
        <div class="rang"><label class="champ">Rôle<select class="input" name="role"><option value="AGENT">Agent en station</option><option value="ADMIN">Administrateur</option></select></label>
        <label class="champ" id="chSt">Station<select class="input" name="station">${STATIONS.map((c) => `<option value="${c}">${c} · ${esc(STATIONS_INFO[c].nom)}</option>`).join('')}</select></label></div>
        <div id="eN" class="erreur" hidden></div>
        <div class="actions"><button type="button" class="btn sec" id="ann">Annuler</button><button class="btn" type="submit">Créer le compte</button></div>
      </form>`);
    const f = d.querySelector('#fNouveau');
    f.role.onchange = () => (d.querySelector('#chSt').hidden = f.role.value !== 'AGENT');
    d.querySelector('#ann').onclick = () => d.close();
    f.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api('POST', '/api/admin/utilisateurs', Object.fromEntries(new FormData(f)));
        d.close(); toast('Compte créé'); vueUtilisateurs();
      } catch (err) { const el = d.querySelector('#eN'); el.textContent = err.message; el.hidden = false; }
    };
  };
  document.querySelectorAll('[data-actif]').forEach((b) => (b.onclick = async () => {
    try {
      await api('PATCH', `/api/admin/utilisateurs/${b.dataset.actif}`, { actif: b.dataset.etat !== 'true' });
      toast(b.dataset.etat === 'true' ? 'Compte désactivé' : 'Compte réactivé'); vueUtilisateurs();
    } catch (e) { toast(e.message, 'err'); }
  }));
  document.querySelectorAll('[data-mdp]').forEach((b) => (b.onclick = () => {
    const d = ouvrirDialogue(`<h2>Nouveau mot de passe</h2><p class="muted petit" style="margin:2px 0 0">${esc(b.dataset.nom)}</p>
      <form id="fMdp"><label class="champ">Mot de passe (10 caractères minimum)<input class="input" name="m" type="password" minlength="10" required autocomplete="new-password"></label>
      <div id="eM" class="erreur" hidden></div>
      <div class="actions"><button type="button" class="btn sec" id="ann">Annuler</button><button class="btn" type="submit">Enregistrer</button></div></form>`);
    d.querySelector('#ann').onclick = () => d.close();
    d.querySelector('#fMdp').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api('PATCH', `/api/admin/utilisateurs/${b.dataset.mdp}`, { motDePasse: e.target.m.value });
        d.close(); toast('Mot de passe modifié');
      } catch (err) { const el = d.querySelector('#eM'); el.textContent = err.message; el.hidden = false; }
    };
  }));
}

// ============================================================
// Capacité de soute et revente de l'espace libre
// ============================================================
async function vueCapacite() {
  const { vols, ventes } = await api('GET', '/api/admin/capacite');
  const somme = (k) => vols.reduce((n, v) => n + v[k], 0);
  vue.innerHTML =
    entete('Capacité & revente', 'Chaque kilo libre en soute est une recette possible', '') +
    `<div class="kpis">${[
      ['Espace libre', `${Math.round(somme('libreKg'))} kg`, 'jaune'],
      ['Potentiel de revente', usd(somme('potentielUsd')), 'jaune'],
      ['Recettes fret', usd(somme('recettesFretUsd')), 'vert'],
      ['Recettes excédents', usd(somme('recettesExcedentUsd')), 'vert'],
    ].map(([t, v, c]) => `<div class="kpi ${c}"><span>${t}</span><b>${esc(v)}</b></div>`).join('')}</div>
    <div class="carte"><div class="tableau"><table><thead><tr><th>Vol</th><th>Remplissage de la soute</th><th>Libre</th><th>Prix / kg</th><th>Potentiel</th><th>Fret vendu</th><th></th></tr></thead><tbody>${
      vols.length ? vols.map((v) => {
        const pb = v.capaciteKg ? (v.bagagesKg / v.capaciteKg) * 100 : 0, pf = v.capaciteKg ? (v.fretKg / v.capaciteKg) * 100 : 0;
        return `<tr><td><b>${esc(v.numero)}</b><br><span class="muted petit">${esc(v.depart)} → ${esc(v.arrivee)} · ${esc(v.heureDepart ?? '')}</span></td>
          <td style="min-width:220px"><div class="capa-barre" title="Bagages ${v.bagagesKg} kg · fret ${v.fretKg} kg"><i class="b" style="width:${Math.min(100, pb)}%"></i><i class="f" style="width:${Math.min(100 - Math.min(100, pb), pf)}%"></i></div><span class="muted petit">${v.bagagesKg} kg bagages (${v.nbBagages}) + ${v.fretKg} kg fret / ${v.capaciteKg} kg${v.capaciteDefinie ? '' : ' (capacité par défaut)'}</span></td>
          <td><b>${v.libreKg} kg</b></td><td>${usd(v.prixReventeUsdKg)}</td><td>${usd(v.potentielUsd)}</td><td>${usd(v.recettesFretUsd)}</td>
          <td style="white-space:nowrap"><button class="btn mini" data-vendre="${esc(v.id)}" ${v.libreKg <= 0 ? 'disabled' : ''}>Vendre</button> <button class="btn sec mini" data-regler="${esc(v.id)}">Régler</button></td></tr>`;
      }).join('') : '<tr><td colspan="8" class="vide">Aucun vol. Importez un vol depuis la page Vols.</td></tr>'
    }</tbody></table></div><p class="legende-carte"><span class="capa-leg b"></span> bagages passagers <span class="capa-leg f"></span> fret vendu <span class="capa-leg l"></span> espace libre</p></div>
    <div class="carte"><h2>Ventes récentes</h2>${ventes.length ? `<div class="tableau"><table><thead><tr><th>Date</th><th>Vol</th><th>Client</th><th>Poids</th><th>Montant</th><th>Vendeur</th></tr></thead><tbody>${ventes.map((x) => `<tr><td>${dateHeure(x.ts)}</td><td>${esc(x.numeroVol)}</td><td>${esc(x.client)}</td><td>${x.kg} kg à ${usd(x.prixUsdKg)}</td><td><b>${usd(x.montantUsd)}</b></td><td>${esc(x.agent)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Aucune vente pour le moment.</p>'}</div>
    <div class="carte"><h2>Comment l’espace libre devient une recette</h2><ul style="margin:6px 0 0;padding-left:20px;line-height:1.6"><li><b>Fret et colis de dernière minute :</b> chaque kilo libre se vend au comptoir ou en ligne avant le départ (bouton « Vendre »).</li><li><b>Excédent de bagages :</b> facturé aux passagers, avec −20 % en prépaiement pour désengorger les comptoirs.</li><li><b>Service VIP :</b> suivi RFID et alertes, une offre premium facturable.</li></ul><p class="muted petit" style="margin:10px 0 0">Prix et capacités de cette démonstration : à valider avec Air Congo (capacité réelle de soute par type d’avion).</p></div>`;

  const vol = (id) => vols.find((v) => v.id === id);
  document.querySelectorAll('[data-vendre]').forEach((b) => (b.onclick = () => {
    const v = vol(b.dataset.vendre);
    const d = ouvrirDialogue(`<h2>Vendre de l’espace · ${esc(v.numero)}</h2><p class="muted petit" style="margin:2px 0 0">${v.libreKg} kg disponibles sur ${esc(v.depart)} → ${esc(v.arrivee)}</p>
      <form id="fV"><label class="champ">Client<input class="input" name="client" required minlength="2" maxlength="80" placeholder="Nom du client ou de l’entreprise"></label>
      <div class="rang"><label class="champ">Poids (kg)<input class="input" name="kg" type="number" step="0.5" min="0.5" max="${v.libreKg}" required></label>
      <label class="champ">Prix par kg ($)<input class="input" name="prix" type="number" step="0.5" min="0.5" value="${v.prixReventeUsdKg}" required></label></div>
      <p id="tot" class="muted" style="margin:10px 0 0"></p><div id="eV" class="erreur" hidden></div>
      <div class="actions"><button type="button" class="btn sec" id="ann">Annuler</button><button class="btn vert" type="submit">Encaisser la vente</button></div></form>`);
    const f = d.querySelector('#fV');
    const maj = () => (d.querySelector('#tot').textContent = f.kg.value && f.prix.value ? `Montant : ${usd(Number(f.kg.value) * Number(f.prix.value))}` : '');
    f.kg.oninput = maj; f.prix.oninput = maj;
    d.querySelector('#ann').onclick = () => d.close();
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      try {
        const r = await api('POST', '/api/agent/ventes-espace', { volId: v.id, kg: f.kg.value, client: f.client.value, prixUsdKg: f.prix.value });
        d.close(); toast(`Vente enregistrée : ${usd(r.montantUsd)}`); vueCapacite();
      } catch (e) { const el = d.querySelector('#eV'); el.textContent = e.message; el.hidden = false; }
    };
  }));
  document.querySelectorAll('[data-regler]').forEach((b) => (b.onclick = () => {
    const v = vol(b.dataset.regler);
    const d = ouvrirDialogue(`<h2>Régler ${esc(v.numero)}</h2><p class="muted petit" style="margin:2px 0 0">Capacité réelle de soute pour ce vol et prix de revente.</p>
      <form id="fR"><div class="rang"><label class="champ">Capacité (kg)<input class="input" name="cap" type="number" min="0" max="50000" step="10" value="${v.capaciteKg}" required></label>
      <label class="champ">Prix de revente ($/kg)<input class="input" name="prix" type="number" min="0.5" max="200" step="0.5" value="${v.prixReventeUsdKg}" required></label></div>
      <div id="eR" class="erreur" hidden></div><div class="actions"><button type="button" class="btn sec" id="ann">Annuler</button><button class="btn" type="submit">Enregistrer</button></div></form>`);
    d.querySelector('#ann').onclick = () => d.close();
    d.querySelector('#fR').onsubmit = async (ev) => {
      ev.preventDefault();
      try { await api('PATCH', `/api/admin/vols/${encodeURIComponent(v.id)}`, { capaciteKg: ev.target.cap.value, prixReventeUsdKg: ev.target.prix.value }); d.close(); toast('Vol mis à jour'); vueCapacite(); }
      catch (e) { const el = d.querySelector('#eR'); el.textContent = e.message; el.hidden = false; }
    };
  }));
}

// ============================================================
// Passagers : saisie d'une réservation et import de la liste fournie par Air Congo
// ============================================================
const MODELE_CSV = 'pnr;nom;classe;vol;date;telephone;canal\nACG501;Mbemba Joseph;ECO;DEMO-205;;0812345678;SMS\nACV502;Kabila Sarah;VIP;DEMO-205;;0899999999;WHATSAPP\n';
async function vueReservations() {
  const vols = EST_ADMIN ? (await api('GET', '/api/admin/vols')).vols : [];
  vue.innerHTML = entete('Passagers', 'Créez une réservation ou importez la liste des passagers d’un vol (fichier CSV)') +
    `<div class="grille2"><div class="carte"><h2>Nouvelle réservation</h2><form id="fRes">
      <label class="champ">Numéro de réservation (PNR)<input class="input" name="pnr" required minlength="4" maxlength="10" style="text-transform:uppercase"></label>
      <label class="champ">Nom du passager<input class="input" name="nom" required minlength="2" maxlength="80"></label>
      <label class="champ">Numéro de vol<input class="input" name="vol" required list="lVols" placeholder="Ex. DEMO-205 ou KQ554"><datalist id="lVols">${vols.map((v) => `<option value="${esc(v.numero)}">`).join('')}</datalist></label>
      <label class="champ">Classe<select class="input" name="classe"><option>ECO</option><option>BUSINESS</option><option>VIP</option></select></label>
      <label class="champ">Téléphone (pour les alertes)<input class="input" name="telephone" type="tel" placeholder="0812345678"></label>
      <label class="champ">Canal d’alerte<select class="input" name="canalAlerte"><option value="SMS">SMS</option><option value="WHATSAPP">WhatsApp</option><option value="WEB">Portail seulement</option></select></label>
      <button class="btn bloc" type="submit" style="margin-top:14px">Enregistrer la réservation</button></form></div>
    ${EST_ADMIN ? `<div class="carte"><h2>Importer la liste des passagers</h2>
      <p class="muted petit" style="margin:0 0 8px">Fichier CSV (Excel : « Enregistrer sous » → CSV) avec les colonnes <b>pnr, nom, classe, vol</b> et, si possible, date, telephone, canal. Les vols doivent déjà exister (page Vols). Une réservation déjà connue est mise à jour.</p>
      <input class="input" type="file" id="fichier" accept=".csv,.txt"><div class="rang" style="margin-top:10px"><button class="btn" id="importer">Importer</button><button class="btn sec" id="modele" type="button">Télécharger un modèle</button></div><div id="bilan"></div></div>` : ''}</div>
    ${EST_ADMIN ? '<div class="carte"><h2>Réservations enregistrées</h2><div id="listeRes"><p class="muted">Chargement…</p></div></div>' : ''}`;
  const rafraichir = async () => {
    if (!EST_ADMIN) return;
    const l = await api('GET', '/api/admin/reservations');
    $('listeRes').innerHTML = l.length ? `<div class="tableau"><table><thead><tr><th>PNR</th><th>Passager</th><th>Classe</th><th>Vol</th><th>Alertes</th><th>Bagages</th></tr></thead><tbody>${l.map((r) => `<tr><td class="mono">${esc(r.pnr)}</td><td>${esc(r.nom)}</td><td>${esc(r.classe)}</td><td>${esc(r.vol)}</td><td>${esc(CANAUX[r.canalAlerte] ?? r.canalAlerte)}</td><td>${r.bagages}</td></tr>`).join('')}</tbody></table></div>` : '<p class="vide">Aucune réservation.</p>';
  };
  rafraichir().catch(() => {});
  $('fRes').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = ev.target, b = Object.fromEntries(new FormData(f));
    try { const r = await api('POST', '/api/agent/reservations', b); toast(`Réservation ${r.pnr} ${r.creee ? 'créée' : 'mise à jour'}`); f.reset(); rafraichir(); }
    catch (e) { toast(e.message, 'err'); }
  };
  if (!EST_ADMIN) return;
  $('modele').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([MODELE_CSV], { type: 'text/csv' })); a.download = 'modele-passagers.csv'; a.click(); };
  $('importer').onclick = async () => {
    const fic = $('fichier').files[0];
    if (!fic) return toast('Choisissez un fichier CSV', 'warn');
    if (fic.size > 900000) return toast('Fichier trop gros (max 900 Ko)', 'err');
    $('importer').disabled = true;
    try {
      const r = await api('POST', '/api/admin/reservations/importer', { csv: await fic.text() });
      $('bilan').innerHTML = `<div class="fiche-bagage" style="margin-top:12px"><b>${r.crees} créée(s) · ${r.mis_a_jour} mise(s) à jour · ${r.erreurs.length} erreur(s)</b>${r.erreurs.length ? `<ul style="margin:8px 0 0;padding-left:18px">${r.erreurs.slice(0, 30).map((e) => `<li>Ligne ${e.ligne} : ${esc(e.message)}</li>`).join('')}</ul>` : ''}</div>`;
      rafraichir();
    } catch (e) { toast(e.message, 'err'); }
    $('importer').disabled = false;
  };
}

// ============================================================
// Radar des vols (carte type Flightradar : bagages en vol, espace libre au sol)
// ============================================================
async function vueRadar() {
  vue.innerHTML = entete('Radar des vols', 'Cliquez sur un avion : bagages à bord s’il vole, espace libre en soute s’il est au sol');
  const zone = document.createElement('div');
  vue.appendChild(zone);
  surDepart(await lancerRadar(zone, { personnel: true }));
}

// ============================================================
// Vols (récupération automatique)
// ============================================================
const CLASSE_VOL = { PREVU: 'bleu', RETARDE: 'rouge', EN_VOL: 'bleu', ATTERRI: 'vert' };
const jourFr = (d) => (d ? new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) : '—');

async function vueVols() {
  const { actif, fournisseur, vols } = await api('GET', '/api/admin/vols');
  const aujourdhui = new Date().toISOString().slice(0, 10);
  vue.innerHTML =
    entete('Vols', 'Horaires, statuts et retards récupérés automatiquement', `<button class="btn sec" id="demo">Recharger la démo</button> ` + (actif ? `<button class="btn sec" id="sync">${icone('avion')} Actualiser les vols</button>` : '')) +
    (actif
      ? `<div class="carte"><h2>Importer les vols d’une compagnie</h2><p class="muted petit" style="margin:0 0 6px">Tapez le nom de la compagnie (ex. Kenya Airways) : ses vols, horaires et statuts sont récupérés automatiquement (source : ${esc(fournisseur)}) et apparaissent sur le radar.</p>
        <form id="fCie" class="rang" style="align-items:end"><label class="champ" style="flex:1">Compagnie<input class="input" name="compagnie" list="listeCies" required placeholder="Ex. Kenya Airways" autocomplete="off"><datalist id="listeCies"></datalist></label><button class="btn" type="submit">Importer ses vols</button></form></div>
        <details class="carte"><summary style="cursor:pointer;font-weight:600">Chercher un numéro de vol précis</summary>
        <form id="fVol" class="rang" style="align-items:end"><label class="champ" style="flex:1">Numéro de vol<input class="input" name="numero" placeholder="Ex. KQ554" style="text-transform:uppercase"></label>
        <label class="champ">Date<input class="input" type="date" name="date" value="${aujourdhui}"></label><button class="btn" type="submit">Rechercher</button></form>
        <div id="resVol"></div></details>`
      : `<div class="carte"><h2>Récupération automatique non activée</h2><p style="margin:6px 0 0">Pour importer les vols automatiquement, ajoutez dans Render (Environment) la variable <b class="mono">FLIGHT_API_KEY</b> avec votre clé aviationstack, puis redéployez. Les vols saisis ou de démonstration continuent de fonctionner.</p></div>`) +
    `<div class="carte"><div class="tableau"><table><thead><tr><th>Vol</th><th>Date</th><th>Trajet</th><th>Départ</th><th>Statut</th><th>Passagers</th><th>Radar</th><th>Source</th></tr></thead><tbody>${
      vols.length ? vols.map((v) => `<tr><td><b>${esc(v.numero)}</b></td><td>${jourFr(v.date)}</td><td>${esc(v.depart)} → ${esc(v.arrivee)}</td><td>${esc(v.heureDepart ?? '—')}${v.retardMin > 0 ? ` <span class="muted petit">(vers ${esc(v.heureDepartEstimee ?? '?')})</span>` : ''}</td><td>${v.libelleStatut ? `<span class="pill ${CLASSE_VOL[v.statut] ?? 'rouge'}">${esc(v.libelleStatut)}${v.retardMin > 0 ? ` +${v.retardMin} min` : ''}</span>` : '<span class="muted">—</span>'}</td><td>${v.passagers}</td><td>${v.raisonAbsenceRadar ? `<span class="pill jaune" title="${esc(v.raisonAbsenceRadar)}">Liste seulement</span><div class="muted petit" style="max-width:200px">${esc(v.raisonAbsenceRadar)}</div>` : '<span class="pill vert">Affiché</span>'}</td><td>${v.source === 'API' ? `API${v.majLe ? ' · ' + heure(v.majLe) : ''}` : 'Démo / saisi'}</td></tr>`).join('') : '<tr><td colspan="8" class="vide">Aucun vol.</td></tr>'
    }</tbody></table></div></div>`;

  $('demo').onclick = async () => {
    if (!confirm('Recharger la démonstration ? Cela REMPLACE tous les vols (y compris importés), réservations, bagages et scans par des données fictives.')) return;
    try { await api('POST', '/api/admin/demo/reset'); toast('Démonstration rechargée'); vueVols(); }
    catch (e) { toast(e.message, 'err'); }
  };
  if (!actif) return;
  $('sync').onclick = async () => {
    $('sync').disabled = true;
    try {
      const r = await api('POST', '/api/admin/vols/synchroniser');
      toast(`${r.maj} vol(s) actualisé(s)${r.erreurs.length ? ` · ${r.erreurs.length} erreur(s) : ${r.erreurs[0]}` : ''}`, r.erreurs.length ? 'warn' : 'ok');
      vueVols();
    } catch (e) { toast(e.message, 'err'); $('sync').disabled = false; }
  };
  api('GET', '/api/radar/compagnies', undefined, { auth: false }).then((l) => { $('listeCies').innerHTML = l.map((c) => `<option value="${esc(c.nom)}"></option>`).join(''); }).catch(() => {});
  $('fCie').onsubmit = async (ev) => {
    ev.preventDefault();
    const bouton = ev.target.querySelector('button');
    bouton.disabled = true; bouton.textContent = 'Import en cours…';
    try {
      const r = await api('POST', '/api/admin/vols/importer-compagnie', { compagnie: ev.target.compagnie.value });
      toast(`${r.importes} vol(s) importé(s)`);
      vueVols();
    } catch (e) { toast(e.message, 'err'); bouton.disabled = false; bouton.textContent = 'Importer ses vols'; }
  };
  $('fVol').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = ev.target, zone = $('resVol');
    zone.innerHTML = '<p class="muted">Recherche en cours…</p>';
    try {
      const trouves = await api('GET', `/api/admin/vols/recherche?numero=${encodeURIComponent(f.numero.value)}&date=${encodeURIComponent(f.date.value)}`);
      zone.innerHTML = trouves.length
        ? trouves.map((v, i) => `<div class="fiche-bagage" style="margin-top:12px"><div class="haut"><div><b>${esc(v.numero)}</b> ${v.compagnie ? '· ' + esc(v.compagnie) : ''}<br><span class="muted petit">${esc(v.depart)} ${esc(v.heureDepart ?? '')} → ${esc(v.arrivee)} ${esc(v.heureArrivee ?? '')} · ${jourFr(v.date)}${v.terminal ? ' · Terminal ' + esc(v.terminal) : ''}</span></div><button class="btn mini" data-imp="${i}">Importer ce vol</button></div></div>`).join('')
        : '<p class="muted">Aucun vol trouvé pour ce numéro et cette date (selon le forfait, seuls les vols du jour peuvent être disponibles).</p>';
      zone.querySelectorAll('[data-imp]').forEach((b) => (b.onclick = async () => {
        const v = trouves[Number(b.dataset.imp)];
        try { await api('POST', '/api/admin/vols/importer', { numero: v.numero, date: v.date }); toast(`Vol ${v.numero} importé`); vueVols(); }
        catch (e) { toast(e.message, 'err'); }
      }));
    } catch (e) { zone.innerHTML = `<div class="erreur">${esc(e.message)}</div>`; }
  };
}

// ============================================================
// Carte & points de scan (administrateur)
// ============================================================
const NOMS_ETAPES = { ENREGISTRE: 'Enregistrement', CHARGE: 'Chargement', TRANSIT: 'Transit', ARRIVE: 'Arrivée', LIVRE: 'Remise' };

async function vueCarte() {
  vue.innerHTML =
    entete('Carte & points de scan', 'Chaque point où un bagage est scanné, sur la carte OpenStreetMap', `<button class="btn" id="nouveauPoint">${icone('plus')} Nouveau point</button>`) +
    `<div class="carte-grille"><div class="carte"><div class="outils"><input class="input" id="rech" placeholder="Code bagage (AC123456) pour voir son trajet" aria-label="Code bagage" style="max-width:none;flex:1;width:auto;min-width:0"><button class="btn sec" id="tracer">Tracer</button><button class="btn sec" id="effacer" hidden>Effacer</button></div>
      <div id="msgCarte" class="muted petit"></div>${zoneCarte(520)}<p class="legende-carte">Les pastilles bleues numérotées indiquent le nombre de bagages dont le dernier passage a eu lieu à ce point. Cliquez sur un point pour le détail.</p></div>
    <div class="carte"><h2>Points de scan</h2><ul class="liste-points" id="lstPoints"></ul></div></div>`;

  let points = [], trace = [], premiere = true;
  const el = vue.querySelector('.osm');
  const dessiner = async () => { await montrerCarte(el, { scans: trace, points, conserver: !premiere }); premiere = false; };
  const charger = async () => {
    points = await api('GET', '/api/admin/carte');
    $('lstPoints').innerHTML = points.map((p) => `<li><span><span class="nom">${esc(p.nom)}</span><small>${esc(p.station)} · ${esc(NOMS_ETAPES[p.etape] ?? p.etape)}${p.rfid ? ' · RFID' : ''} · ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}</small>${p.positionDemo ? '<small style="color:#9b6a00">Position de démonstration, à confirmer sur place</small>' : ''}</span>
      <span style="white-space:nowrap">${p.actif ? '' : '<span class="pill gris">Désactivé</span> '}${p.bagages ? `<span class="pill bleu">${p.bagages}</span> ` : ''}<button class="btn sec mini" data-edit="${esc(p.id)}">Modifier</button></span></li>`).join('');
    document.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => dialoguePoint(points.find((p) => p.id === b.dataset.edit), async () => { premiere = true; await charger(); await dessiner(); })));
  };
  $('nouveauPoint').onclick = () => dialoguePoint(null, async () => { premiere = true; await charger(); await dessiner(); });
  $('tracer').onclick = async () => {
    const code = $('rech').value.trim().toUpperCase();
    if (!code) return;
    try {
      trace = (await api('GET', `/api/agent/bagages/${encodeURIComponent(code)}`)).bagage.scans;
      $('msgCarte').textContent = trace.length ? `Trajet de ${code} : ${trace.length} passage(s).` : `${code} n’a pas encore été scanné.`;
      $('effacer').hidden = false; premiere = true; await dessiner();
    } catch (e) { $('msgCarte').textContent = e.message; }
  };
  $('rech').onkeydown = (e) => { if (e.key === 'Enter') $('tracer').click(); };
  $('effacer').onclick = async () => { trace = []; $('rech').value = ''; $('msgCarte').textContent = ''; $('effacer').hidden = true; premiere = true; await dessiner(); };
  await charger(); await dessiner();
  const t = setInterval(async () => { if (document.hidden || document.querySelector('dialog[open]')) return; try { await charger(); await dessiner(); } catch { /* réessai au prochain tour */ } }, 10000);
  surDepart(() => { clearInterval(t); if (el._map) el._map.remove(); });
}

function lireGps(texte) {
  const m = String(texte).replace(/[−–]/g, '-').match(/^\s*(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  return m ? { lat: Number(m[1]), lon: Number(m[2]) } : null;
}

function dialoguePoint(p, apres) {
  const d = ouvrirDialogue(`<h2>${p ? 'Modifier le point' : 'Nouveau point de scan'}</h2>
    <p class="muted petit" style="margin:2px 0 0">Placez-vous au point de scan et utilisez « Ma position », ou collez les coordonnées copiées depuis OpenStreetMap ou Google Maps.</p>
    <form id="fP">
      <label class="champ">Nom du point<input class="input" name="nom" required minlength="2" maxlength="60" value="${esc(p?.nom ?? '')}" placeholder="Ex. Tri bagages – tapis 2"></label>
      <div class="rang"><label class="champ">Station<select class="input" name="station" ${p ? 'disabled' : ''}>${STATIONS.map((c) => `<option value="${c}" ${p?.station === c ? 'selected' : ''}>${c} · ${esc(STATIONS_INFO[c].nom)}</option>`).join('')}</select></label>
      <label class="champ">Étape enregistrée<select class="input" name="etape">${Object.entries(NOMS_ETAPES).map(([k, v]) => `<option value="${k}" ${p?.etape === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>
      <label class="champ">Coordonnées GPS (latitude, longitude)<input class="input mono" name="gps" required value="${p ? `${p.lat}, ${p.lon}` : ''}" placeholder="-4.38580, 15.44460"></label>
      <button type="button" class="btn sec mini" id="geo" style="margin-top:8px">${icone('epingle')} Utiliser ma position</button>
      <label class="champ" style="display:flex;gap:8px;align-items:center;font-weight:500"><input type="checkbox" name="rfid" ${p?.rfid ? 'checked' : ''}> Portique RFID (bagages VIP lus automatiquement)</label>
      ${p ? `<label class="champ" style="display:flex;gap:8px;align-items:center;font-weight:500"><input type="checkbox" name="actif" ${p.actif ? 'checked' : ''}> Point actif</label>` : ''}
      <div id="eP" class="erreur" hidden></div>
      <div class="actions"><button type="button" class="btn sec" id="ann">Annuler</button><button class="btn" type="submit">Enregistrer</button></div>
    </form>`);
  const f = d.querySelector('#fP');
  d.querySelector('#ann').onclick = () => d.close();
  d.querySelector('#geo').onclick = () => {
    if (!navigator.geolocation) return toast('Géolocalisation indisponible sur cet appareil.', 'warn');
    navigator.geolocation.getCurrentPosition(
      (pos) => { f.gps.value = `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`; toast(`Position relevée (précision ± ${Math.round(pos.coords.accuracy)} m)`); },
      () => toast('Position refusée ou introuvable.', 'err'),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const er = d.querySelector('#eP'); er.hidden = true;
    const g = lireGps(f.gps.value);
    if (!g) { er.textContent = 'Coordonnées illisibles. Format attendu : -4.38580, 15.44460 (point comme séparateur décimal).'; er.hidden = false; return; }
    const corps = { nom: f.nom.value, etape: f.etape.value, lat: g.lat, lon: g.lon, rfid: f.rfid.checked };
    try {
      if (p) await api('PATCH', `/api/admin/points/${encodeURIComponent(p.id)}`, { ...corps, actif: f.actif.checked });
      else await api('POST', '/api/admin/points', { ...corps, station: f.station.value });
      d.close(); toast(p ? 'Point modifié' : 'Point créé'); await apres?.();
    } catch (e) { er.textContent = e.message; er.hidden = false; }
  };
}

// ============================================================
// Scanner (agent en station)
// ============================================================
const historique = [];
async function vueScanner() {
  let station = EST_ADMIN ? STATIONS[0] : moi.station;
  const tousPoints = await api('GET', '/api/agent/points');
  let point = null;
  let bagageCourant = null;

  vue.innerHTML =
    entete('Scanner un bagage', EST_ADMIN ? 'Mode administrateur : vous choisissez la station.' : `Station ${moi.station} · ${STATIONS_INFO[moi.station]?.nom ?? ''} · ${moi.nom}`, `<button class="btn sec" id="etiq">${icone('plus')} Nouvelle étiquette</button>`) +
    `<div class="grille2"><div class="carte"><h2>Scan</h2>
      ${EST_ADMIN ? `<label class="champ">Station<select class="input" id="st">${STATIONS.map((c) => `<option value="${c}">${c} · ${esc(STATIONS_INFO[c].nom)}</option>`).join('')}</select></label>` : ''}
      <label class="champ">Point de scan (où vous vous trouvez)</label><div class="points-liste" id="lstPts"></div>
      <label class="champ" for="code">Code du bagage</label>
      <input class="input grand" id="code" placeholder="AC123456" autocomplete="off" autocapitalize="characters" autofocus>
      <div id="blocPoids" hidden><label class="champ" for="poids">Poids sur la balance (kg)</label><input class="input" id="poids" type="number" inputmode="decimal" step="0.1" min="0.1" max="80"></div>
      <div class="rang" style="margin-top:16px"><button class="btn" id="valider">Valider le scan</button><button class="btn sec" id="cam" type="button">${icone('camera')} Scanner avec la caméra</button></div>
      <div class="camera" id="zoneCam" hidden><video id="video" playsinline muted></video></div>
      <div id="erreurScan" class="erreur" hidden></div>
    </div>
    <div><div class="carte" id="fiche"><h2>Bagage</h2><p class="muted" style="margin:0">Saisissez ou scannez un code pour voir le passager et l'excédent éventuel.</p></div>
    <div class="carte"><h2>Derniers scans</h2><ul class="fil" id="hist"></ul></div></div></div>`;

  $('etiq').onclick = () => nouvelleEtiquette();
  const afficherHist = () => {
    $('hist').innerHTML = historique.length
      ? historique.slice(0, 8).map((h) => `<li><span class="t">${heure(h.ts)}</span><span><b class="mono">${esc(h.code)}</b> · ${esc(h.libelle)}<br><span class="muted petit">${esc(h.lieu)}</span></span></li>`).join('')
      : '<li class="muted">Aucun scan dans cette session.</li>';
  };
  afficherHist();

  const majPoids = () => { $('blocPoids').hidden = point?.etape !== 'ENREGISTRE'; };
  const majPoints = () => {
    const l = tousPoints.filter((p) => p.station === station);
    if (!l.some((p) => p.id === point?.id)) point = l.find((p) => p.id === sessionStorage.getItem('ac_point')) ?? l[0] ?? null;
    $('lstPts').innerHTML = l.length
      ? l.map((p) => `<button type="button" class="${p.id === point?.id ? 'on' : ''}" data-p="${esc(p.id)}"><span><b>${esc(p.nom)}</b><br><small>${esc(NOMS_ETAPES[p.etape] ?? p.etape)}${p.rfid ? ' · RFID' : ''}</small></span><span>${p.id === point?.id ? '✓' : ''}</span></button>`).join('')
      : '<p class="muted petit" style="margin:0">Aucun point de scan pour cette station. Demandez à l’administrateur d’en ajouter.</p>';
    $('lstPts').querySelectorAll('button').forEach((b) => (b.onclick = () => { point = l.find((p) => p.id === b.dataset.p); sessionStorage.setItem('ac_point', point.id); majPoints(); }));
    majPoids();
  };
  majPoints();
  if (EST_ADMIN) $('st').onchange = () => { station = $('st').value; majPoints(); };

  async function chercher(code) {
    if (!code) return;
    try {
      const d = await api('GET', `/api/agent/bagages/${encodeURIComponent(code)}`);
      bagageCourant = d.bagage;
      const ex = d.excedent;
      $('fiche').innerHTML = `<h2>Bagage <span class="mono">${esc(d.bagage.code)}</span></h2>
        <div class="fiche-bagage"><div class="haut"><div><b>${esc(d.passager)}</b><br><span class="muted petit">Réservation ${esc(d.pnr)} · ${esc(d.classe)} · ${d.bagage.poidsKg} kg ${d.bagage.poidsReel ? '(pesé)' : '(déclaré)'}</span></div>
        <div>${pill(d.bagage.statut)} ${d.bagage.niveau === 'VIP' ? '<span class="pill vip">VIP · RFID</span>' : ''}</div></div>
        ${ex.kgRestants > 0
          ? `<div class="excedent"><b>Excédent à encaisser : ${ex.kgRestants} kg = ${usd(ex.montantComptoirUsd)}</b><div style="margin-top:10px"><button class="btn vert mini" id="encaisser">Encaisser au comptoir</button></div></div>`
          : ex.excesKg > 0 ? '<div class="excedent ok">Excédent réglé.</div>' : '<div class="excedent ok">Aucun excédent.</div>'}</div>`;
      const e = $('encaisser');
      if (e) e.onclick = async () => {
        try { await api('POST', `/api/agent/payer/${encodeURIComponent(d.pnr)}`); toast('Excédent encaissé'); chercher(code); }
        catch (err) { toast(err.message, 'err'); }
      };
    } catch (err) {
      bagageCourant = null;
      $('fiche').innerHTML = `<h2>Bagage</h2><div class="erreur" style="margin:0">${esc(err.message)}</div>`;
    }
  }

  const lireCode = () => $('code').value.trim().toUpperCase();
  $('code').onchange = () => chercher(lireCode());

  async function valider() {
    const code = lireCode();
    const er = $('erreurScan');
    er.hidden = true;
    if (!point) { er.textContent = 'Aucun point de scan sélectionné.'; er.hidden = false; return; }
    if (!code) { er.textContent = 'Saisissez ou scannez un code.'; er.hidden = false; return; }
    const poids = $('poids').value;
    if (point.etape === 'ENREGISTRE' && !poids && !bagageCourant?.poidsReel) { er.textContent = 'Saisissez le poids lu sur la balance.'; er.hidden = false; return; }
    $('valider').disabled = true;
    try {
      const r = await api('POST', '/api/agent/scans', { code, pointId: point.id, poidsKg: point.etape === 'ENREGISTRE' && poids ? poids : undefined });
      toast(`${code} : ${r.bagage.libelle}`, r.avertissement ? 'warn' : 'ok');
      historique.unshift({ ts: r.scan.ts, code, libelle: r.bagage.libelle, lieu: `${point.nom} · ${r.scan.station}` });
      afficherHist();
      await chercher(code);
      $('code').value = ''; $('poids').value = ''; $('code').focus();
    } catch (err) { er.textContent = err.message; er.hidden = false; }
    $('valider').disabled = false;
  }
  $('valider').onclick = valider;
  $('code').onkeydown = async (e) => { if (e.key === 'Enter') { e.preventDefault(); await chercher(lireCode()); if (point?.etape === 'ENREGISTRE' && !bagageCourant?.poidsReel) $('poids').focus(); else valider(); } };
  $('poids').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); valider(); } };

  // ---- Caméra ----
  let flux = null, minuteur = null;
  const arreter = () => {
    clearInterval(minuteur); minuteur = null;
    flux?.getTracks().forEach((t) => t.stop()); flux = null;
    const z = $('zoneCam'); if (z) z.hidden = true;
  };
  surDepart(arreter);
  $('cam').onclick = async () => {
    if (flux) return arreter();
    if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) {
      toast('Scan par caméra non disponible sur ce navigateur : saisissez le code.', 'warn');
      return;
    }
    try {
      const detecteur = new BarcodeDetector({ formats: ['qr_code', 'code_128'] });
      flux = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      $('video').srcObject = flux; await $('video').play(); $('zoneCam').hidden = false;
      minuteur = setInterval(async () => {
        try {
          const trouves = await detecteur.detect($('video'));
          if (trouves.length) {
            const brut = String(trouves[0].rawValue).toUpperCase();
            $('code').value = (brut.match(/AC\d{6}/) ?? [brut])[0];
            arreter(); chercher(lireCode());
          }
        } catch { /* image pas prête */ }
      }, 350);
    } catch { arreter(); toast('Impossible d’accéder à la caméra (autorisation refusée ?).', 'err'); }
  };
}

// ============================================================
// Émission d'une étiquette (code + QR) : réservée au personnel Air Congo
// ============================================================
function nouvelleEtiquette(apres) {
  const d = ouvrirDialogue(`<h2>Nouvelle étiquette bagage</h2>
    <p class="muted petit" style="margin:2px 0 0">Saisissez la réservation du passager, puis le poids lu sur la balance.</p>
    <form id="fE"><label class="champ">Numéro de réservation<input class="input" name="pnr" required autocomplete="off" style="text-transform:uppercase" placeholder="ACG123"></label>
    <div id="infoRes" class="muted petit" style="margin-top:8px"></div>
    <label class="champ">Poids (kg)<input class="input" name="poids" type="number" inputmode="decimal" step="0.1" min="0.1" max="80" required></label>
    <div id="eE" class="erreur" hidden></div>
    <div class="actions"><button type="button" class="btn sec" id="ann">Fermer</button><button class="btn" type="submit">Émettre l’étiquette</button></div></form>
    <div id="res" hidden></div>`);
  const f = d.querySelector('#fE');
  d.querySelector('#ann').onclick = () => { d.close(); apres?.(); };
  f.pnr.onchange = async () => {
    const i = d.querySelector('#infoRes');
    try {
      const r = await api('GET', `/api/agent/reservations/${encodeURIComponent(f.pnr.value.trim())}`);
      i.textContent = `${r.nom} · ${r.classe} · vol ${r.vol.numero} ${r.vol.depart}→${r.vol.arrivee} · ${r.bagages.length} bagage(s) déjà étiqueté(s)`;
    } catch (e) { i.textContent = e.message; }
  };
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const er = d.querySelector('#eE'); er.hidden = true;
    try {
      const r = await api('POST', '/api/agent/bagages', { pnr: f.pnr.value.trim(), poidsKg: f.poids.value });
      const qr = await qrImage(r.code);
      const ex = r.reservation.excedent;
      f.hidden = true;
      const z = d.querySelector('#res'); z.hidden = false;
      z.innerHTML = `<div class="etiquette">${qr || ''}<div class="code mono">${esc(r.code)}</div><div class="muted">${esc(r.reservation.nom)} · ${esc(r.reservation.vol.depart)} → ${esc(r.reservation.vol.arrivee)}</div></div>
        ${ex.kgRestants > 0 ? `<div class="excedent"><b>Excédent : ${ex.kgRestants} kg = ${usd(ex.montantComptoirUsd)}</b></div>` : ''}
        <div class="actions"><button class="btn sec" id="ferme">Fermer</button><button class="btn sec" id="autre">Autre bagage</button><button class="btn" id="imp">Imprimer</button></div>`;
      d.querySelector('#ferme').onclick = () => { d.close(); apres?.(); };
      d.querySelector('#imp').onclick = () => window.print();
      d.querySelector('#autre').onclick = () => { z.hidden = true; f.hidden = false; f.poids.value = ''; f.poids.focus(); };
      toast(`Étiquette ${r.code} émise`);
    } catch (e) { er.textContent = e.message; er.hidden = false; }
  };
}

naviguer();
