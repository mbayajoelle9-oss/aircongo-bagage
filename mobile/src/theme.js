export const C = { bleu: '#0b2a4a', bleu2: '#14508c', vert: '#1a8f5a', rouge: '#c0392b', orange: '#d98a00', gris: '#6b7785', bord: '#dde3ea', fond: '#f3f6f9', blanc: '#fff' };
export const STATUTS = {
  PRE_ENREGISTRE: 'Étiquette émise', ENREGISTRE: 'Enregistré', CHARGE: 'Chargé en soute', TRANSIT: 'En transit', ARRIVE: 'Arrivé', LIVRE: 'Remis au passager',
};
export const ORDRE = ['PRE_ENREGISTRE', 'ENREGISTRE', 'CHARGE', 'TRANSIT', 'ARRIVE', 'LIVRE'];
export const OPERATEURS = [['MPESA', 'M-Pesa'], ['ORANGE', 'Orange Money'], ['AIRTEL', 'Airtel Money'], ['AFRICELL', 'Africell']];
export const heure = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
export const usd = (n) => `${Number(n ?? 0).toFixed(2)} $`;
