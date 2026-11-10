// Dépôt MongoDB (Mongoose). Même interface que le dépôt mémoire.
// Les clés métier sont stockées dans le champ `id` (UUID) : on masque _id et __v.
import crypto from 'node:crypto';
import mongoose from 'mongoose';

const { Schema } = mongoose;
const opts = { versionKey: false };
const idChamp = () => ({ type: String, required: true, unique: true });

const schemas = {
  vols: new Schema({ id: idChamp(), numero: String, depart: String, arrivee: String, heureDepart: String }, opts),
  reservations: new Schema(
    { id: idChamp(), pnr: { type: String, required: true, unique: true }, nom: String, classe: String, volId: String, telephone: String },
    opts,
  ),
  bagages: new Schema(
    {
      id: idChamp(),
      code: { type: String, required: true, unique: true },
      reservationId: { type: String, index: true },
      poidsKg: Number,
      poidsReel: Boolean,
      niveau: String,
      creeLe: String,
    },
    opts,
  ),
  scans: new Schema(
    { id: idChamp(), bagageId: { type: String, index: true }, code: String, etape: String, station: String, agent: String, source: String, saut: Boolean, ts: String },
    opts,
  ),
  litiges: new Schema(
    { id: idChamp(), numero: { type: String, unique: true }, bagageId: String, code: String, type: String, description: String, statut: String, creeLe: String },
    opts,
  ),
  utilisateurs: new Schema(
    {
      id: idChamp(),
      email: { type: String, required: true, unique: true },
      nom: String,
      role: String,
      station: String,
      actif: Boolean,
      hash: String,
      creeLe: String,
      derniereConnexion: String,
    },
    opts,
  ),
  paiements: new Schema(
    { id: idChamp(), reservationId: { type: String, index: true }, kg: Number, montantUsd: Number, canal: String, ts: String },
    opts,
  ),
};

const nettoyer = (doc) => {
  if (!doc) return null;
  const { _id, __v, ...reste } = doc;
  return reste;
};

export class MongoRepo {
  constructor() {
    this.m = {};
    for (const [nom, schema] of Object.entries(schemas)) {
      this.m[nom] = mongoose.models[nom] || mongoose.model(nom, schema, nom);
    }
  }
  newId() {
    return crypto.randomUUID();
  }
  async insert(nom, doc) {
    const cree = await this.m[nom].create({ id: this.newId(), ...doc });
    return nettoyer(cree.toObject());
  }
  async find(nom, filtre = {}) {
    return (await this.m[nom].find(filtre).lean()).map(nettoyer);
  }
  async findOne(nom, filtre) {
    return nettoyer(await this.m[nom].findOne(filtre).lean());
  }
  async update(nom, id, patch) {
    return nettoyer(await this.m[nom].findOneAndUpdate({ id }, { $set: patch }, { new: true }).lean());
  }
  async count(nom, filtre = {}) {
    return this.m[nom].countDocuments(filtre);
  }
  async reset(collections) {
    const noms = collections ?? Object.keys(this.m);
    await Promise.all(noms.map((nom) => this.m[nom].deleteMany({})));
  }
  async creerIndex() {
    await Promise.all(Object.values(this.m).map((model) => model.init()));
  }
}

export async function connecterMongo(uri) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  const repo = new MongoRepo();
  await repo.creerIndex();
  return repo;
}
