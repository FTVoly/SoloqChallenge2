// Accès Firestore côté serveur (API REST, connexion anonyme comme le site) + chiffrement de la clé Riot.
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'crypto';

const FIREBASE_KEY = 'AIzaSyBwNrlXY81VOXtp2EGyFb_k3OWHKbtcY2o';
const PROJECT = 'soloq-challenge-5a13b';
export const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

export async function fsAuth() {
  const auth = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }),
  }).then(r => r.json());
  if (!auth.idToken) throw new Error('Connexion Firebase impossible');
  return { Authorization: `Bearer ${auth.idToken}`, 'Content-Type': 'application/json' };
}

// Conversion valeur JS <-> format Firestore REST
export const toFs = (v) => {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toFs(x)])) } };
};
export const fromFs = (f) => {
  if (!f) return undefined;
  if ('stringValue' in f) return f.stringValue;
  if ('integerValue' in f) return Number(f.integerValue);
  if ('doubleValue' in f) return f.doubleValue;
  if ('booleanValue' in f) return f.booleanValue;
  if ('nullValue' in f) return null;
  if ('timestampValue' in f) return Date.parse(f.timestampValue);
  if ('arrayValue' in f) return (f.arrayValue.values || []).map(fromFs);
  if ('mapValue' in f) return Object.fromEntries(Object.entries(f.mapValue.fields || {}).map(([k, x]) => [k, fromFs(x)]));
  return undefined;
};
export const plain = (doc) => Object.fromEntries(Object.entries(doc.fields || {}).map(([k, v]) => [k, fromFs(v)]));

export async function getDoc(headers, path) {
  const r = await fetch(`${BASE}/${path}`, { headers });
  if (r.status === 404) return null;
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || `Firestore ${r.status}`);
  return plain(j);
}
// Écrit seulement les champs donnés (merge)
export async function patchDoc(headers, path, data) {
  const mask = Object.keys(data).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  const r = await fetch(`${BASE}/${path}?${mask}`, {
    method: 'PATCH', headers, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, toFs(v)])) }),
  });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j?.error?.message || `Firestore ${r.status}`); }
}
export async function listDocs(headers, collection) {
  const out = [];
  let token = '';
  do {
    const j = await fetch(`${BASE}/${collection}?pageSize=300${token ? `&pageToken=${token}` : ''}`, { headers }).then(r => r.json());
    (j.documents || []).forEach(d => out.push({ id: d.name.split('/').pop(), ...plain(d) }));
    token = j.nextPageToken || '';
  } while (token);
  return out;
}
// Identifiants des parties déjà enregistrées (sans télécharger tout l'historique)
export async function knownMatches(headers) {
  const r = await fetch(`${BASE}:runQuery`, {
    method: 'POST', headers,
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'history' }], where: { fieldFilter: { field: { fieldPath: 'type' }, op: 'EQUAL', value: { stringValue: 'match' } } }, select: { fields: [{ fieldPath: 'matchId' }, { fieldPath: 'playerId' }] } } }),
  }).then(r => r.json());
  return new Set((Array.isArray(r) ? r : []).filter(x => x.document).map(x => { const d = plain(x.document); return `${d.matchId}_${d.playerId}`; }));
}

// Clé Riot chiffrée (AES-256-GCM) avec une clé dérivée du mot de passe admin : elle n'est jamais lisible depuis la base
const secretKey = () => createHash('sha256').update(`soloq-riot-key:${process.env.ADMIN_PASSWORD || ''}`).digest();
export const encryptKey = (text) => {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', secretKey(), iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map(b => b.toString('base64')).join('.');
};
export const decryptKey = (blob) => {
  const [iv, tag, enc] = String(blob || '').split('.').map(x => Buffer.from(x, 'base64'));
  const d = createDecipheriv('aes-256-gcm', secretKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
};
export const checkPassword = (given) => {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  const a = Buffer.from(String(given ?? '').slice(0, 200)), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};
