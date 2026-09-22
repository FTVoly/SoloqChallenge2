export default async function handler(req, res) {
  // Autoriser les requêtes depuis ton site
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { gameName, tagLine, apiKey, type, value } = req.query;

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
      url = `https://euw1.api.riotgames.com/lol/league/v4/entries/by-summoner/${value}?api_key=${apiKey}`;
    }

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}