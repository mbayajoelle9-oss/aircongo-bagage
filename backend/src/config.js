// Paramètres de DÉMO : à remplacer par les règles réelles d'Air Congo.
export const CONFIG = {
  // Franchise de bagages en soute (kg) selon la classe
  franchiseKg: { ECO: 23, BUSINESS: 32, VIP: 40 },
  // Tarif d'excédent au comptoir (USD par kg)
  tarifExcedentUsd: 10,
  // Remise si l'excédent est payé en ligne avant le vol
  remisePrepaiement: 0.2,
  // Alerte si un bagage reste bloqué (enregistré non chargé, ou arrivé non remis) plus de N minutes
  alerteMinutes: 30,
};

export const ETAPES = ['ENREGISTRE', 'CHARGE', 'TRANSIT', 'ARRIVE', 'LIVRE'];

export const LIBELLES = {
  PRE_ENREGISTRE: 'Pré-enregistré',
  ENREGISTRE: 'Enregistré au comptoir',
  CHARGE: 'Chargé dans l’avion',
  TRANSIT: 'En transit',
  ARRIVE: 'Arrivé à destination',
  LIVRE: 'Remis au passager',
};

// Chaque point de passage d'un bagage est une station (coordonnées approximatives, pour la cartographie).
export const STATIONS = {
  FIH: { nom: 'Kinshasa – N’Djili', ville: 'Kinshasa', lat: -4.386, lon: 15.445 },
  FBM: { nom: 'Lubumbashi – Luano', ville: 'Lubumbashi', lat: -11.591, lon: 27.531 },
  GOM: { nom: 'Goma', ville: 'Goma', lat: -1.672, lon: 29.238 },
  FKI: { nom: 'Kisangani – Bangoka', ville: 'Kisangani', lat: 0.481, lon: 25.338 },
  MJM: { nom: 'Mbuji-Mayi', ville: 'Mbuji-Mayi', lat: -6.121, lon: 23.569 },
  KWZ: { nom: 'Kolwezi', ville: 'Kolwezi', lat: -10.766, lon: 25.505 },
};
