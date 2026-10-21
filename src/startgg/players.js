import { MISS_CACHE_MS, cleanId, lookupMany, miss, missedCache, query } from './queue.js';

// id is f64a83c8 or user/f64a83c8
// a set only has the player id, so a button about someone from a set looks them up by it.
// null when there's no start.gg account behind them, which TOs can add people without
export async function getPlayerById(id) {
  const data = await query(`
    query ($id: ID!) {
      player(id: $id) {
        id
        gamerTag
        user { id slug images(type: "profile") { url } authorizations(types: [DISCORD]) { externalId } }
      }
    }
  `, { id });

  const { player } = data;
  if (!player?.user) return null;

  return {
    userId: player.user.id,
    slug: player.user.slug,
    playerId: player.id,
    tag: player.gamerTag,
    image: player.user.images?.[0]?.url,
    discordId: player.user.authorizations?.[0]?.externalId,
  };
}

export async function getPlayer(id) {
  const slug = id.startsWith('user/') ? id : `user/${id}`;
  const missed = missedCache.get(`player:${slug}`);
  if (missed && Date.now() - missed < MISS_CACHE_MS) return null;
  const data = await query(`
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

  const user = data.user;
  if (!user?.player) {
    miss(`player:${slug}`);
    return null;
  }

  return {
    userId: user.id,
    slug: user.slug,
    playerId: user.player.id,
    tag: user.player.gamerTag,
    image: user.images?.[0]?.url,
    discordId: user.authorizations?.[0]?.externalId,
  };
}

// [userId, { slug, tag, image, discordId }] for each of them, null if they're gone from start.gg
export async function getProfiles(userIds) {
  const data = await lookupMany(userIds, (group) => `{
    ${group.map((id) => `u${cleanId(id)}: user(id: ${cleanId(id)}) { slug images(type: "profile") { url } player { gamerTag } authorizations(types: [DISCORD]) { externalId } }`).join('\n')}
  }`);

  return userIds.map((userId) => {
    const user = data[`u${userId}`];
    return [userId, user?.player ? { slug: user.slug, tag: user.player.gamerTag, image: user.images?.[0]?.url, discordId: user.authorizations?.[0]?.externalId } : null];
  });
}

// for /slippi: Map of playerId to the slippi connect code on their newest online singles sets. netplay
// tournaments ask for it at registration and start.gg keeps it on the participant, so offline players
// and ones who only play online in other games have none. a set here is about 9 objects, so 8 sets
// each for 10 players stays under the limit
export async function getConnectCodes(playerIds) {
  const data = await lookupMany(playerIds, (group) => `{
    ${group.map((id) => `p${cleanId(id)}: player(id: ${cleanId(id)}) { sets(perPage: 8, page: 1, filters: { state: [3], isEventOnline: true, entrantSize: [1] }) { nodes { slots { entrant { participants { player { id } connectedAccounts } } } } } }`).join('\n')}
  }`, undefined, 10);

  const codes = new Map();
  for (const playerId of playerIds) {
    for (const set of data[`p${playerId}`]?.sets?.nodes ?? []) {
      const mine = set.slots?.flatMap((slot) => slot.entrant?.participants ?? []).find((participant) => String(participant.player?.id) === String(playerId));
      const code = mine?.connectedAccounts?.slippi?.value;
      if (code) {
        codes.set(playerId, code);
        break;
      }
    }
  }
  return codes;
}
