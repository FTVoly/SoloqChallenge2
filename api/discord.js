// Envoie une alerte Discord à chaque achat de la boutique.
// Le lien du webhook reste secret : il est stocké dans la variable d'environnement Vercel DISCORD_WEBHOOK_URL.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    // Pas encore configuré : on ignore sans erreur pour ne pas gêner l'achat
    return res.status(200).json({ skipped: true });
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  // Nettoyage : longueur limitée et pas de mise en forme/mentions injectées par un pseudo
  const clean = (v) => String(v ?? '').slice(0, 40).replace(/[@`*_~|>\\]/g, '').trim();
  const price = Math.max(0, Math.min(1000, Number(body.price) || 0));
  const buyer = clean(body.buyerName);
  const kind = body.kind;
  const mode = body.mode === 'gain' ? 'gain' : 'drain';

  if (!buyer || !['ban', 'shield', 'double', 'spells', 'lpmove', 'cancel'].includes(kind)) {
    return res.status(400).json({ error: 'Requête invalide' });
  }

  const BONUS = 0x3b82f6; // bleu : bonus pour soi
  const MALUS = 0xef4444; // rouge : malus sur un adversaire
  const label = String(body.label ?? '').slice(0, 80).replace(/[@`*_~|>\\]/g, '').trim();
  let embed;
  if (kind === 'cancel') {
    embed = {
      title: '↩️ Achat annulé',
      description: `L'achat de **${buyer}**${label ? ` (${label})` : ''} a été annulé par l'organisateur. Les points sont remboursés.`,
      color: 0x71717a,
    };
  } else if (kind === 'ban') {
    const target = clean(body.targetName);
    const champion = clean(body.championName);
    if (!target || !champion) return res.status(400).json({ error: 'Requête invalide' });
    embed = {
      title: '🚫 Champion banni',
      description: `**${buyer}** a banni **${champion}** pour **${target}**.\n**${target}** ne peut pas jouer ${champion} à sa prochaine partie.`,
      color: MALUS,
    };
  } else if (kind === 'spells') {
    const target = clean(body.targetName);
    if (!target) return res.status(400).json({ error: 'Requête invalide' });
    embed = {
      title: '🔄 Summoners inversés',
      description: `**${buyer}** inverse les summoners de **${target}**.\n**${target}** doit jouer sa prochaine partie avec ses sorts d'invocateur inversés.`,
      color: MALUS,
    };
  } else if (kind === 'lpmove' && mode === 'drain') {
    const target = clean(body.targetName);
    if (!target) return res.status(400).json({ error: 'Requête invalide' });
    embed = {
      title: '💥 Sabotage',
      description: `**${buyer}** fait perdre **10 LP** à **${target}**.`,
      color: MALUS,
    };
  } else if (kind === 'lpmove') {
    embed = {
      title: '⚡ Coup de pouce',
      description: `**${buyer}** s'offre **+10 LP**.`,
      color: BONUS,
    };
  } else if (kind === 'double') {
    embed = {
      title: '🎲 Quitte ou double',
      description: `**${buyer}** joue quitte ou double : les LP gagnés ou perdus sur sa prochaine partie seront **doublés**.`,
      color: BONUS,
    };
  } else {
    embed = {
      title: '🛡️ Bouclier acheté',
      description: `**${buyer}** a acheté un bouclier : il protège ses points sur sa prochaine partie.`,
      color: BONUS,
    };
  }
  const prefix = body.test === true ? 'TEST · ' : '';
  const isBonus = kind === 'shield' || kind === 'double' || (kind === 'lpmove' && mode === 'gain');
  embed.footer = {
    text: kind === 'cancel'
      ? `${prefix}Remboursé · ${price} pts · SoloQ Challenge`
      : `${prefix}${isBonus ? 'Bonus' : 'Malus'} · ${price} pts · SoloQ Challenge`,
  };
  embed.timestamp = new Date().toISOString();

  try {
    const r = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } }),
    });
    if (!r.ok) return res.status(502).json({ error: `Discord a répondu ${r.status}` });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
