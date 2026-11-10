import 'dotenv/config';
import { connecterMongo } from './repo.mongo.js';
import { creerApp } from './app.js';
import { chargerDemo } from './logic.js';
import { creerUtilisateur } from './utilisateurs.js';

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

const app = creerApp(repo, { jwtSecret: JWT_SECRET, frontendUrl: FRONTEND_URL, demoResetAutorise: seed });
const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`API Air Congo prête sur le port ${port}`));
