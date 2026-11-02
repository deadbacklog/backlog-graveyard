// Cloudflare Pages Function: erreichbar unter /api?profile=<Steam-Profillink>
// Der Steam-Schlüssel steht als geheime Variable STEAM_API_KEY in Cloudflare und nie im Browser.

const STEAM = 'https://api.steampowered.com';

function json(body, status, cache) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cache ? 'public, max-age=300' : 'no-store',
      'access-control-allow-origin': '*'
    }
  });
}

// Erkennt Profillinks, 17-stellige Steam-IDs und Profilnamen
function parseProfile(input) {
  const s = String(input || '').trim();
  if (!s || s.length > 200) return null;
  let m = s.match(/steamcommunity\.com\/profiles\/(\d{17})/i);
  if (m) return { id: m[1] };
  m = s.match(/steamcommunity\.com\/id\/([A-Za-z0-9_-]{2,64})/i);
  if (m) return { vanity: m[1] };
  if (/^\d{17}$/.test(s)) return { id: s };
  if (/^[A-Za-z0-9_-]{2,64}$/.test(s)) return { vanity: s };
  return null;
}

async function steamGet(path, params, key) {
  const url = new URL(STEAM + path);
  Object.keys(params).forEach(function (k) { url.searchParams.set(k, params[k]); });
  url.searchParams.set('key', key);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error('steam_' + res.status);
  return res.json();
}

export async function onRequestGet(context) {
  const key = context.env && context.env.STEAM_API_KEY;
  if (!key) return json({ error: 'Server is not set up yet (missing Steam key).' }, 500);

  const url = new URL(context.request.url);
  const parsed = parseProfile(url.searchParams.get('profile'));
  if (!parsed) {
    return json({ error: 'That does not look like a Steam profile link. Example: steamcommunity.com/id/yourname' }, 400);
  }

  try {
    let steamid = parsed.id;
    if (!steamid) {
      const r = await steamGet('/ISteamUser/ResolveVanityURL/v1/', { vanityurl: parsed.vanity }, key);
      if (!r.response || r.response.success !== 1) {
        return json({ error: 'Profile not found. Check the link and try again.' }, 404);
      }
      steamid = r.response.steamid;
    }

    const [summary, owned] = await Promise.all([
      steamGet('/ISteamUser/GetPlayerSummaries/v2/', { steamids: steamid }, key),
      steamGet('/IPlayerService/GetOwnedGames/v1/', {
        steamid: steamid, include_appinfo: '1', include_played_free_games: '1'
      }, key)
    ]);

    const player = summary.response && summary.response.players && summary.response.players[0];
    if (!player) return json({ error: 'Profile not found. Check the link and try again.' }, 404);

    const resp = owned.response || {};
    if (resp.game_count === undefined && !resp.games) {
      return json({
        error: 'This profile is private. Set "Game details" to Public in your Steam privacy settings and try again.'
      }, 403);
    }

    const games = (resp.games || []).map(function (g) {
      return { appid: g.appid, name: g.name || ('App ' + g.appid), minutes: g.playtime_forever || 0 };
    });

    return json({
      steamid: steamid,
      name: player.personaname || 'Mysterious Gamer',
      avatar: player.avatarfull || '',
      games: games
    }, 200, true);
  } catch (e) {
    return json({ error: 'Could not reach Steam right now. Try again in a minute.' }, 502);
  }
}
