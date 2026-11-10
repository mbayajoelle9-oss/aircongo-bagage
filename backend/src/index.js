import 'dotenv/config';
import { connecterMongo } from './repo.mongo.js';
import { creerApp } from './app.js';
import { chargerDemo } from './logic.js';

const { MONGODB_URI, AGENT_KEY, ADMIN_KEY, FRONTEND_URL, SEED_DEMO } = process.env;
const production = process.env.NODE_ENV === 'production';
const seed = SEED_DEMO === 'true';

if (!MONGODB_URI) {
  console.error('MONGODB_URI manquant (chaîne de connexion MongoDB Atlas).');
  process.exit(1);
}
if (!AGENT_KEY || !ADMIN_KEY || AGENT_KEY === ADMIN_KEY) {
  console.error('AGENT_KEY et ADMIN_KEY sont obligatoires et doivent être différentes.');
  process.exit(1);
}
if (production && (AGENT_KEY.length < 12 || ADMIN_KEY.length < 12)) {
  console.error('En production, les clés doivent faire au moins 12 caractères.');
  process.exit(1);
}

const repo = await connecterMongo(MONGODB_URI);
if (seed && (await repo.count('reservations')) === 0) {
  await chargerDemo(repo);
  console.log('Données de démonstration chargées.');
}

const app = creerApp(repo, {
  agentKey: AGENT_KEY,
  adminKey: ADMIN_KEY,
  frontendUrl: FRONTEND_URL,
  demoResetAutorise: seed,
});
const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`API Air Congo prête sur le port ${port}`));
