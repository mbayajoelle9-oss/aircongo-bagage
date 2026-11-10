import { api, session, esc, heure, dateHeure, usd, pill, frise, icone, toast, ouvrirDialogue, STATUTS } from '/common.js';

const moi = session.user;
if (!session.token || !moi) location.replace('/index.html');

const $ = (id) => document.getElementById(id);
const vue = $('vue');
const EST_ADMIN = moi?.role === 'ADMIN';
const STATIONS = ['FIH', 'FBM', 'GOM'];

const TYPES_LITIGE = { PERDU: 'Perdu', ENDOMMAGE: 'Endommagé', RETARDE: 'Retardé', CONTENU_MANQUANT: 'Contenu manquant' };
const STATUTS_LITIGE = { OUVERT: 'Ouvert', EN_COURS: 'En cours', RESOLU: 'Résolu' };

const PAGES = [
  { id: 'dashboard', titre: 'Tableau de bord', ico: 'grille', admin: true },
  { id: 'bagages', titre: 'Bagages', ico: 'bagage', admin: true },
  { id: 'litiges', titre: 'Litiges', ico: 'alerte', admin: true },
  { id: 'utilisateurs', titre: 'Utilisateurs', ico: 'equipe', admin: true },
  { id: 'scanner', titre: 'Scanner', ico: 'scan', admin: false },
].filter((p) => EST_ADMIN || !p.admin);

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
  nettoyages.forEach((f) => f());
  nettoyages = [];
  const id = location.hash.replace('#/', '') || PAGES[0].id;
  const page = PAGES.find((p) => p.id === id) ?? PAGES[0];
  menu(page.id);
  vue.innerHTML = '<div class="chargement">Chargement…</div>';
  try {
    await ({ dashboard: vueDashboard, bagages: vueBagages, litiges: vueLitiges, utilisateurs: vueUtilisateurs, scanner: vueScanner })[page.id]();
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
    const [s, a, b] = await Promise.all([api('GET', '/api/admin/stats'), api('GET', '/api/admin/alertes'), api('GET', '/api/admin/bagages')]);
    const p = s.parStatut;
    const circulation = ['ENREGISTRE', 'CHARGE', 'TRANSIT', 'ARRIVE'].reduce((n, k) => n + (p[k] ?? 0), 0);
    $('kpis').innerHTML = [
      ['Bagages suivis', s.totalBagages, ''],
      ['En circulation', circulation, ''],
      ['Alertes', s.alertes, s.alertes ? 'rouge' : 'vert'],
      ['Litiges ouverts', s.litigesOuverts, s.litigesOuverts ? 'jaune' : 'vert'],
      ['Recettes excédents', usd(s.recettesExcedentUsd), 'vert'],
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
      ? evenements.map((e) => `<li><span class="t">${heure(e.ts)}</span><span><b class="mono">${esc(e.code)}</b> · ${esc(e.passager)}<br><span class="muted petit">${esc(STATUTS[e.etape]?.label ?? e.etape)} à ${esc(e.station)} · ${esc(e.agent)}${e.source === 'RFID' ? ' · <b>RFID</b>' : ''}</span></span></li>`).join('')
      : '<li class="muted">Aucun mouvement pour le moment.</li>';
    $('maj').textContent = 'Mis à jour à ' + heure(new Date().toISOString());
  };
  await charger();
  const t = setInterval(() => { if (!document.hidden) charger().catch(() => {}); }, 10000);
  surDepart(() => clearInterval(t));
}

// ============================================================
// Bagages
// ============================================================
async function vueBagages() {
  const liste = await api('GET', '/api/admin/bagages');
  vue.innerHTML =
    entete('Bagages', `${liste.length} bagage(s) enregistré(s)`) +
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
  $('q').oninput = afficher; $('f').onchange = afficher;
  afficher();
}

