// Vérifie le mot de passe organisateur côté serveur : il n'apparaît plus dans le code de la page.
// Le mot de passe est stocké dans la variable d'environnement Vercel ADMIN_PASSWORD.
import { timingSafeEqual } from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return res.status(503).json({ error: 'Mot de passe non configuré' });

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const given = Buffer.from(String(body.password ?? '').slice(0, 200));
  const wanted = Buffer.from(expected);
  const ok = given.length === wanted.length && timingSafeEqual(given, wanted);
  if (!ok) {
    await new Promise(r => setTimeout(r, 800)); // ralentit les essais en rafale
    return res.status(401).json({ ok: false });
  }
  return res.status(200).json({ ok: true });
}

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }
