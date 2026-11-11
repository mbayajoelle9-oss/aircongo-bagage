import 'dotenv/config';
import { connecterMongo } from './repo.mongo.js';
import { creerApp } from './app.js';
import { chargerDemo, peuplerPoints } from './logic.js';
import { creerUtilisateur } from './utilisateurs.js';
import { creerFournisseur, synchroniserVols } from './vols.js';

const { MONGODB_URI, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME, FRONTEND_URL, SEED_DEMO } = process.env;
const seed = SEED_DEMO === 'true';

const manquantes = ['MONGODB_URI', 'JWT_SECRET', 'ADMIN_EMAIL', 'ADMIN_PASSWORD'].filter((k) => !process.env[k]);
if (manquantes.length) {
  console.error('Variables manquantes : ' + manquantes.join(', '));
  process.exit(1);
}
if (JWT_SECRET.length < 32) {
  console.error('JWT_SECRET doit faire au moins 32 caractères (chaîne aléatoire).');
  process.exit(1);
}
if (ADMIN_PASSWORD.length < 10) {
  console.error('ADMIN_PASSWORD doit faire au moins 10 caractères.');
  process.exit(1);
}

const repo = await connecterMongo(MONGODB_URI);

await peuplerPoints(repo); // points de scan par défaut, créés une seule fois (la base existante est conservée)

// Premier démarrage : création du compte administrateur à partir des variables d'environnement.
if ((await repo.count('utilisateurs')) === 0) {
  await creerUtilisateur(repo, {
    nom: ADMIN_NAME || 'Administrateur',
    email: ADMIN_EMAIL,
    motDePasse: ADMIN_PASSWORD,
    role: 'ADMIN',
  });
  console.log('Compte administrateur créé : ' + ADMIN_EMAIL.toLowerCase());
}
if (seed && (await repo.count('reservations')) === 0) {
  await chargerDemo(repo);
  console.log('Données de démonstration chargées.');
}

const cleLecteurRfid = (process.env.RFID_READER_KEY || '').length >= 24 ? process.env.RFID_READER_KEY : null;
console.log(cleLecteurRfid ? 'Lecteurs RFID : activés' : 'Lecteurs RFID : désactivés (RFID_READER_KEY absente ou trop courte, 24 caractères minimum)');
const fournisseurVols = creerFournisseur();
console.log(fournisseurVols ? `Vols automatiques : ${fournisseurVols.nom}` : 'Vols automatiques : désactivés (FLIGHT_API_KEY absente)');
// Actualisation périodique facultative (attention au quota du forfait : 100 requêtes/mois en gratuit).
const minutes = Number(process.env.FLIGHT_SYNC_MINUTES) || 0;
if (fournisseurVols && minutes >= 10) {
  setInterval(() => synchroniserVols(repo, fournisseurVols).catch((e) => console.error('Synchro vols :', e.message)), minutes * 60000).unref();
}

const app = creerApp(repo, { jwtSecret: JWT_SECRET, frontendUrl: FRONTEND_URL, demoResetAutorise: seed, fournisseurVols, cleLecteurRfid });
const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`API Air Congo prête sur le port ${port}`));
