// Radar des vols : les avions sur une vraie carte OpenStreetMap. Cliquer un avion :
//  - en vol : les bagages à bord (détail réservé au personnel) ;
//  - au sol : l'espace libre en soute, avec achat par Mobile Money.
import { api, esc, usd, heure, dateHeure, pill, toast, chargerLeaflet } from '/common.js';

const COULEURS = { EN_VOL: '#1f9d55', AU_SOL: '#1c8fd0', ARRIVE: '#8a97a8', ANNULE: '#d9302c' };
const CLASSES = { EN_VOL: 'vert', AU_SOL: 'bleu', ARRIVE: 'gris', ANNULE: 'rouge' };
const SVG = (c) => `<svg viewBox="0 0 24 24" width="36" height="36"><path d="M12 1.5l1.9 7.2 8.1 4.6v2.2l-8.1-2.4-.7 5.1 2.5 1.9v1.4L12 20.4l-3.7 1.1v-1.4l2.5-1.9-.7-5.1L2 15.5v-2.2l8.1-4.6z" fill="${c}" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
const kg = (n) => `${Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} kg`;

export async function lancerRadar(racine, { personnel = false } = {}) {
  let vols = [], choisi = null, filtre = '', config = {}, minuteur = null, premier = true;
  const marqueurs = new Map();
  let L = null, carte = null, trace = null;

  racine.innerHTML = `<div class="radar">
    <form class="radar-recherche" id="rForm" autocomplete="off">
      <input class="input" id="rQ" list="rListe" placeholder="Nom de la compagnie : Air Congo, Kenya Airways, Ethiopian…" aria-label="Compagnie aérienne">
      <datalist id="rListe"></datalist>
      <button class="btn" type="submit">Rechercher</button>
      <button class="btn sec" type="button" id="rTous" hidden>Tous les vols</button>
    </form>
    <div class="puces" id="rPuces"></div>
    <div class="radar-grille">
      <div class="radar-carte"><div class="osm" id="rCarte" style="height:580px"></div>
        <p class="legende-carte"><span class="pastille" style="background:${COULEURS.EN_VOL}"></span> en vol <span class="pastille" style="background:${COULEURS.AU_SOL}"></span> au sol (espace à vendre) <span class="pastille" style="background:${COULEURS.ARRIVE}"></span> arrivé · positions calculées d’après les horaires</p></div>
      <aside class="radar-panneau" id="rPanneau"></aside>
    </div></div>`;
  const $ = (s) => racine.querySelector(s);

  try { config = await api('GET', '/api/config', undefined, { auth: false }); } catch { /* valeurs par défaut */ }
  api('GET', '/api/radar/compagnies', undefined, { auth: false }).then((l) => {
    $('#rListe').innerHTML = l.map((c) => `<option value="${esc(c.nom)}"></option>`).join('');
    $('#rPuces').innerHTML = l.slice(0, 6).map((c) => `<button type="button" class="puce" data-c="${esc(c.nom)}">${esc(c.nom)}</button>`).join('');
    $('#rPuces').querySelectorAll('[data-c]').forEach((b) => (b.onclick = () => { $('#rQ').value = b.dataset.c; filtrer(b.dataset.c); }));
  }).catch(() => {});

  const filtrer = async (q) => { filtre = q.trim(); choisi = null; premier = true; $('#rTous').hidden = !filtre; await charger(); };
  $('#rForm').onsubmit = (e) => { e.preventDefault(); filtrer($('#rQ').value); };
  $('#rTous').onclick = () => { $('#rQ').value = ''; filtrer(''); };

  const icone = (v) => L.divIcon({ className: '', html: `<div class="avion${v.id === choisi ? ' choisi' : ''}" style="transform:rotate(${v.cap}deg)">${SVG(COULEURS[v.phase])}</div>`, iconSize: [36, 36], iconAnchor: [18, 18] });

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
    const presents = new Set(vols.map((v) => v.id));
    for (const [id, m] of marqueurs) if (!presents.has(id)) { m.remove(); marqueurs.delete(id); }
    for (const v of vols) {
      let m = marqueurs.get(v.id);
      if (!m) {
        m = L.marker([v.position.lat, v.position.lon], { icon: icone(v), zIndexOffset: v.phase === 'EN_VOL' ? 500 : 0, title: v.numero }).addTo(carte);
        m.bindTooltip?.(`${esc(v.numero)} · ${esc(v.depart)} → ${esc(v.arrivee)}`);
        m.on('click', () => choisir(v.id));
        marqueurs.set(v.id, m);
      } else { m.setLatLng([v.position.lat, v.position.lon]); m.setIcon(icone(v)); }
    }
    if (premier && vols.length) { carte.fitBounds(vols.map((v) => [v.position.lat, v.position.lon]), { padding: [50, 50], maxZoom: 8 }); premier = false; }
    trace?.remove(); trace = null;
    const v = vols.find((x) => x.id === choisi);
    if (v) trace = L.polyline(v.trace.map((p) => [p.lat, p.lon]), { color: COULEURS[v.phase], weight: 3, dashArray: '8 8', opacity: 0.8 }).addTo(carte);
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
        <div class="muted petit">${esc(v.compagnie ?? '')} · ${esc(v.villeDepart)} → ${esc(v.villeArrivee)} · ${v.departTs ? heure(v.departTs) : esc(v.heureDepart ?? '—')}</div>
        <div class="petit" style="margin-top:4px">${v.phase === 'AU_SOL' ? `<b>${kg(v.libreKg)}</b> libres · ${usd(v.prixUsdKg)}/kg` : `${v.nbBagages} bagage(s) · ${kg(v.bagagesKg)}`}</div></button>`).join('') : '<p class="vide">Aucun vol pour cette recherche. Essayez « Air Congo » ou un autre nom de compagnie.</p>'}`;
    $('#rPanneau').querySelectorAll('[data-id]').forEach((b) => (b.onclick = () => choisir(b.dataset.id)));
  }

  async function choisir(id) {
    choisi = id;
    majCarte();
    for (const v of vols) marqueurs.get(v.id)?.setIcon(icone(v));
    const v = vols.find((x) => x.id === id);
    if (v && carte) carte.setView([v.position.lat, v.position.lon], Math.max(carte.getZoom?.() ?? 6, 6));
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
      <div class="vol-tete"><div><h2 style="margin:10px 0 0">${esc(f.numero)} <span class="pill ${CLASSES[f.phase]}">${esc(f.libellePhase)}${f.phase === 'EN_VOL' ? ` · ${Math.round(f.progression * 100)} %` : ''}</span></h2>
        <div class="muted petit">${esc(f.compagnie ?? '')} · ${esc(f.villeDepart)} (${esc(f.depart)}) → ${esc(f.villeArrivee)} (${esc(f.arrivee)})</div>
        <div class="petit">Départ ${f.departTs ? dateHeure(f.departTs) : esc(f.heureDepart ?? '—')}${f.retardMin > 0 ? ` · retard ${f.retardMin} min` : ''} · Arrivée ${f.arriveeTs ? heure(f.arriveeTs) : '—'}</div></div></div>
      ${f.phase === 'EN_VOL' ? `<div class="capa-barre" style="margin-top:12px" title="Progression"><span class="b" style="width:${f.progression * 100}%;background:var(--vert)"></span></div>` : ''}
      <div class="soute"><h3>Soute</h3><div class="capa-barre"><span class="b" style="width:${pctB}%"></span><span class="f" style="width:${pctF}%"></span></div>
        <div class="petit"><span class="capa-leg b" style="margin-left:0"></span>bagages ${kg(f.bagagesKg)} <span class="capa-leg f"></span>fret ${kg(f.fretKg)} <span class="capa-leg l"></span><b>libre ${kg(f.libreKg)}</b> sur ${kg(f.capaciteKg)}</div></div>
      ${f.phase === 'AU_SOL' ? venteHtml(f) : ''}
      ${blocBagages(f, bagages)}`;
    $('#retour').onclick = () => { choisi = null; majCarte(); for (const v of vols) marqueurs.get(v.id)?.setIcon(icone(v)); liste(); };
    if (ouvert) branchementAchat(f, formEnCours);
  }

  function blocBagages(f, bagages) {
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
  minuteur = setInterval(() => { if (!document.body.contains(racine)) { clearInterval(minuteur); return; } if (!document.activeElement?.closest?.('#fAchat')) charger(); }, 10000);
  return () => clearInterval(minuteur);
}
