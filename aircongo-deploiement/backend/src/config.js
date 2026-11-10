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
