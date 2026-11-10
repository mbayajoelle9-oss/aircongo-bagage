// Utilitaires partagés par les trois écrans.
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const BASE = (window.API_URL || '').replace(/\/$/, '');

export async function api(method, url, body, key) {
  let res;
  try {
    res = await fetch(BASE + url, {
      method,
      headers: { 'content-type': 'application/json', ...(key ? { 'x-api-key': key } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Serveur injoignable. Il se réveille peut-être : réessayez dans une minute.');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.erreur || 'Erreur ' + res.status);
  return json;
}

export const heure = (iso) =>
  iso ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';

export const usd = (n) => '$' + Number(n).toFixed(2).replace(/\.00$/, '');

export function message(el, type, texte) {
  el.className = 'msg ' + type;
  el.textContent = texte;
  el.hidden = !texte;
}

export const ETAPES = [
  ['ENREGISTRE', 'Enregistré'],
  ['CHARGE', 'Chargé'],
  ['TRANSIT', 'Transit'],
  ['ARRIVE', 'Arrivé'],
  ['LIVRE', 'Remis'],
];

export function frise(statut) {
  const idx = ETAPES.findIndex(([e]) => e === statut);
  return (
    '<div class="frise">' +
    ETAPES.map(([e, l], i) => `<div class="etape ${i <= idx ? 'fait' : ''} ${i === idx ? 'courant' : ''}">${l}</div>`).join('') +
    '</div>'
  );
}
