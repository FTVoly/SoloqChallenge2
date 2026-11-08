// Synchro automatique côté serveur (appelée toutes les 30 min par GitHub Actions, voir .github/workflows/sync.yml).
// Utilise la clé Riot enregistrée depuis l'Admin (chiffrée dans Firestore). Personne n'a besoin d'avoir le site ouvert.
import { fsAuth, getDoc, patchDoc, listDocs, knownMatches, decryptKey, checkPassword } from './_firestore.js';

export const config = { maxDuration: 60 };

const TIER_VALUES = { IRON: 0, BRONZE: 400, SILVER: 800, GOLD: 1200, PLATINUM: 1600, EMERALD: 2000, DIAMOND: 2400, MASTER: 2800, GRANDMASTER: 2800, CHALLENGER: 2800 };
const RANK_VALUES = { IV: 0, III: 100, II: 200, I: 300 };
const APEX = ['MASTER', 'GRANDMASTER', 'CHALLENGER'];
const MIN_INTERVAL = 10 * 60 * 1000; // pas plus d'une synchro toutes les 10 min (protège la clé Riot)
const BUDGET = 50 * 1000;            // on s'arrête avant la limite de 60 s ; les joueurs restants passent en premier la fois suivante

// Date « 2026-11-15T23:59 » à l'heure de Paris -> timestamp
const parisToMs = (str) => {
  if (!str) return null;
  const asUtc = Date.parse(str + ':00Z');
  if (Number.isNaN(asUtc)) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(asUtc)).map(x => [x.type, x.value]));
  return asUtc - (Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - asUtc);
};

class KeyError extends Error {}
class RateError extends Error {}

