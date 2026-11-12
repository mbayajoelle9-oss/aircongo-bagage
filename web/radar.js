// Radar des vols : les avions sur une vraie carte OpenStreetMap. Cliquer un avion :
//  - en vol : les bagages à bord (détail réservé au personnel) ;
//  - au sol : l'espace libre en soute, avec achat par Mobile Money.
import { api, esc, usd, heure, dateHeure, pill, toast, chargerLeaflet } from '/common.js';

const COULEURS = { EN_VOL: '#1f9d55', AU_SOL: '#1c8fd0', ARRIVE: '#8a97a8', ANNULE: '#d9302c' };
const CLASSES = { EN_VOL: 'vert', AU_SOL: 'bleu', ARRIVE: 'gris', ANNULE: 'rouge' };
const SVG = (c) => `<svg viewBox="0 0 32 32"><path d="M16 1.5c1.1 0 1.9 1.2 1.9 3v7.6l11.1 6.6v2.6l-11.1-3.1v6.2l3.2 2.5v2.1L16 27.9l-5.1 1.6v-2.1l3.2-2.5v-6.2L3 21.3v-2.6l11.1-6.6V4.5c0-1.8.8-3 1.9-3z" fill="${c}" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
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
function relevement(p, q) {
  const dl = rad(q[1] - p[1]), y = Math.sin(dl) * Math.cos(rad(q[0]));
  const x = Math.cos(rad(p[0])) * Math.sin(rad(q[0])) - Math.sin(rad(p[0])) * Math.cos(rad(q[0])) * Math.cos(dl);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}
// Points du grand cercle entre les fractions f0 et f1 : la trajectoire réelle (courbe), pas une droite.
function arc(a, b, f0 = 0, f1 = 1) {
  const n = Math.max(2, Math.ceil(90 * (f1 - f0)) + 1), out = [];
  for (let i = 0; i <= n; i++) out.push(interp(a, b, f0 + ((f1 - f0) * i) / n));
  return out;
}
function etatLocal(v, t) {
  if (!v.position) return null;
  const A = v.trace[0], B = v.trace[1];
  const capA = (f) => { const f0 = Math.min(Math.max(f, 0), 0.99); return relevement(interp(A, B, f0), interp(A, B, f0 + 0.01)); };
  const fixe = { phase: v.phase, f: v.progression, pos: [v.position.lat, v.position.lon], cap: capA(v.progression) };
  if (!v.departTs || !v.arriveeTs || v.phase === 'ANNULE' || v.statut === 'ATTERRI') return fixe;
  const dep = Date.parse(v.departTs), arr = Date.parse(v.arriveeTs);
  const f = t < dep ? 0 : t >= arr ? 1 : Math.min(0.97, Math.max(0.03, (t - dep) / (arr - dep)));
  return { phase: t < dep ? 'AU_SOL' : t >= arr ? 'ARRIVE' : 'EN_VOL', f, pos: interp(A, B, f), cap: capA(f) };
}

function km(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

export async function lancerRadar(racine, { personnel = false, filtre: filtreInitial = '', ouvrir = null, mesBagages = null } = {}) {
  let vols = [], choisi = null, filtre = filtreInitial, acc = 1, accDebut = 0, accReel = 0, animation = null, sac = null, suivi = false, dernier = 0, traceId = null;
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
      <button class="btn sec" type="button" id="rVue">⌖ Vue d’ensemble</button>
      ${personnel ? '<select class="input" id="rVit" aria-label="Vitesse de la simulation"><option value="1">Temps réel ×1</option><option value="10">Accéléré ×10</option><option value="60">Démo ×60</option><option value="300">Démo ×300</option></select>' : ''}
    </form>
    <div class="erreur" id="rAccNote" hidden style="margin:0 0 10px">Simulation accélérée pour la démonstration : les positions affichées sont fictives, les horaires réels ne changent pas.</div>
    <div class="puces" id="rPuces"></div>
    <div class="radar-grille">
      <div class="radar-carte"><div class="radar-hud" id="rHud"></div><div class="osm" id="rCarte" style="height:620px"></div>
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

  const icone = (v, phase = v.phase, cap = v.cap ?? 0) => L.divIcon({ className: '', html: `<div class="avion-wrap${phase === 'EN_VOL' ? ' vol' : ''}${v.id === choisi ? ' choisi' : ''}"><div class="cap" style="transform:rotate(${cap}deg)">${SVG(COULEURS[phase])}</div>${phase === 'EN_VOL' || v.id === choisi ? `<div class="avion-etiq">${esc(v.numero)}</div>` : ''}</div>`, iconSize: [44, 44], iconAnchor: [22, 22] });

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
    carte.on('dragstart', () => arreterSuivi());
    carte.on('click', () => carte.scrollWheelZoom.enable());
    carte.on('mouseout', () => carte.scrollWheelZoom.disable());
  }

  const aeroports = new Map(), routes = new Map();
  function majCarte() {
    if (!carte) return;
    const visibles = vols.filter((x) => x.position);
    const presents = new Set(visibles.map((v) => v.id));
    for (const [id, m] of marqueurs) if (!presents.has(id)) { m.remove(); marqueurs.delete(id); }
    for (const [id, r] of routes) if (!presents.has(id)) { r.fait?.remove(); r.reste?.remove(); routes.delete(id); }
    for (const v of visibles) {
      let m = marqueurs.get(v.id);
      const e = etatLocal(v, maintenant());
      if (!m) {
        m = L.marker(e.pos, { icon: icone(v, e.phase, e.cap), zIndexOffset: e.phase === 'EN_VOL' ? 500 : 0, title: v.numero }).addTo(carte);
        m.bindTooltip?.(`${esc(v.numero)} · ${esc(v.depart)} → ${esc(v.arrivee)}`);
        m.on('click', () => choisir(v.id));
        marqueurs.set(v.id, m);
      } else { m.setLatLng(e.pos); m.setIcon(icone(v, e.phase, e.cap)); }
    }
    // Aéroports d'origine et de destination, avec leur code IATA
    const codes = new Map();
    for (const v of visibles) { codes.set(v.depart, v.trace[0]); codes.set(v.arrivee, v.trace[1]); }
    for (const [c, m] of aeroports) if (!codes.has(c)) { m.remove(); aeroports.delete(c); }
    for (const [c, p] of codes) if (!aeroports.has(c)) aeroports.set(c, L.marker([p.lat, p.lon], { icon: L.divIcon({ className: '', html: `<div class="apt-pt"><i></i><b>${esc(c)}</b></div>`, iconSize: [0, 0] }), zIndexOffset: -200, interactive: false }).addTo(carte));
    if (premier && visibles.length) { carte.fitBounds(visibles.flatMap((v) => [[v.trace[0].lat, v.trace[0].lon], [v.trace[1].lat, v.trace[1].lon]]), { padding: [60, 60], maxZoom: 8 }); premier = false; }
    animer(true);
  }
  const hud = () => {
    const el = $('#rHud'); if (!el) return;
    const nb = (p) => vols.filter((v) => v.phase === p).length;
    const hr = new Date(maintenant()).toLocaleTimeString('fr-FR', { timeZone: 'Africa/Kinshasa' });
    el.innerHTML = `<div><b>${nb('EN_VOL')}</b><span>en vol</span></div><div><b>${nb('AU_SOL')}</b><span>au sol</span></div><div><b>${nb('ARRIVE')}</b><span>arrivés</span></div><div class="horloge"><b>${hr}</b><span>Kinshasa${acc > 1 ? ` · ×${acc}` : ''}</span></div>`;
  };

  function arreterSuivi() { suivi = false; }
  function demarrerSuivi() {
    const v = vols.find((x) => x.id === choisi), e = v && etatLocal(v, maintenant());
    if (!carte || !e || e.phase !== 'EN_VOL') return toast('Le suivi en direct est possible pour un avion en vol', 'warn');
    suivi = true; carte.setView(e.pos, Math.max(carte.getZoom(), 10), { animate: false }); animer(true);
  }

  // Trajectoire : partie parcourue en trait plein lumineux, partie restante en pointillés animés.
  function tracer(v, e) {
    const A = v.trace[0], B = v.trace[1], sel = v.id === choisi;
    let r = routes.get(v.id);
    if (r && r.sel !== sel) { r.fait?.remove(); r.reste?.remove(); routes.delete(v.id); r = null; }
    if (!sel && e.phase !== 'EN_VOL') { if (r) { r.fait?.remove(); r.reste?.remove(); routes.delete(v.id); } return; }
    if (!r) { r = { sel, fait: null, reste: null }; routes.set(v.id, r); }
    const f = e.phase === 'EN_VOL' ? e.f : e.phase === 'ARRIVE' ? 1 : 0;
    const dFait = f > 0 ? [...arc(A, B, 0, f)] : [], dReste = f < 1 ? arc(A, B, f, 1) : [];
    if (dFait.length) { dFait[dFait.length - 1] = e.pos; }
    const couleur = e.phase === 'ARRIVE' ? COULEURS.ARRIVE : e.phase === 'AU_SOL' ? COULEURS.AU_SOL : COULEURS.EN_VOL;
    if (dFait.length) {
      if (r.fait?.setLatLngs) r.fait.setLatLngs(dFait);
      else r.fait = L.polyline(dFait, { color: couleur, weight: sel ? 5 : 3, opacity: 0.95, className: 'route-fait', lineCap: 'round', interactive: false }).addTo(carte);
    } else if (r.fait) { r.fait.remove(); r.fait = null; }
    if (dReste.length) {
      if (r.reste?.setLatLngs) r.reste.setLatLngs(dReste);
      else r.reste = L.polyline(dReste, { color: sel ? '#0b2a4a' : couleur, weight: sel ? 3 : 2, opacity: sel ? 0.75 : 0.4, dashArray: sel ? '8 8' : '3 9', className: sel ? 'route-anim' : '', interactive: false }).addTo(carte);
    } else if (r.reste) { r.reste.remove(); r.reste = null; }
  }

  let derTrace = 0, derHud = 0;
  // Appelée à ~30 images/s : déplace et oriente les avions, allonge les trajectoires, suit les bagages du passager.
  function animer(force = false) {
    if (!carte) return;
    const t = maintenant(), tp = performance.now();
    const majTrace = force || tp - derTrace > 200;
    if (majTrace) derTrace = tp;
    if (force || tp - derHud > 500) { derHud = tp; hud(); }
    for (const v of vols) {
      const m = marqueurs.get(v.id), e = etatLocal(v, t);
      if (!m || !e) continue;
      m.setLatLng(e.pos);
      const cle = `${e.phase}|${v.id === choisi}`;
      if (force || m._cle !== cle) { m.setIcon(icone(v, e.phase, e.cap)); m._cle = cle; m._cap = e.cap; }
      else if (Math.abs((m._cap ?? -999) - e.cap) > 0.3) { const c = m.getElement?.()?.querySelector('.cap'); if (c) c.style.transform = `rotate(${e.cap}deg)`; m._cap = e.cap; }
      if (majTrace) tracer(v, e);
      if (v.id === choisi) {
        const pct = racine.querySelector('#pct'); if (pct) pct.textContent = e.phase === 'EN_VOL' ? ` · ${Math.round(e.f * 100)} %` : '';
        const bar = racine.querySelector('#barreVol'); if (bar) bar.style.width = `${e.f * 100}%`;
        const live = racine.querySelector('#live');
        if (live && majTrace) {
          if (e.phase === 'EN_VOL' && v.departTs && v.arriveeTs) {
            const total = km(v.trace[0], v.trace[1]), dur = (Date.parse(v.arriveeTs) - Date.parse(v.departTs)) / 3600000;
            const reste = Math.max(0, total * (1 - e.f)), min = Math.max(0, Math.round((Date.parse(v.arriveeTs) - t) / 60000));
            live.innerHTML = `<div><b>${Math.round(total / dur)}</b><span>km/h</span></div><div><b>${Math.round(reste)}</b><span>km restants</span></div><div><b>${min}</b><span>min avant l’arrivée</span></div><div><b>${Math.round(e.cap)}°</b><span>cap</span></div>`;
          } else live.innerHTML = '';
        }
        if (suivi && e.phase === 'EN_VOL') carte.setView(e.pos, carte.getZoom(), { animate: false });
        const bs = racine.querySelector('#btnSuivi'); if (bs) bs.textContent = suivi ? '⏹ Quitter le suivi' : '🎥 Suivre en direct';
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
    if (v?.position && carte) carte.fitBounds([[v.trace[0].lat, v.trace[0].lon], [v.trace[1].lat, v.trace[1].lon]], { padding: [90, 90], maxZoom: 9 });
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
      ${f.phase === 'EN_VOL' && f.position ? '<div id="live" class="live-compteurs"></div><button type="button" class="btn mini" id="btnSuivi" style="margin-top:8px">🎥 Suivre en direct</button>' : ''}
      ${f.position ? '' : '<div class="erreur" style="margin-top:10px">Cet avion n’est pas dessiné sur la carte : les coordonnées d’un de ses aéroports sont inconnues. Cliquez sur « Actualiser les vols » (page Vols) pour les chercher.</div>'}
      ${f.phase === 'AU_SOL' ? venteHtml(f) : ''}
      ${blocBagages(f, bagages)}`;
    const bsuivi = $('#btnSuivi'); if (bsuivi) bsuivi.onclick = () => (suivi ? arreterSuivi() : demarrerSuivi());
    $('#retour').onclick = () => { arreterSuivi(); choisi = null; majCarte(); animer(true); liste(); };
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
  if (cible) { await choisir(cible.id); if (!personnel && cible.phase === 'EN_VOL') demarrerSuivi(); }
  if (personnel) $('#rVit').onchange = (e) => {
    const n = Number(e.target.value), now = maintenant();
    acc = n; accDebut = now; accReel = Date.now();
    $('#rAccNote').hidden = acc === 1; animer(true);
  };
  $('#rVue').onclick = () => { arreterSuivi(); choisi = null; premier = true; majCarte(); liste(); };
  const boucle = (ts) => {
    if (!document.body.contains(racine)) return;
    if (ts - dernier >= 33) { dernier = ts; animer(); } // ~30 images/s : mouvement continu
  animation = requestAnimationFrame(boucle);
  };
  animation = requestAnimationFrame(boucle);
  minuteur = setInterval(() => { if (!document.body.contains(racine)) { clearInterval(minuteur); return; } if (!document.activeElement?.closest?.('#fAchat')) charger(); }, 10000);
  return () => { clearInterval(minuteur); cancelAnimationFrame(animation); };
}
