export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { gameName, tagLine, apiKey, type, value, queue, count, startTime } = req.query;

  if (!apiKey) {
    return res.status(400).json({ error: 'Clé API manquante' });
  }

  try {
    let url = '';
    if (type === 'account') {
      url = `https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}?api_key=${apiKey}`;
    } else if (type === 'summoner') {
      url = `https://euw1.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${value}?api_key=${apiKey}`;
    } else if (type === 'league') {
      // Utilisation du PUUID directement (nouvelle méthode Riot)
      url = `https://euw1.api.riotgames.com/lol/league/v4/entries/by-puuid/${value}?api_key=${apiKey}`;
    } else if (type === 'matchids') {
      // Liste des IDs de parties (Match-v5), filtrable par file (420 = SoloQ) et par date de début
      const params = new URLSearchParams({ api_key: apiKey, count: String(Math.min(Number(count) || 5, 20)) });
      if (queue) params.set('queue', String(queue));
      if (startTime) params.set('startTime', String(startTime));
      url = `https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/${value}/ids?${params.toString()}`;
    } else if (type === 'match') {
      // Détail complet d'une partie (Match-v5)
      url = `https://europe.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(value)}?api_key=${apiKey}`;
    } else {
      return res.status(400).json({ error: 'Type de requête inconnu' });
    }

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      const retryAfter = response.headers.get('retry-after');
      if (retryAfter) res.setHeader('Retry-After', retryAfter);
      return res.status(response.status).json(data);
    }

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
