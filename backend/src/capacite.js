// Capacité de soute par vol et revente de l'espace libre (fret / colis de dernière minute).
import { CONFIG } from './config.js';
import { HttpError } from './logic.js';

const r2 = (n) => Math.round(n * 100) / 100;

export async function capaciteVols(repo) {
  const [vols, reservations, bagages, ventes, paiements] = await Promise.all([
    repo.find('vols'), repo.find('reservations'), repo.find('bagages'), repo.find('ventesEspace'), repo.find('paiements'),
  ]);
  return vols.map((v) => {
    const resIds = new Set(reservations.filter((r) => r.volId === v.id).map((r) => r.id));
    const sacs = bagages.filter((b) => resIds.has(b.reservationId));
    const bagagesKg = r2(sacs.reduce((n, b) => n + b.poidsKg, 0));
    const lesVentes = ventes.filter((x) => x.volId === v.id);
    const fretKg = r2(lesVentes.reduce((n, x) => n + x.kg, 0));
    const capaciteKg = v.capaciteKg ?? CONFIG.capaciteSouteKg;
    const libreKg = r2(Math.max(0, capaciteKg - bagagesKg - fretKg));
    const prix = v.prixReventeUsdKg ?? CONFIG.tarifReventeUsdKg;
    return {
      id: v.id, numero: v.numero, date: v.date ?? null, depart: v.depart, arrivee: v.arrivee, heureDepart: v.heureDepart ?? null,
      statut: v.statut ?? null, capaciteKg, capaciteDefinie: v.capaciteKg !== undefined,
      nbBagages: sacs.length, bagagesKg, fretKg, libreKg,
      remplissagePct: capaciteKg ? Math.min(100, Math.round(((bagagesKg + fretKg) / capaciteKg) * 100)) : 0,
      prixReventeUsdKg: prix, potentielUsd: r2(libreKg * prix),
      recettesFretUsd: r2(lesVentes.reduce((n, x) => n + x.montantUsd, 0)),
      recettesExcedentUsd: r2(paiements.filter((p) => resIds.has(p.reservationId)).reduce((n, p) => n + p.montantUsd, 0)),
    };
  }).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || (a.heureDepart ?? '').localeCompare(b.heureDepart ?? ''));
}

export async function configurerVol(repo, volId, { capaciteKg, prixReventeUsdKg }) {
  const vol = await repo.findOne('vols', { id: String(volId ?? '') });
  if (!vol) throw new HttpError(404, 'Vol introuvable');
  const maj = {};
  if (capaciteKg !== undefined) {
    const c = Number(capaciteKg);
    if (!Number.isFinite(c) || c < 0 || c > 50000) throw new HttpError(400, 'Capacité invalide (0 à 50 000 kg)');
    maj.capaciteKg = r2(c);
  }
  if (prixReventeUsdKg !== undefined) {
    const p = Number(prixReventeUsdKg);
    if (!Number.isFinite(p) || p <= 0 || p > 200) throw new HttpError(400, 'Prix invalide (0 à 200 $ par kg)');
    maj.prixReventeUsdKg = r2(p);
  }
  return repo.update('vols', vol.id, maj);
}

export async function vendreEspace(repo, { volId, kg, client, prixUsdKg, agent, ts }) {
  const cap = (await capaciteVols(repo)).find((v) => v.id === String(volId ?? ''));
  if (!cap) throw new HttpError(404, 'Vol introuvable');
  if (cap.statut === 'ANNULE' || cap.statut === 'ATTERRI') throw new HttpError(409, 'Ce vol n’accepte plus de fret');
  const poids = Number(kg);
  if (!Number.isFinite(poids) || poids <= 0) throw new HttpError(400, 'Poids invalide');
  if (poids > cap.libreKg) throw new HttpError(409, `Espace insuffisant : ${cap.libreKg} kg libres sur ${cap.numero}`);
  const nom = String(client ?? '').trim();
  if (nom.length < 2 || nom.length > 80) throw new HttpError(400, 'Nom du client requis (2 à 80 caractères)');
  const prix = prixUsdKg === undefined || prixUsdKg === '' ? cap.prixReventeUsdKg : Number(prixUsdKg);
  if (!Number.isFinite(prix) || prix <= 0 || prix > 200) throw new HttpError(400, 'Prix invalide (0 à 200 $ par kg)');
  return repo.insert('ventesEspace', {
    volId: cap.id, numeroVol: cap.numero, kg: r2(poids), prixUsdKg: r2(prix), montantUsd: r2(poids * prix),
    client: nom, type: 'FRET', agent: String(agent ?? 'agent').slice(0, 60), ts: ts ?? new Date().toISOString(),
  });
}

export async function listerVentes(repo) {
  return (await repo.find('ventesEspace')).sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 50);
}
