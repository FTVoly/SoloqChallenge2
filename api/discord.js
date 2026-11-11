// Envoie une alerte Discord à chaque achat de la boutique.
// Le lien du webhook reste secret : il est stocké dans la variable d'environnement Vercel DISCORD_WEBHOOK_URL.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const isFinal = (typeof req.body === 'string' ? safeParse(req.body) : (req.body || {})).kind === 'final';
  // L'annonce du vainqueur va dans le channel des récaps
  const webhookUrl = isFinal ? process.env.DISCORD_RECAP_WEBHOOK_URL : process.env.DISCORD_WEBHOOK_URL;
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

  if (kind === 'final') {
    const c = (v) => String(v ?? '').slice(0, 40).replace(/[@`*_~|>\\]/g, '').trim();
    const lp = (v) => { const n = Math.round(Number(v) || 0); return `${n > 0 ? '+' : ''}${n} LP`; };
    const top = (Array.isArray(body.top) ? body.top : []).slice(0, 5);
    if (!top.length) return res.status(400).json({ error: 'Requête invalide' });
    const medals = ['🥇', '🥈', '🥉', '4.', '5.'];
    const t = body.teams || {};
    const r = Number(t.rouge) || 0, b = Number(t.bleu) || 0;
    const teamLine = r === b ? 'Égalité parfaite entre les deux équipes !' : `Équipe gagnante : **${r > b ? 'Rouge' : 'Bleue'}** (${lp(Math.max(r, b))} contre ${lp(Math.min(r, b))})`;
    const embed = {
      title: '🏆 Le SoloQ Challenge est terminé !',
      description: `Le grand vainqueur est **${c(top[0].name)}** avec **${lp(top[0].lp)}** ! 🎉\n\n${top.map((x, i) => `${medals[i]} **${c(x.name)}** · ${lp(x.lp)}`).join('\n')}\n\n${teamLine}`,
      color: 0xf59e0b,
      footer: { text: 'Classement final · SoloQ Challenge' },
      timestamp: new Date().toISOString(),
    };
    try {
      const rr = await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } }) });
      if (!rr.ok) return res.status(502).json({ error: `Discord a répondu ${rr.status}` });
      return res.status(200).json({ ok: true });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  if (!buyer || !['ban', 'shield', 'double', 'spells', 'lpmove', 'cancel', 'violation', 'jackpot', 'rank', 'bet', 'betresult'].includes(kind)) {
    return res.status(400).json({ error: 'Requête invalide' });
  }

  const BONUS = 0x3b82f6; // bleu : bonus pour soi
  const MALUS = 0xef4444; // rouge : malus sur un adversaire
  const label = String(body.label ?? '').slice(0, 80).replace(/[@`*_~|>\\]/g, '').trim();
  let embed;
  if (kind === 'bet' || kind === 'betresult') {
    const team = (t) => t === 'rouge' ? '🔴 Rouge' : t === 'bleu' ? '🔵 Bleue' : '';
    const test = body.test === true ? 'TEST · ' : '';
    embed = kind === 'bet' ? {
      title: '🎰 Pari sur le showmatch',
      description: `**${buyer}** mise **${price} pts** sur l'équipe **${team(label)}** (cote ${clean(body.mode)}).`,
      color: 0xf59e0b,
      footer: { text: `${test}Paris · SoloQ Challenge` },
    } : label === 'void' ? {
      title: '🏁 Showmatch annulé',
      description: `**${buyer}** est annulé : les **${price}** mise(s) sont remboursées.`,
      color: 0x71717a,
      footer: { text: 'Paris · SoloQ Challenge' },
    } : {
      title: '🏁 Résultat du showmatch',
      description: `**${team(label)}** remporte **${buyer}** !\n${price} pari(s) · **${clean(body.mode)}** gagnant(s) : gains crédités.`,
      color: label === 'rouge' ? 0xef4444 : 0x3b82f6,
      footer: { text: 'Paris · SoloQ Challenge' },
    };
    embed.timestamp = new Date().toISOString();
    try {
      const r = await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } }) });
      return r.ok ? res.status(200).json({ ok: true }) : res.status(502).json({ error: `Discord a répondu ${r.status}` });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }
  if (kind === 'rank') {
    const up = body.mode === 'up';
    embed = {
      title: up ? '📈 Promotion' : '📉 Descente',
      description: `**${buyer}** ${up ? 'monte' : 'descend'} : **${label}**`,
      color: up ? 0x10b981 : 0xef4444,
      footer: { text: 'Changement de rang · SoloQ Challenge' },
    };
  } else if (kind === 'violation') {
    const by = clean(body.targetName);
    const what = String(body.label ?? '').slice(0, 80).replace(/[@`*_~|>\\]/g, '').trim();
    const lp = Math.max(0, Math.min(100, Number(body.price) || 0));
    embed = {
      title: '⚠️ Malus non respecté',
      description: body.mode === 'ban'
        ? `**${buyer}** a joué **${what}**, banni par **${by}**. Pénalité : **−${lp} LP**${body.win === true ? ' et les LP gagnés sur la partie sont annulés' : ''}.`
        : `**${buyer}** n'a pas inversé ses summoners (demandé par **${by}**). Pénalité : **−${lp} LP**${body.win === true ? ' et les LP gagnés sur la partie sont annulés' : ''}.`,
      color: MALUS,
      footer: { text: `Pénalité · −${lp} LP · SoloQ Challenge` },
    };
  } else if (kind === 'cancel') {
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
  } else if (kind === 'jackpot') {
    embed = {
      title: '👑 BONUS ULTIME ACHETÉ',
      description: `**${buyer}** vient d'acheter le **bonus ultime**, le seul du tournoi !\nÀ la prochaine partie de chaque joueur, il récupère **25 %** des LP perdus. Si tout le monde gagne : **+30 LP** pour lui.`,
      color: 0xf59e0b,
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
      description: `**${buyer}** a acheté un bouclier : si sa prochaine partie est perdue, les LP perdus ne comptent pas.`,
      color: BONUS,
    };
  }
  const prefix = body.test === true ? 'TEST · ' : '';
  const isBonus = kind === 'shield' || kind === 'double' || kind === 'jackpot' || (kind === 'lpmove' && mode === 'gain');
  embed.footer = (kind === 'violation' || kind === 'rank') ? embed.footer : {
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
