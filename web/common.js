// Fonctions communes : appels API, session, affichage.
const BASE = (window.API_URL || '').replace(/\/$/, '');

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---- Session du personnel (sessionStorage : effacée à la fermeture de l'onglet) ----
export const session = {
  get token() { return sessionStorage.getItem('ac_token'); },
  get user() { try { return JSON.parse(sessionStorage.getItem('ac_user')); } catch { return null; } },
  set(token, user) { sessionStorage.setItem('ac_token', token); sessionStorage.setItem('ac_user', JSON.stringify(user)); },
  clear() { sessionStorage.removeItem('ac_token'); sessionStorage.removeItem('ac_user'); },
};

export async function api(method, url, body, { auth = true } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (auth && session.token) headers.authorization = 'Bearer ' + session.token;
  let res;
  try {
    res = await fetch(BASE + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('Serveur injoignable. Il se réveille peut-être : réessayez dans une minute.');
  }
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && auth && session.token) {
    session.clear();
    location.href = '/index.html?expire=1';
    throw new Error('Session expirée');
  }
  if (!res.ok) throw new Error(json.erreur || 'Erreur ' + res.status);
  return json;
}

// ---- Formats ----
export const heure = (iso) => (iso ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '');
export const dateHeure = (iso) =>
  iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
export const usd = (n) => '$' + Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// ---- Statuts ----
export const STATUTS = {
  PRE_ENREGISTRE: { label: 'Pré-enregistré', cls: 'gris' },
  ENREGISTRE: { label: 'Enregistré', cls: 'bleu' },
  CHARGE: { label: 'Chargé', cls: 'bleu' },
  TRANSIT: { label: 'En transit', cls: 'bleu' },
  ARRIVE: { label: 'Arrivé', cls: 'jaune' },
  LIVRE: { label: 'Remis', cls: 'vert' },
};
export const pill = (statut) => {
  const s = STATUTS[statut] || { label: statut, cls: 'gris' };
  return `<span class="pill ${s.cls}">${esc(s.label)}</span>`;
};
const ETAPES = ['ENREGISTRE', 'CHARGE', 'TRANSIT', 'ARRIVE', 'LIVRE'];
export function frise(statut) {
  const idx = ETAPES.indexOf(statut);
  return (
    '<div class="frise">' +
    ETAPES.map((e, i) => `<div class="etape ${i <= idx ? 'fait' : ''} ${i === idx ? 'courant' : ''}"><i></i><span>${esc(STATUTS[e].label)}</span></div>`).join('') +
    '</div>'
  );
}

// ---- Icônes (SVG en ligne) ----
const ICONES = {
  grille: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  bagage: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/>',
  alerte: '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
  equipe: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.5 3-6 7-6s7 2.5 7 6"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14c3 0 5 2 5 5"/>',
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3"/><path d="M16 4h3a1 1 0 0 1 1 1v3"/><path d="M20 16v3a1 1 0 0 1-1 1h-3"/><path d="M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M4 12h16"/>',
  sortie: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  avion: '<path d="M2 12l8-2 5-7 2 1-3 7 6 1 2-2 1 1-2 4-5 1-1 6-2-1 0-5-7 0z"/>',
};
export const icone = (nom) => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[nom] || ''}</svg>`;

// ---- Notifications ----
export function toast(texte, type = 'ok') {
  let zone = document.getElementById('toasts');
  if (!zone) {
    zone = document.createElement('div');
    zone.id = 'toasts';
    document.body.appendChild(zone);
  }
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = texte;
  zone.appendChild(t);
  setTimeout(() => t.remove(), type === 'err' ? 6000 : 3500);
}

// ---- QR code (bibliothèque chargée à la demande ; sans elle, on affiche seulement le code) ----
let promesseQR;
const chargerQR = () =>
  (promesseQR ??= new Promise((resolve) => {
    if (window.qrcode) return resolve(true);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
    s.onload = () => resolve(!!window.qrcode);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  }));
export async function qrImage(texte) {
  if (!(await chargerQR())) return '';
  try {
    const qr = window.qrcode(0, 'M');
    qr.addData(String(texte));
    qr.make();
    return qr.createImgTag(6, 2, `QR code ${texte}`);
  } catch {
    return '';
  }
}

export function ouvrirDialogue(html) {
  const d = document.createElement('dialog');
  d.className = 'modal';
  d.innerHTML = html;
  document.body.appendChild(d);
  d.addEventListener('close', () => d.remove());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  d.showModal();
  return d;
}