function detailBagage(b) {
  const d = ouvrirDialogue(`
    <h2 class="mono">${esc(b.code)}</h2>
    <p class="muted" style="margin:2px 0 0">${esc(b.passager)} · réservation ${esc(b.pnr)} · vol ${esc(b.vol)}</p>
    <p style="margin:10px 0 0">${pill(b.statut)} <span class="muted petit">${b.poidsKg} kg ${b.poidsReel ? '(pesé)' : '(déclaré)'} · suivi ${b.niveau === 'VIP' ? 'RFID' : 'par scan'}</span></p>
    ${frise(b.statut)}
    <h3 style="margin-top:18px">Historique</h3>
    ${b.scans.length ? `<ul class="fil">${b.scans.map((s) => `<li><span class="t">${heure(s.ts)}</span><span>${esc(STATUTS[s.etape]?.label ?? s.etape)} · ${esc(s.station)}<br><span class="muted petit">${esc(s.agent)}${s.source === 'RFID' ? ' · RFID' : ''}${s.saut ? ' · étape sautée' : ''}</span></span></li>`).join('')}</ul>` : '<p class="muted">Aucun mouvement.</p>'}
    <div class="actions"><button class="btn sec" value="x">Fermer</button></div>`);
  d.querySelector('button').onclick = () => d.close();
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
        <label class="champ" id="chSt">Station<input class="input" name="station" maxlength="4" placeholder="FIH" style="text-transform:uppercase"></label></div>
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
// Scanner (agent en station)
// ============================================================
const historique = [];
async function vueScanner() {
  let etape = 'ENREGISTRE';
  let station = EST_ADMIN ? STATIONS[0] : moi.station;
  const ETAPES = [['ENREGISTRE', 'Enregistrement'], ['CHARGE', 'Chargement'], ['TRANSIT', 'Transit'], ['ARRIVE', 'Arrivée'], ['LIVRE', 'Remise']];

  vue.innerHTML =
    entete('Scanner un bagage', EST_ADMIN ? 'Mode administrateur : vous choisissez la station.' : `Station ${moi.station} · ${moi.nom}`) +
    `<div class="grille2"><div class="carte"><h2>Scan</h2>
      ${EST_ADMIN ? `<label class="champ">Station<select class="input" id="st">${STATIONS.map((s) => `<option>${s}</option>`).join('')}</select></label>` : ''}
      <label class="champ">Étape du bagage</label><div class="segments" id="seg"></div>
      <label class="champ" for="code">Code du bagage</label>
      <input class="input grand" id="code" placeholder="AC123456" autocomplete="off" autocapitalize="characters" autofocus>
      <div id="blocPoids"><label class="champ" for="poids">Poids sur la balance (kg)</label><input class="input" id="poids" type="number" inputmode="decimal" step="0.1" min="0.1" max="80"></div>
      <div class="rang" style="margin-top:16px"><button class="btn" id="valider">Valider le scan</button><button class="btn sec" id="cam" type="button">${icone('camera')} Scanner avec la caméra</button></div>
      <div class="camera" id="zoneCam" hidden><video id="video" playsinline muted></video></div>
      <div id="erreurScan" class="erreur" hidden></div>
    </div>
    <div><div class="carte" id="fiche"><h2>Bagage</h2><p class="muted" style="margin:0">Saisissez ou scannez un code pour voir le passager et l'excédent éventuel.</p></div>
    <div class="carte"><h2>Derniers scans</h2><ul class="fil" id="hist"></ul></div></div></div>`;

  const afficherHist = () => {
    $('hist').innerHTML = historique.length
      ? historique.slice(0, 8).map((h) => `<li><span class="t">${heure(h.ts)}</span><span><b class="mono">${esc(h.code)}</b> · ${esc(h.libelle)}<br><span class="muted petit">${esc(h.station)}</span></span></li>`).join('')
      : '<li class="muted">Aucun scan dans cette session.</li>';
  };
  afficherHist();

  const majSeg = () => {
    $('seg').innerHTML = ETAPES.map(([k, l]) => `<button type="button" class="${k === etape ? 'on' : ''}" data-e="${k}">${l}</button>`).join('');
    $('seg').querySelectorAll('button').forEach((b) => (b.onclick = () => { etape = b.dataset.e; majSeg(); }));
    $('blocPoids').hidden = etape !== 'ENREGISTRE';
  };
  majSeg();
  if (EST_ADMIN) $('st').onchange = () => (station = $('st').value);

  async function chercher(code) {
    if (!code) return;
    try {
      const d = await api('GET', `/api/agent/bagages/${encodeURIComponent(code)}`);
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
      $('fiche').innerHTML = `<h2>Bagage</h2><div class="erreur" style="margin:0">${esc(err.message)}</div>`;
    }
  }

  const lireCode = () => $('code').value.trim().toUpperCase();
  $('code').onchange = () => chercher(lireCode());

  async function valider() {
    const code = lireCode();
    const er = $('erreurScan');
    er.hidden = true;
    if (!code) { er.textContent = 'Saisissez ou scannez un code.'; er.hidden = false; return; }
    const poids = $('poids').value;
    if (etape === 'ENREGISTRE' && !poids) { er.textContent = 'Saisissez le poids lu sur la balance.'; er.hidden = false; return; }
    $('valider').disabled = true;
    try {
      const r = await api('POST', '/api/agent/scans', { code, etape, station, poidsKg: etape === 'ENREGISTRE' ? poids : undefined });
      toast(`${code} : ${r.bagage.libelle}`, r.avertissement ? 'warn' : 'ok');
      historique.unshift({ ts: r.scan.ts, code, libelle: r.bagage.libelle, station: r.scan.station });
      afficherHist();
      await chercher(code);
      $('code').value = ''; $('poids').value = ''; $('code').focus();
    } catch (err) { er.textContent = err.message; er.hidden = false; }
    $('valider').disabled = false;
  }
  $('valider').onclick = valider;
  $('code').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('code').onchange(); if (etape !== 'ENREGISTRE') valider(); else $('poids').focus(); } };
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

naviguer();
