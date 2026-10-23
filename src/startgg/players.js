import { MISS_CACHE_MS, aliases, lookupMany, miss, missedCache, query } from './queue.js';

// a start.gg user and their player the way the track list and commands keep them
function account(user, player) {
  return {
    userId: user.id,
    slug: user.slug,
    playerId: player.id,
    tag: player.gamerTag,
    image: user.images?.[0]?.url,
    discordId: user.authorizations?.[0]?.externalId,
  };
}

// a set only has the player id, so a button about someone from a set looks them up by it.
// null when there's no start.gg account behind them, which TOs can add people without
export async function getPlayerById(id) {
  const { player } = await query(`
    query ($id: ID!) {
      player(id: $id) {
        id
        gamerTag
        user { id slug images(type: "profile") { url } authorizations(types: [DISCORD]) { externalId } }
      }
    }
  `, { id });
  return player?.user ? account(player.user, player) : null;
}

// id is f64a83c8 or user/f64a83c8
export async function getPlayer(id) {
  const slug = id.startsWith('user/') ? id : `user/${id}`;
  const missed = missedCache.get(`player:${slug}`);
  if (missed && Date.now() - missed < MISS_CACHE_MS) return null;
  const { user } = await query(`
    query ($slug: String) {
      user(slug: $slug) {
        id
        slug
        images(type: "profile") { url }
        player { id gamerTag }
        authorizations(types: [DISCORD]) { externalId }
      }
    }
  `, { slug });

  if (!user?.player) {
    miss(`player:${slug}`);
    return null;
  }
  return account(user, user.player);
}

// [userId, { slug, tag, image, discordId }] for each of them, null if they're gone from start.gg
export async function getProfiles(userIds) {
  const data = await lookupMany(userIds, (group) => `{
    ${aliases(group, 'u', 'user', 'slug images(type: "profile") { url } player { gamerTag } authorizations(types: [DISCORD]) { externalId }')}
  }`);

  return userIds.map((userId) => {
    const user = data[`u${userId}`];
    if (!user?.player) return [userId, null];
    const { slug, tag, image, discordId } = account(user, user.player);
    return [userId, { slug, tag, image, discordId }];
  });
}

// for /slippi: Map of playerId to the slippi connect code on their newest online singles sets. netplay
// tournaments ask for it at registration and start.gg keeps it on the participant, so offline players
// and ones who only play online in other games have none. a set here is about 9 objects, so 8 sets
// each for 10 players stays under the limit
export async function getConnectCodes(playerIds) {
  const sets = 'sets(perPage: 8, page: 1, filters: { state: [3], isEventOnline: true, entrantSize: [1] }) '
    + '{ nodes { slots { entrant { participants { player { id } connectedAccounts } } } } }';
  const data = await lookupMany(playerIds, (group) => `{ ${aliases(group, 'p', 'player', sets)} }`, undefined, 10);

  const codes = new Map();
  for (const playerId of playerIds) {
    for (const set of data[`p${playerId}`]?.sets?.nodes ?? []) {
      const participants = set.slots?.flatMap((slot) => slot.entrant?.participants ?? []) ?? [];
      const mine = participants.find((participant) => String(participant.player?.id) === String(playerId));
      const code = mine?.connectedAccounts?.slippi?.value;
      if (code) {
        codes.set(playerId, code);
        break;
      }
    }
  }
  return codes;
}
