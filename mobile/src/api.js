// Client de l'API Air Congo (Render). L'application ne dépend d'aucun site web.
export const API = 'https://aircongo-bagage.onrender.com';

export async function api(methode, chemin, corps, jeton) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 45000); // Render gratuit : le 1er appel peut prendre ~30 s
  try {
    const res = await fetch(API + chemin, {
      method: methode,
      headers: { 'Content-Type': 'application/json', ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) },
      body: corps ? JSON.stringify(corps) : undefined,
      signal: ctl.signal,
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(d.erreur ?? `Erreur ${res.status}`); e.status = res.status; throw e; }
    return d;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Le serveur met trop de temps à répondre. Réessayez.');
    if (e instanceof TypeError) throw new Error('Pas de connexion au serveur. Vérifiez votre réseau.');
    throw e;
  } finally { clearTimeout(t); }
}
