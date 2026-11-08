// Enregistre la clé Riot (valable 24 h) pour la synchro automatique côté serveur. Réservé à l'organisateur.
import { fsAuth, patchDoc, encryptKey, checkPassword } from './_firestore.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  if (!checkPassword(body.password)) { await new Promise(r => setTimeout(r, 800)); return res.status(401).json({ error: 'Mot de passe incorrect' }); }
  const key = String(body.key || '').trim();
  if (!/^RGAPI-[0-9a-f-]{20,}$/i.test(key)) return res.status(400).json({ error: 'Format de clé invalide (RGAPI-…)' });
  // Vérifie que Riot accepte la clé
  const t = await fetch(`https://euw1.api.riotgames.com/lol/status/v4/platform-data?api_key=${key}`);
  if (t.status === 401 || t.status === 403) return res.status(400).json({ error: 'Riot refuse cette clé (expirée ou invalide)' });
  try {
    const headers = await fsAuth();
    await patchDoc(headers, 'config/main', { riotKeyEnc: encryptKey(key), riotKeySavedAt: Date.now(), syncError: '' });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
