// Lecteurs RFID (portiques VIP) : le lecteur ou sa passerelle envoie les lectures de puces ; chaque lecture
// devient un passage du bagage au point de scan correspondant (source « RFID »).
import { createHash, timingSafeEqual } from 'node:crypto';
import { enregistrerScan, HttpError } from './logic.js';

export function cleLecteurValide(attendue, recue) {
  if (!attendue || !recue) return false;
  const h = (x) => createHash('sha256').update(String(x)).digest();
  return timingSafeEqual(h(attendue), h(recue));
}

// lectures : [{ code (contenu de la puce = code du bagage), point (code du point, ex. FIH-TRI), ts? }]
export async function traiterLectures(repo, lectures) {
  if (!Array.isArray(lectures) || !lectures.length) throw new HttpError(400, 'Aucune lecture reçue');
  if (lectures.length > 200) throw new HttpError(400, 'Maximum 200 lectures par envoi');
  const resultats = [];
  for (const l of lectures) {
    const code = String(l?.code ?? '').trim().toUpperCase();
    try {
      const point = await repo.findOne('points', { code: String(l?.point ?? '').trim().toUpperCase() });
      if (!point) throw new HttpError(404, 'Point inconnu');
      const r = await enregistrerScan(repo, { code, pointId: point.id, agent: `Portique ${point.code}`, source: 'RFID' });
      resultats.push({ code, ok: true, statut: r.bagage.statut });
    } catch (e) {
      // Un lecteur relit la même puce plusieurs fois : une relecture n'est pas une erreur.
      if (e.status === 409 && /Déjà scanné/.test(e.message)) resultats.push({ code, ok: true, ignore: true });
      else resultats.push({ code, ok: false, erreur: e.message });
    }
  }
  return { resultats };
}
