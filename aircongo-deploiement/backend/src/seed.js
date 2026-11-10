// Recharge les données de démonstration dans la base : npm run seed
import 'dotenv/config';
import mongoose from 'mongoose';
import { connecterMongo } from './repo.mongo.js';
import { chargerDemo } from './logic.js';

if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI manquant.');
  process.exit(1);
}
const repo = await connecterMongo(process.env.MONGODB_URI);
await chargerDemo(repo);
console.log('Données de démonstration chargées : ACG123 / Mbemba, ACV777 / Kabila (VIP), ACB456 / Tshimanga');
await mongoose.disconnect();
