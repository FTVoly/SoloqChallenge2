// Récap quotidien envoyé sur Discord (tâche planifiée Vercel, voir vercel.json).
// Lit les joueurs dans Firestore via l'API REST (connexion anonyme, comme le site) et poste le classement.
const FIREBASE_KEY = 'AIzaSyBwNrlXY81VOXtp2EGyFb_k3OWHKbtcY2o';
const PROJECT = 'soloq-challenge-5a13b';

const val = (f) => {
  if (!f) return undefined;
  if ('stringValue' in f) return f.stringValue;
  if ('integerValue' in f) return Number(f.integerValue);
  if ('doubleValue' in f) return f.doubleValue;
  if ('booleanValue' in f) return f.booleanValue;
  return undefined;
};
const plain = (doc) => Object.fromEntries(Object.entries(doc.fields || {}).map(([k, v]) => [k, val(v)]));
const fmt = (n) => (n > 0 ? `+${n}` : `${n}`);

// Construit les embeds du récap (fonction pure, testable)
export function buildRecap(players, duels) {
  const sorted = [...players].sort((a, b) => (b.lpDelta || 0) - (a.lpDelta || 0));
  const tot = { rouge: 0, bleu: 0 };
  players.forEach(p => { if (tot[p.team] !== undefined) tot[p.team] += Number(p.lpDelta) || 0; });
  const leader = tot.rouge === tot.bleu ? 'Égalité parfaite' : (tot.rouge > tot.bleu ? '🔴 Équipe Rouge devant' : '🔵 Équipe Bleue devant');
  const medal = ['🥇', '🥈', '🥉'];
  const top = sorted.slice(0, 5).map((p, i) => `${medal[i] || `**${i + 1}.**`} **${p.playerName}** · ${fmt(p.lpDelta || 0)} LP · ${p.rankLabel || 'Unranked'}`).join('\n');
  const fields = [{ name: 'Équipes', value: `🔴 Rouge **${fmt(tot.rouge)} LP**\n🔵 Bleue **${fmt(tot.bleu)} LP**\n${leader}`, inline: false }];
  if (top) fields.push({ name: 'Top 5', value: top, inline: false });
  const by = Object.fromEntries(players.map(p => [p.id, p]));
  const open = (duels || []).filter(d => !d.closed && by[d.a] && by[d.b]).slice(0, 6);
  if (open.length) {
    fields.push({
      name: 'Duels en cours',
      value: open.map(d => {
        const la = by[d.a].lpDelta || 0, lb = by[d.b].lpDelta || 0;
        const who = la === lb ? 'égalité' : `${la > lb ? by[d.a].playerName : by[d.b].playerName} devant de ${Math.abs(la - lb)} LP`;
        return `⚔️ **${by[d.a].playerName}** vs **${by[d.b].playerName}** : ${who}`;
      }).join('\n'),
      inline: false,
    });
  }
  return [{ title: '📊 Récap du jour · SoloQ Challenge', color: 0x71717a, fields, footer: { text: 'LP Riot (hors bonus et malus de la boutique)' }, timestamp: new Date().toISOString() }];
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Non autorisé' });
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) return res.status(200).json({ skipped: true });

  try {
    const auth = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }),
    }).then(r => r.json());
    if (!auth.idToken) throw new Error('Connexion Firebase impossible');
    const headers = { Authorization: `Bearer ${auth.idToken}` };
    const base = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

    const pj = await fetch(`${base}/players?pageSize=300`, { headers }).then(r => r.json());
    const players = (pj.documents || []).map(d => ({ id: d.name.split('/').pop(), ...plain(d) }));
    const cfg = await fetch(`${base}/config/main`, { headers }).then(r => r.json());
    let duels = [];
    try { duels = JSON.parse(plain(cfg).duelsJson || '[]'); } catch {}
    if (!players.length) return res.status(200).json({ skipped: 'aucun joueur' });

    const r = await fetch(webhook, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: buildRecap(players, duels), allowed_mentions: { parse: [] } }),
    });
    if (!r.ok) throw new Error(`Discord a répondu ${r.status}`);
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
