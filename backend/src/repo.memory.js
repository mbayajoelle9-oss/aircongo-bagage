// Dépôt en mémoire : utilisé par les tests (aucune base requise).
import crypto from 'node:crypto';

const correspond = (doc, filtre) =>
  Object.entries(filtre).every(([k, v]) =>
    v && typeof v === 'object' && '$in' in v ? v.$in.includes(doc[k]) : doc[k] === v,
  );

export class MemoryRepo {
  constructor() {
    this.d = {};
  }
  newId() {
    return crypto.randomUUID();
  }
  coll(nom) {
    return (this.d[nom] ??= []);
  }
  async insert(nom, doc) {
    const d = { id: this.newId(), ...doc };
    this.coll(nom).push(d);
    return structuredClone(d);
  }
  async find(nom, filtre = {}) {
    return this.coll(nom).filter((x) => correspond(x, filtre)).map((x) => structuredClone(x));
  }
  async findOne(nom, filtre) {
    return (await this.find(nom, filtre))[0] ?? null;
  }
  async update(nom, id, patch) {
    const d = this.coll(nom).find((x) => x.id === id);
    if (!d) return null;
    Object.assign(d, patch);
    return structuredClone(d);
  }
  async count(nom, filtre = {}) {
    return (await this.find(nom, filtre)).length;
  }
  async reset() {
    this.d = {};
  }
}