export default async function handler(req, res) {
  const t0 = Date.now();
  const force = checkPassword(req.headers['x-admin-password']);
  let headers;
  try { headers = await fsAuth(); } catch (e) { return res.status(500).json({ error: e.message }); }
  const cfg = (await getDoc(headers, 'config/main')) || {};
  if (cfg.finalJson) return res.status(200).json({ skipped: 'challenge clôturé' });
  if (!cfg.riotKeyEnc) return res.status(200).json({ skipped: 'aucune clé Riot enregistrée' });
  if (!force && cfg.lastServerSyncStart && t0 - cfg.lastServerSyncStart < MIN_INTERVAL) return res.status(200).json({ skipped: 'synchro récente' });
  let key;
  try { key = decryptKey(cfg.riotKeyEnc); } catch { return res.status(200).json({ skipped: 'clé illisible, à ré-enregistrer' }); }
  await patchDoc(headers, 'config/main', { lastServerSyncStart: t0 });

  const riot = async (url) => {
    for (let i = 0; i < 3; i++) {
      const r = await fetch(`${url}${url.includes('?') ? '&' : '?'}api_key=${key}`);
      if (r.status === 401 || r.status === 403) throw new KeyError('Clé Riot expirée ou invalide : colle la nouvelle dans l\'Admin');
      if (r.status === 429) {
        const wait = Math.min(Number(r.headers.get('retry-after')) || 10, 15) * 1000;
        if (Date.now() - t0 + wait > BUDGET) throw new RateError('limite Riot');
        await new Promise(s => setTimeout(s, wait));
        continue;
      }
      const j = await r.json();
      if (!r.ok) throw new Error(j?.status?.message || `Riot ${r.status}`);
      return j;
    }
    throw new RateError('limite Riot');
  };

  const start = parisToMs(cfg.challengeStart);
  const players = (await listDocs(headers, 'players')).sort((a, b) => (a.lastServerSync || 0) - (b.lastServerSync || 0));
  const known = await knownMatches(headers);
  let done = 0, newGames = 0, stopped = '';
  const errors = [];

  for (const p of players) {
    if (Date.now() - t0 > BUDGET) { stopped = 'temps écoulé'; break; }
    try {
      const syncStart = Math.floor(Date.now() / 1000);
      const [gameName, tagLine] = String(p.riotId || '').split('#');
      if (!gameName || !tagLine) throw new Error('Riot ID invalide');
      const acc = (p.puuid && p.puuidFor === p.riotId) ? { puuid: p.puuid } : await riot(`https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName.trim())}/${encodeURIComponent(tagLine.trim())}`);
      const sum = await riot(`https://euw1.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${acc.puuid}`);
      const leg = await riot(`https://euw1.api.riotgames.com/lol/league/v4/entries/by-puuid/${acc.puuid}`);
      const solo = Array.isArray(leg) ? leg.find(q => q.queueType === 'RANKED_SOLO_5x5') : null;
      let rank = 'Unranked', rankLabel = 'Unranked', wins = 0, losses = 0, abs = 0;
      if (solo) {
        rank = solo.tier.charAt(0) + solo.tier.slice(1).toLowerCase();
        rankLabel = `${rank}${APEX.includes(solo.tier) ? '' : ' ' + solo.rank} · ${solo.leaguePoints} LP`;
        wins = solo.wins; losses = solo.losses;
        abs = (TIER_VALUES[solo.tier] || 0) + (APEX.includes(solo.tier) ? 0 : (RANK_VALUES[solo.rank] || 0)) + Number(solo.leaguePoints);
      }
      const since = Math.max(p.historySince || 0, Math.floor((start || 0) / 1000));
      const ids = await riot(`https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/${acc.puuid}/ids?queue=420&count=20${since ? `&startTime=${since}` : ''}`);
      const fresh = (Array.isArray(ids) ? ids : []).filter(id => !known.has(`${id}_${p.id}`));
      let complete = true;
      for (const matchId of fresh) {
        if (Date.now() - t0 > BUDGET) { complete = false; break; }
        const m = await riot(`https://europe.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(matchId)}`);
        const info = m.info, me = info.participants.find(x => x.puuid === acc.puuid);
        if (!me) continue;
        await patchDoc(headers, `history/${matchId}_${p.id}`, {
          type: 'match', matchId, playerId: p.id, playerName: p.playerName || '', team: p.team || '',
          gameCreation: info.gameCreation || null,
          timestamp: info.gameEndTimestamp || (info.gameCreation + (info.gameDuration || 0) * 1000),
          duration: info.gameDuration || 0, queueId: info.queueId, win: !!me.win, teamId: me.teamId,
          championName: me.championName, champLevel: me.champLevel, kills: me.kills, deaths: me.deaths, assists: me.assists,
          cs: (me.totalMinionsKilled || 0) + (me.neutralMinionsKilled || 0), vision: me.visionScore || 0, multiKill: me.largestMultiKill || 0,
          items: [0, 1, 2, 3, 4, 5, 6].map(i => me['item' + i] || 0), spells: [me.summoner1Id, me.summoner2Id],
          remake: !!me.gameEndedInEarlySurrender, lpChange: null, lpEstimated: false,
          participants: info.participants.map(x => ({ n: x.riotIdGameName || x.summonerName || '?', c: x.championName, t: x.teamId, me: x.puuid === acc.puuid })),
        });
        known.add(`${matchId}_${p.id}`);
        newGames++;
      }

      // Alerte Discord en cas de changement de palier
      const tier = (l) => String(l || '').split(' · ')[0];
      const hasPrev = p.currentAbsoluteLP !== undefined && p.currentAbsoluteLP !== null;
      if (process.env.DISCORD_WEBHOOK_URL && hasPrev && tier(p.rankLabel) && tier(p.rankLabel) !== 'Unranked' && tier(rankLabel) !== 'Unranked' && tier(p.rankLabel) !== tier(rankLabel)) {
        const up = abs >= p.currentAbsoluteLP;
        await fetch(process.env.DISCORD_WEBHOOK_URL, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ allowed_mentions: { parse: [] }, embeds: [{ title: up ? '📈 Promotion' : '📉 Descente', description: `**${String(p.playerName || '').replace(/[@`*_~|>\\]/g, '')}** ${up ? 'monte' : 'descend'} : **${tier(p.rankLabel)} → ${tier(rankLabel)}**`, color: up ? 0x10b981 : 0xef4444, footer: { text: 'Changement de rang · SoloQ Challenge' }, timestamp: new Date().toISOString() }] }),
        }).catch(() => {});
      }

      const startLP = p.startAbsoluteLP ?? abs;
      await patchDoc(headers, `players/${p.id}`, {
        puuid: acc.puuid, puuidFor: p.riotId, rank, rankLabel, wins, losses,
        profileImg: `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons/${sum.profileIconId}.jpg`,
        startAbsoluteLP: startLP, currentAbsoluteLP: abs, lpDelta: abs - startLP,
        ...(complete ? { historySince: Math.max(p.historySince || 0, syncStart - 7200) } : {}),
        lastServerSync: Date.now(),
      });
      done++;
    } catch (e) {
      if (e instanceof KeyError) { stopped = e.message; break; }
      if (e instanceof RateError) { stopped = 'limite de requêtes Riot, la suite au prochain passage'; break; }
      errors.push(`${p.playerName} : ${e.message}`);
    }
  }

  const keyDead = stopped.startsWith('Clé Riot');
  await patchDoc(headers, 'config/main', {
    lastServerSync: Date.now(),
    syncError: keyDead ? stopped : '',
    syncReport: `${done}/${players.length} joueurs · ${newGames} nouvelle(s) partie(s)${stopped && !keyDead ? ` · ${stopped}` : ''}${errors.length ? ` · ${errors.length} erreur(s) : ${errors.join(' ; ').slice(0, 300)}` : ''}`,
  });
  return res.status(200).json({ ok: !keyDead, done, total: players.length, newGames, stopped, errors });
}
