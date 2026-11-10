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

// Points de scan par défaut. Les coordonnées sont des positions de DÉMONSTRATION placées près de chaque aéroport :
// l'administrateur les remplace par les coordonnées relevées sur place (page « Carte & points »).
// etape = étape du bagage enregistrée quand on scanne à ce point ; rfid = portique RFID (bagages VIP).
export const POINTS_PAR_DEFAUT = [
  { code: 'FIH-ENR', nom: 'Comptoir d’enregistrement', station: 'FIH', etape: 'ENREGISTRE', lat: -4.3866, lon: 15.4429 },
  { code: 'FIH-TRI', nom: 'Tri bagages et sûreté', station: 'FIH', etape: 'ENREGISTRE', lat: -4.3871, lon: 15.4441, rfid: true },
  { code: 'FIH-CHG', nom: 'Chargement avion', station: 'FIH', etape: 'CHARGE', lat: -4.3849, lon: 15.4463, rfid: true },
  { code: 'FIH-SOU', nom: 'Soute arrivée', station: 'FIH', etape: 'ARRIVE', lat: -4.3853, lon: 15.4458 },
  { code: 'FIH-LIV', nom: 'Tapis de remise', station: 'FIH', etape: 'LIVRE', lat: -4.3861, lon: 15.4433 },
  { code: 'FBM-ENR', nom: 'Comptoir d’enregistrement', station: 'FBM', etape: 'ENREGISTRE', lat: -11.5921, lon: 27.5298 },
  { code: 'FBM-CHG', nom: 'Chargement avion', station: 'FBM', etape: 'CHARGE', lat: -11.5906, lon: 27.5322 },
  { code: 'FBM-SOU', nom: 'Soute arrivée', station: 'FBM', etape: 'ARRIVE', lat: -11.5909, lon: 27.5318 },
  { code: 'FBM-LIV', nom: 'Tapis de remise', station: 'FBM', etape: 'LIVRE', lat: -11.5917, lon: 27.5303 },
  { code: 'GOM-TRA', nom: 'Plateforme de transit', station: 'GOM', etape: 'TRANSIT', lat: -1.6712, lon: 29.2379 },
  { code: 'GOM-SOU', nom: 'Soute arrivée', station: 'GOM', etape: 'ARRIVE', lat: -1.6705, lon: 29.2392 },
  { code: 'GOM-LIV', nom: 'Tapis de remise', station: 'GOM', etape: 'LIVRE', lat: -1.6709, lon: 29.2383 },
];
