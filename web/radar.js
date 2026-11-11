// Radar des vols : les avions sur une vraie carte OpenStreetMap. Cliquer un avion :
//  - en vol : les bagages à bord (détail réservé au personnel) ;
//  - au sol : l'espace libre en soute, avec achat par Mobile Money.
import { api, esc, usd, heure, dateHeure, pill, toast, chargerLeaflet } from '/common.js';

const COULEURS = { EN_VOL: '#1f9d55', AU_SOL: '#1c8fd0', ARRIVE: '#8a97a8', ANNULE: '#d9302c' };
const CLASSES = { EN_VOL: 'vert', AU_SOL: 'bleu', ARRIVE: 'gris', ANNULE: 'rouge' };
const SVG = (c) => `<svg viewBox="0 0 24 24" width="36" height="36"><path d="M12 1.5l1.9 7.2 8.1 4.6v2.2l-8.1-2.4-.7 5.1 2.5 1.9v1.4L12 20.4l-3.7 1.1v-1.4l2.5-1.9-.7-5.1L2 15.5v-2.2l8.1-4.6z" fill="${c}" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
const kg = (n) => `${Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} kg`;

const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;
// Point à la fraction f du grand cercle a → b (même calcul que le serveur).
function interp(a, b, f) {
  const d = Math.acos(Math.min(1, Math.max(-1, Math.sin(rad(a.lat)) * Math.sin(rad(b.lat)) + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon)))));
  if (d < 1e-9) return [a.lat, a.lon];
  const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(rad(a.lat)) * Math.cos(rad(a.lon)) + B * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon));
  const y = A * Math.cos(rad(a.lat)) * Math.sin(rad(a.lon)) + B * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon));
  const z = A * Math.sin(rad(a.lat)) + B * Math.sin(rad(b.lat));
  return [deg(Math.atan2(z, Math.hypot(x, y))), deg(Math.atan2(y, x))];
}
// État d'un avion à l'instant t : recalculé chaque seconde dans le navigateur (mouvement continu) d'après les horaires.
function etatLocal(v, t) {
  if (!v.position) return null;
  const fixe = { phase: v.phase, f: v.progression, pos: [v.position.lat, v.position.lon] };
  if (!v.departTs || !v.arriveeTs || v.phase === 'ANNULE' || v.statut === 'ATTERRI') return fixe;
  const dep = Date.parse(v.departTs), arr = Date.parse(v.arriveeTs);
  const f = t < dep ? 0 : t >= arr ? 1 : Math.min(0.97, Math.max(0.03, (t - dep) / (arr - dep)));
  return { phase: t < dep ? 'AU_SOL' : t >= arr ? 'ARRIVE' : 'EN_VOL', f, pos: interp(v.trace[0], v.trace[1], f) };
}

export async function lancerRadar(racine, { personnel = false, filtre: filtreInitial = '', ouvrir = null, mesBagages = null } = {}) {
  let vols = [], choisi = null, filtre = filtreInitial, acc = 1, accDebut = 0, accReel = 0, animation = null, sac = null;
  const trails = new Map();
  const maintenant = () => (acc > 1 ? accDebut + (Date.now() - accReel) * acc : Date.now());
  let config = {}, minuteur = null, premier = true;
  const marqueurs = new Map();
  let L = null, carte = null, trace = null;

  racine.innerHTML = `<div class="radar">
    <form class="radar-recherche" id="rForm" autocomplete="off">
      <input class="input" id="rQ" list="rListe" placeholder="Nom de la compagnie : Air Congo, Kenya Airways, Ethiopian…" aria-label="Compagnie aérienne">
      <datalist id="rListe"></datalist>
      <button class="btn" type="submit">Rechercher</button>
      <button class="btn sec" type="button" id="rTous" hidden>Tous les vols</button>
      ${personnel ? '<label class="acc"><input type="checkbox" id="rAcc"> Démo accélérée ×60</label>' : ''}
    </form>
    <div class="erreur" id="rAccNote" hidden style="margin:0 0 10px">Simulation accélérée ×60 pour la démonstration : les positions affichées sont fictives, les horaires réels ne changent pas.</div>
    <div class="puces" id="rPuces"></div>
    <div class="radar-grille">
      <div class="radar-carte"><div class="osm" id="rCarte" style="height:580px"></div>
        <p class="legende-carte"><span class="pastille" style="background:${COULEURS.EN_VOL}"></span> en vol <span class="pastille" style="background:${COULEURS.AU_SOL}"></span> au sol (espace à vendre) <span class="pastille" style="background:${COULEURS.ARRIVE}"></span> arrivé · positions calculées d’après les horaires</p></div>
      <aside class="radar-panneau" id="rPanneau"></aside>
    </div></div>`;
  const $ = (s) => racine.querySelector(s);
  $('#rQ').value = filtre; $('#rTous').hidden = !filtre;

  try { config = await api('GET', '/api/config', undefined, { auth: false }); } catch { /* valeurs par défaut */ }
  api('GET', '/api/radar/compagnies', undefined, { auth: false }).then((l) => {
    $('#rListe').innerHTML = l.map((c) => `<option value="${esc(c.nom)}"></option>`).join('');
    $('#rPuces').innerHTML = l.slice(0, 6).map((c) => `<button type="button" class="puce" data-c="${esc(c.nom)}">${esc(c.nom)}</button>`).join('');
    $('#rPuces').querySelectorAll('[data-c]').forEach((b) => (b.onclick = () => { $('#rQ').value = b.dataset.c; filtrer(b.dataset.c); }));
  }).catch(() => {});

  const filtrer = async (q) => { filtre = q.trim(); choisi = null; premier = true; $('#rTous').hidden = !filtre; await charger(); };
  $('#rForm').onsubmit = (e) => { e.preventDefault(); filtrer($('#rQ').value); };
  $('#rTous').onclick = () => { $('#rQ').value = ''; filtrer(''); };

  const icone = (v, phase = v.phase) => L.divIcon({ className: '', html: `<div class="avion${v.id === choisi ? ' choisi' : ''}" style="transform:rotate(${v.cap}deg)">${SVG(COULEURS[phase])}</div>`, iconSize: [36, 36], iconAnchor: [18, 18] });

  async function initCarte() {
    L = await chargerLeaflet();
    const el = $('#rCarte');
    if (!L) {
      el.style.height = 'auto';
      el.innerHTML = '<div class="carte-repli"><b>Carte indisponible</b> (connexion aux serveurs de cartes impossible). La liste des vols reste disponible à droite.</div>';
      return;
    }
    el.innerHTML = '';
    carte = L.map(el, { scrollWheelZoom: false }).setView([-4.5, 22], 5);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18, referrerPolicy: 'strict-origin-when-cross-origin',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }).addTo(carte);
    carte.on('click', () => carte.scrollWheelZoom.enable());
    carte.on('mouseout', () => carte.scrollWheelZoom.disable());
  }

  function majCarte() {
    if (!carte) return;
    const presents = new Set(vols.filter((x) => x.position).map((v) => v.id));
    for (const [id, m] of marqueurs) if (!presents.has(id)) { m.remove(); marqueurs.delete(id); }
    for (const v of vols.filter((x) => x.position)) {
      let m = marqueurs.get(v.id);
      if (!m) {
        m = L.marker([v.position.lat, v.position.lon], { icon: icone(v), zIndexOffset: v.phase === 'EN_VOL' ? 500 : 0, title: v.numero }).addTo(carte);
        m.bindTooltip?.(`${esc(v.numero)} · ${esc(v.depart)} → ${esc(v.arrivee)}`);
        m.on('click', () => choisir(v.id));
        marqueurs.set(v.id, m);
      } else { m.setLatLng([v.position.lat, v.position.lon]); m.setIcon(icone(v)); }
    }
    if (premier && vols.some((x) => x.position)) { carte.fitBounds(vols.filter((x) => x.position).map((v) => [v.position.lat, v.position.lon]), { padding: [50, 50], maxZoom: 8 }); premier = false; }
    animer(true);
  }

  // Appelée chaque seconde : déplace les avions, allonge le sillage, suit les bagages du passager.
  function animer(force = false) {
    if (!carte) return;
    const t = maintenant();
    for (const v of vols) {
      const m = marqueurs.get(v.id), e = etatLocal(v, t);
      if (!m || !e) continue;
      m.setLatLng(e.pos);
      const cle = `${e.phase}|${v.id === choisi}`;
      if (force || m._cle !== cle) { m.setIcon(icone(v, e.phase)); m._cle = cle; }
      const A = [v.trace[0].lat, v.trace[0].lon];
      if (e.phase === 'EN_VOL') {
        let tr = trails.get(v.id);
        if (!tr) { tr = L.polyline([A, e.pos], { color: COULEURS.EN_VOL, weight: 3, opacity: 0.85 }).addTo(carte); trails.set(v.id, tr); }
        else if (tr.setLatLngs) tr.setLatLngs([A, e.pos]);
      } else if (trails.has(v.id)) { trails.get(v.id).remove(); trails.delete(v.id); }
      if (v.id === choisi) {
        const B = [v.trace[1].lat, v.trace[1].lon];
        trace?.remove();
        trace = L.polyline(e.phase === 'EN_VOL' ? [e.pos, B] : [A, B], { color: COULEURS[e.phase], weight: 3, dashArray: '8 8', opacity: 0.8 }).addTo(carte);
        const pct = racine.querySelector('#pct'); if (pct) pct.textContent = e.phase === 'EN_VOL' ? ` · ${Math.round(e.f * 100)} %` : '';
        const bar = racine.querySelector('#barreVol'); if (bar) bar.style.width = `${e.f * 100}%`;
      }
      // Bagages du passager : une pastille qui voyage avec l'avion dès qu'ils sont chargés
      if (mesBagages && v.numero === ouvrir) {
        const n = mesBagages().filter((b) => ['CHARGE', 'TRANSIT'].includes(b.statut)).length;
        if (n && e.phase === 'EN_VOL') {
          if (!sac) sac = L.marker(e.pos, { icon: L.divIcon({ className: '', html: `<div class="sac-live">🧳 ${n} bagage(s)</div>`, iconSize: [110, 26], iconAnchor: [-14, 30] }), zIndexOffset: 900 }).addTo(carte);
          else sac.setLatLng(e.pos);
        } else if (sac) { sac.remove(); sac = null; }
      }
    }
  }

  async function charger() {
    try {
      const r = await api('GET', `/api/radar${filtre ? `?compagnie=${encodeURIComponent(filtre)}` : ''}`, undefined, { auth: false });
      vols = r.vols;
    } catch (e) { $('#rPanneau').innerHTML = `<div class="erreur">${esc(e.message)}</div>`; return; }
    majCarte();
    if (choisi && !vols.some((v) => v.id === choisi)) choisi = null;
    choisi ? await detail(false) : liste();
  }

  function liste() {
    const nb = (p) => vols.filter((v) => v.phase === p).length;
    $('#rPanneau').innerHTML = `<h2>${filtre ? esc(filtre) : 'Tous les vols'}</h2>
      <p class="muted petit" style="margin:0 0 10px">${vols.length} vol(s) · ${nb('EN_VOL')} en vol · ${nb('AU_SOL')} au sol. Cliquez sur un avion ou un vol.</p>
      ${vols.length ? vols.map((v) => `<button type="button" class="vol-carte" data-id="${esc(v.id)}"><div class="haut"><b>${esc(v.numero)}</b><span class="pill ${CLASSES[v.phase]}">${esc(v.libellePhase)}</span></div>
        <div class="muted petit">${esc(v.compagnie ?? '')} · ${esc(v.villeDepart)} → ${esc(v.villeArrivee)} · ${v.departTs ? heure(v.departTs) : esc(v.heureDepart ?? '—')}</div>${v.position ? '' : '<div class="petit" style="color:var(--rouge)">Position sur la carte inconnue (aéroport non référencé)</div>'}
        <div class="petit" style="margin-top:4px">${v.phase === 'AU_SOL' ? `<b>${kg(v.libreKg)}</b> libres · ${usd(v.prixUsdKg)}/kg` : `${v.nbBagages} bagage(s) · ${kg(v.bagagesKg)}`}</div></button>`).join('') : '<p class="vide">Aucun vol pour cette recherche. Essayez « Air Congo » ou un autre nom de compagnie.</p>'}`;
    $('#rPanneau').querySelectorAll('[data-id]').forEach((b) => (b.onclick = () => choisir(b.dataset.id)));
  }

  async function choisir(id) {
    choisi = id;
    majCarte();
    animer(true);
    const v = vols.find((x) => x.id === id);
    if (v?.position && carte) carte.setView([v.position.lat, v.position.lon], Math.max(carte.getZoom?.() ?? 6, 6));
    await detail(true);
  }

  async function detail(neuf) {
    const base = vols.find((v) => v.id === choisi);
    if (!base) return;
    let f = base, bagages = [];
    if (personnel) {
      try { f = await api('GET', `/api/agent/radar/vols/${encodeURIComponent(choisi)}`); bagages = f.bagages ?? []; } catch (e) { toast(e.message, 'err'); }
    }
    const ouvert = f.achatOuvert;
    const pctB = Math.min(100, (f.bagagesKg / f.capaciteKg) * 100), pctF = Math.min(100 - pctB, (f.fretKg / f.capaciteKg) * 100);
    const formEnCours = $('#rPanneau [name=nom]')?.value;
    $('#rPanneau').innerHTML = `<button type="button" class="btn sec mini" id="retour">← Tous les vols</button>
      <div class="vol-tete"><div><h2 style="margin:10px 0 0">${esc(f.numero)} <span class="pill ${CLASSES[f.phase]}">${esc(f.libellePhase)}<span id="pct">${f.phase === 'EN_VOL' ? ` · ${Math.round(f.progression * 100)} %` : ''}</span></span></h2>
        <div class="muted petit">${esc(f.compagnie ?? '')} · ${esc(f.villeDepart)} (${esc(f.depart)}) → ${esc(f.villeArrivee)} (${esc(f.arrivee)})</div>
        <div class="petit">Départ ${f.departTs ? dateHeure(f.departTs) : esc(f.heureDepart ?? '—')}${f.retardMin > 0 ? ` · retard ${f.retardMin} min` : ''} · Arrivée ${f.arriveeTs ? heure(f.arriveeTs) : '—'}</div></div></div>
      ${f.phase === 'EN_VOL' ? `<div class="capa-barre" style="margin-top:12px" title="Progression"><span class="b" id="barreVol" style="width:${f.progression * 100}%;background:var(--vert)"></span></div>` : ''}
      <div class="soute"><h3>Soute</h3><div class="capa-barre"><span class="b" style="width:${pctB}%"></span><span class="f" style="width:${pctF}%"></span></div>
        <div class="petit"><span class="capa-leg b" style="margin-left:0"></span>bagages ${kg(f.bagagesKg)} <span class="capa-leg f"></span>fret ${kg(f.fretKg)} <span class="capa-leg l"></span><b>libre ${kg(f.libreKg)}</b> sur ${kg(f.capaciteKg)}</div></div>
      ${f.position ? '' : '<div class="erreur" style="margin-top:10px">Cet avion n’est pas dessiné sur la carte : les coordonnées d’un de ses aéroports sont inconnues. Cliquez sur « Actualiser les vols » (page Vols) pour les chercher.</div>'}
      ${f.phase === 'AU_SOL' ? venteHtml(f) : ''}
      ${blocBagages(f, bagages)}`;
    $('#retour').onclick = () => { choisi = null; majCarte(); animer(true); liste(); };
    if (ouvert) branchementAchat(f, formEnCours);
  }

  function blocBagages(f, bagages) {
    if (!personnel && mesBagages && f.numero === ouvrir) {
      const mine = mesBagages();
      return `<div class="soute"><h3>Mes bagages sur ce vol</h3>${mine.length ? mine.map((b) => { const d = b.scans?.[b.scans.length - 1]; return `<div class="mon-sac"><span class="mono">${esc(b.code)}</span> ${pill(b.statut)}<div class="muted petit">${d ? `Dernier scan : ${esc(d.pointNom ?? d.station ?? '')} à ${heure(d.ts)}` : 'Pas encore scanné'}</div></div>`; }).join('') : '<p class="vide">Aucun bagage enregistré sur ce vol.</p>'}<p class="muted petit" style="margin:6px 0 0">Mise à jour automatique à chaque scan.</p></div>`;
    }
    if (!personnel) {
      return `<div class="soute"><h3>Bagages à bord</h3><p style="margin:4px 0"><b>${f.nbBagages}</b> bagage(s) · ${kg(f.bagagesKg)} · ${f.passagers} passager(s)</p>
        <p class="muted petit" style="margin:4px 0 0">Chaque bagage est scanné à chaque station. Passager : suivez le vôtre avec votre numéro de réservation.</p><a class="btn sec mini" href="/index.html" style="margin-top:8px">Suivre mon bagage</a></div>`;
    }
    return `<div class="soute"><h3>${f.phase === 'AU_SOL' ? 'Bagages enregistrés' : 'Bagages à bord'} (${bagages.length})</h3>${bagages.length ? `<div class="tableau"><table><thead><tr><th>Code</th><th>Passager</th><th>Poids</th><th>Statut</th></tr></thead><tbody>${
      bagages.map((b) => `<tr><td class="mono">${esc(b.code)}</td><td>${esc(b.passager ?? '')}</td><td>${b.poidsKg ? kg(b.poidsKg) : '—'}</td><td>${pill(b.statut)}${b.source === 'RFID' ? ' <span class="pill jaune">RFID</span>' : ''}</td></tr>`).join('')
    }</tbody></table></div>` : '<p class="vide">Aucun bagage enregistré sur ce vol.</p>'}</div>`;
  }

  function venteHtml(f) {
    if (f.libreKg <= 0) return '<div class="soute"><h3>Espace en soute</h3><p class="vide">Soute complète : plus d’espace à vendre.</p></div>';
    const max = Math.min(f.libreKg, config.achatMaxKg ?? 50);
    const ops = Object.entries(config.operateursMobileMoney ?? { MPESA: 'M-Pesa' }).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('');
    return `<div class="soute vente"><h3>Acheter de l’espace en soute</h3>
      <p style="margin:2px 0 8px"><b style="font-size:22px">${kg(f.libreKg)}</b> disponibles à <b>${usd(f.prixUsdKg)}</b> le kilo</p>
      <form id="fAchat"><label class="champ" style="margin-top:6px">Poids à envoyer (kg, max ${kg(max)})<input class="input" name="kg" type="number" min="1" max="${max}" step="0.5" value="5" required></label>
      <label class="champ">Votre nom<input class="input" name="nom" required minlength="2" maxlength="80" autocomplete="name"></label>
      <label class="champ">Numéro Mobile Money<input class="input" name="telephone" type="tel" required placeholder="0812345678" autocomplete="tel"></label>
      <label class="champ">Opérateur<select class="input" name="operateur">${ops}</select></label>
      <div class="total" id="total"></div>
      <button class="btn vert bloc" type="submit" id="payer">Payer par Mobile Money</button>
      <p class="muted petit" style="margin:8px 0 0">Mode démonstration : le paiement est simulé, aucun argent n’est prélevé.</p></form><div id="recu"></div></div>`;
  }

  function branchementAchat(f, nomPrecedent) {
    const form = $('#fAchat');
    if (!form) return;
    if (nomPrecedent) form.nom.value = nomPrecedent;
    const maj = () => { $('#total').innerHTML = `Total : <b>${usd((Number(form.kg.value) || 0) * f.prixUsdKg)}</b>`; };
    form.kg.oninput = maj; maj();
    form.onsubmit = async (e) => {
      e.preventDefault();
      $('#payer').disabled = true; $('#payer').textContent = 'Paiement en cours…';
      try {
        const r = await api('POST', '/api/espace/acheter', { volId: f.id, kg: Number(form.kg.value), nom: form.nom.value, telephone: form.telephone.value, operateur: form.operateur.value }, { auth: false });
        toast('Espace réservé ' + r.reference);
        await charger();
        $('#panneauRecu')?.remove();
        $('#rPanneau').insertAdjacentHTML('afterbegin', `<div class="recu" id="panneauRecu"><b>Réservation confirmée</b><div class="mono" style="font-size:20px;margin:4px 0">${esc(r.reference)}</div>
          <div class="petit">${esc(r.numeroVol)} · ${esc(r.trajet)} · ${kg(r.kg)} · <b>${usd(r.montantUsd)}</b><br>${esc(r.operateur)} · ${esc(r.telephone)}</div><div class="muted petit" style="margin-top:6px">${esc(r.message)}</div></div>`);
      } catch (err) { toast(err.message, 'err'); $('#payer').disabled = false; $('#payer').textContent = 'Payer par Mobile Money'; }
    };
  }

  await initCarte();
  await charger();
  const cible = ouvrir && vols.find((v) => v.numero === ouvrir);
  if (cible) await choisir(cible.id);
  if (personnel) $('#rAcc').onchange = (e) => {
    if (e.target.checked) { accDebut = Date.now(); accReel = Date.now(); acc = 60; } else acc = 1;
    $('#rAccNote').hidden = acc === 1; animer(true);
  };
  animation = setInterval(() => animer(), 1000);
  minuteur = setInterval(() => { if (!document.body.contains(racine)) { clearInterval(minuteur); clearInterval(animation); return; } if (!document.activeElement?.closest?.('#fAchat')) charger(); }, 10000);
  return () => { clearInterval(minuteur); clearInterval(animation); };
}
