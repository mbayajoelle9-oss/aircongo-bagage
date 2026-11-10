// Authentification sans dépendance externe : mots de passe hachés avec scrypt,
// jetons signés HMAC-SHA256 (format compact « charge.signature »).
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

export async function hasherMotDePasse(motDePasse) {
  const sel = crypto.randomBytes(16);
  const h = await scrypt(motDePasse, sel, 64);
  return `${sel.toString('hex')}:${h.toString('hex')}`;
}

export async function verifierMotDePasse(motDePasse, stocke) {
  const [sel, h] = String(stocke ?? '').split(':');
  if (!sel || !h) return false;
  const calcule = await scrypt(String(motDePasse ?? ''), Buffer.from(sel, 'hex'), 64);
  const attendu = Buffer.from(h, 'hex');
  return calcule.length === attendu.length && crypto.timingSafeEqual(calcule, attendu);
}

const signature = (corps, secret) => crypto.createHmac('sha256', secret).update(corps).digest('base64url');

export function signerJeton(charge, secret, dureeSecondes = 12 * 3600) {
  const corps = Buffer.from(JSON.stringify({ ...charge, exp: Math.floor(Date.now() / 1000) + dureeSecondes })).toString('base64url');
  return `${corps}.${signature(corps, secret)}`;
}

export function verifierJeton(jeton, secret) {
  const [corps, sig] = String(jeton ?? '').split('.');
  if (!corps || !sig) return null;
  const attendu = Buffer.from(signature(corps, secret));
  const recu = Buffer.from(sig);
  if (attendu.length !== recu.length || !crypto.timingSafeEqual(attendu, recu)) return null;
  try {
    const charge = JSON.parse(Buffer.from(corps, 'base64url').toString('utf8'));
    return charge.exp > Math.floor(Date.now() / 1000) ? charge : null;
  } catch {
    return null;
  }
}
