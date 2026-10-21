import { hostname } from 'node:os';
import { HTTPError, MessageFlags, RESTJSONErrorCodes } from 'discord.js';
import * as startgg from '../startgg.js';
import * as embeds from '../embeds/index.js';
import { state } from '../store.js';
import { deployedAt, health } from '../tracker.js';
import { funCommands, post } from '../fun/index.js';
import { verifiedCaller } from '../accounts.js';
import { trackAdd, trackRemove, trackCleanup, link, unlink, profile, upcoming, recent, run } from './players.js';
import { progress, scout, headToHead, stats, doubles, characters, predict, predictExplained, memberHeadToHead, memberScout, reports, NOT_LINKED } from './stats.js';
import { bracket, streamLink, registered, regWarn, tournamentChoices } from './registration.js';
import { tournamentAdd, tournamentRemove, tournamentPosts, tournamentEvent } from './tournaments.js';
import { toAdd, toSet, toRemove, toList } from './to.js';
import { configureMessages, socialsAdd, socialsRemove, trackPosts, notify } from './settings.js';
import { slippiAdd, slippiRemove, slippiRank, slippiLeaderboard, slippiChoices } from './slippi.js';
import { matchmakingRole, matchmakingSearch, matchmakingChannel } from './matchmaking.js';
import { pickable, sendEmbeds, readButton, parseSince, playerBySlug, replyEphemeralAfterDefer, recentPicks, nameMatches, failureMessage, flag } from './shared.js';
import { handleChoice, isChoice } from './confirm.js';

import { MEMBER_H2H, MEMBER_SCOUT } from './definitions.js';

export { commands } from './definitions.js';

// these change what gets posted, so only tracked players can be picked. the rest are lookups, where linked people can be too
const TRACKED_ONLY = ['track remove', 'track posts', 'notify'];
// all means everyone tracked
const TAKES_ALL = ['upcoming', 'recent', 'track posts', 'notify'];
// a tournament link, or one the bot already knows. new is the ones /t-o tournament add can still track, tracked the ones it does,
// event is every tracked one plus the upcoming ones for /t-o tournament event
const TAKES_TOURNAMENT = { 't-o tournament add': 'new', 't-o tournament remove': 'tracked', 't-o tournament posts': 'tracked', 't-o tournament event': 'event', registered: 'known', reg_warn: 'known' };

// "track add", or just the command for the ones without subcommands. a subcommand group would go in the middle
function commandName(interaction) {
  const group = interaction.options.getSubcommandGroup?.(false);
  const subcommand = interaction.options.getSubcommand(false);
  return [interaction.commandName, group, subcommand].filter(Boolean).join(' ');
}

const handlers = new Map([
  ['help', (interaction) => sendEmbeds(interaction, embeds.help(flag(interaction, 'verbose')))],
  ['messages', configureMessages],
  ['socials', (interaction) => sendEmbeds(interaction, embeds.socials(state.socials))],
  ['socials_edit add', socialsAdd],
  ['socials_edit remove', socialsRemove],
  ['track add', trackAdd],
  ['track remove', trackRemove],
  ['track list', (interaction) => sendEmbeds(interaction, embeds.trackedList(state.players, Object.keys(pickable()).length - Object.keys(state.players).length, state.tournaments))],
  ['track posts', trackPosts],
  ['t-o cleanup', trackCleanup],
  ['t-o role add', toAdd],
  ['t-o role set', toSet],
  ['t-o role remove', toRemove],
  ['t-o role list', toList],
  ['notify', notify],
  ['matchmaking_role', matchmakingRole],
  ['matchmaking_search', matchmakingSearch],
  ['matchmaking_channel', matchmakingChannel],
  ['link', link],
  ['unlink', unlink],
  ['profile', profile],
  ['upcoming', upcoming],
  ['recent', recent],
  ['run', run],
  ['progress', progress],
  ['scout', scout],
  ['h2h', headToHead],
  ['stats', stats],
  ['doubles', doubles],
  ['characters', characters],
  ['predict', predict],
  ['predict_explained', predictExplained],
  ['slippi add', slippiAdd],
  ['slippi remove', slippiRemove],
  ['slippi rank', slippiRank],
  ['slippi leaderboard', slippiLeaderboard],
  ['status', status],
  ['t-o tournament add', tournamentAdd],
  ['t-o tournament remove', tournamentRemove],
  ['t-o tournament posts', tournamentPosts],
  ['t-o tournament event', tournamentEvent],
  ['bracket', bracket],
  ['stream_link', streamLink],
  ['registered', registered],
  ['reg_warn', regWarn],
  ['view_pfp', viewPfp],
  [MEMBER_H2H, memberHeadToHead],
  [MEMBER_SCOUT, memberScout],
  ...Object.values(funCommands).map((fun) => [fun.name, (interaction) => post(interaction, fun)]),
]);

export async function handleCommand(interaction) {
  return handlers.get(commandName(interaction))?.(interaction);
}

// a Full report press swapped twice at once shares the first lookup instead of asking
// start.gg again. the swap lands on the message it's on, so the key adds that message.
// every other press runs its own report: a private answer only shows for whoever pressed it,
// and a new one posts for them too. the history caches share the lookups underneath either way
const inflightButtons = new Map();

// pressing the same button twice greys it out for all first, so this is only the moment before that
async function deferButton(interaction, action) {
  if (action === 'more') {
    await interaction.deferUpdate();
  } else {
    await interaction.deferReply(action === 'private' ? { flags: MessageFlags.Ephemeral } : {});
  }
}

// discord's "didn't respond in time" means the press expired before the ack landed, and that press
// can never be answered. so a dead ack runs the report once more and delivers it as a new message
// instead of leaving the timeout. true when the press is answered, false when the retry took over
async function deferButtonOrRetry(interaction, action) {
  try {
    await deferButton(interaction, action);
    return true;
  } catch (err) {
    // already answered, so the press is still alive
    if (err?.code === RESTJSONErrorCodes.InteractionHasAlreadyBeenAcknowledged) return true;
    if (err?.code === RESTJSONErrorCodes.UnknownInteraction || err instanceof HTTPError) {
      await retryExpiredButton(interaction);
      return false;
    }
    throw err;
  }
}

// one more try for an expired press. public reports go to the channel pinging whoever pressed, and
// private or ephemeral ones go by DM so they stay private. failures here only log, the press itself
// is already dead
async function retryExpiredButton(interaction) {
  const { action, command } = readButton(interaction.customId);
  const ephemeral = Boolean(interaction.message?.flags?.has?.(MessageFlags.Ephemeral));
  const toChannel = action !== 'private' && !ephemeral && interaction.channel?.send ? interaction.channel : null;
  let target = null;
  if (toChannel) {
    target = { channel: toChannel, ping: `<@${interaction.user.id}> ` };
  } else {
    try {
      target = { channel: await interaction.user.createDM(), ping: '' };
    } catch (err) {
      console.error(`/${command} button retry failed: couldn't open a DM (${err.message})`);
      return;
    }
  }
  try {
    await target.channel.send({
      content: `${target.ping}The button press expired before I could answer. Retrying /${command} now.`,
      allowedMentions: target.ping ? { users: [interaction.user.id] } : { parse: [] },
    });
  } catch (err) {
    console.error(`/${command} button retry failed: couldn't post (${err.message})`);
    return;
  }
  // the dead press can't grey out its own buttons, so take them off directly
  if (action === 'more' && toChannel) {
    try {
      await interaction.message?.edit?.({ components: disabled(interaction.message) });
    } catch {}
  }
  const relay = expiredRelay(interaction, target);
  try {
    await answerButton(relay);
    if (!relay.sent && relay.pendingContent) {
      await target.channel.send({ content: relay.pendingContent, allowedMentions: { parse: [] } });
    }
  } catch (err) {
    console.error(`/${command} button retry failed:`, err);
    try {
      await target.channel.send({ content: failureMessage(err), allowedMentions: { parse: [] } });
    } catch {}
  }
}

// stands in for a dead press while its retry runs. sends go to the new message's home, and
// content-only edits stay out since those are loading progress, flushed at the end when the
// retry had nothing else to say
function expiredRelay(interaction, target) {
  const relay = {
    customId: interaction.customId,
    user: interaction.user,
    message: { content: null, embeds: [], components: [], flags: { has: () => false } },
    deferred: true,
    replied: false,
    ephemeral: false,
    createdTimestamp: Date.now(),
    channel: target.channel,
    appPermissions: interaction.appPermissions,
    isButton: () => true,
    sent: false,
    pendingContent: null,
    deferReply: async () => {},
    reply: async (payload) => relaySend(relay, target, payload),
    editReply: async (payload) => relaySend(relay, target, payload),
    followUp: async (payload) => relaySend(relay, target, payload),
    deleteReply: async () => {},
  };
  return relay;
}

async function relaySend(relay, target, payload) {
  const data = typeof payload === 'string' ? { content: payload } : { ...payload };
  delete data.flags; // a channel or DM post can't be ephemeral
  if (!data.embeds?.length) {
    if (typeof data.content === 'string' && data.content) relay.pendingContent = data.content;
    return { id: null };
  }
  await target.channel.send({
    content: data.content ?? undefined,
    embeds: data.embeds,
    components: data.components ?? [],
    files: data.files ?? [],
    allowedMentions: { parse: [] },
  });
  relay.sent = true;
  return { id: null };
}

async function answerButton(interaction) {
  const { action, command, player, opponent, melee, game, since: sinceText, venue } = readButton(interaction.customId);
  // buttons only ever hold dates the command accepted, so a bad one just means no filter
  const { since } = parseSince(sinceText);
  if (action === 'more') await interaction.editReply({ components: disabled(interaction.message) });
  const report = reports[command];
  if (!report || !['more', 'new', 'private'].includes(action)) return buttonFailed(interaction, 'That button doesn\'t work anymore, run the command again.');

  // /scout compares with whoever ran it, and nobody else can see its buttons
  const who = command === 'scout' ? await verifiedCaller(interaction.user.id) : player && await playerBySlug(player);
  if (!who && command === 'scout') return buttonFailed(interaction, NOT_LINKED);
  const against = opponent ? await playerBySlug(opponent) : null;
  if (!who || (opponent && !against)) return buttonFailed(interaction, `Couldn't find a start.gg account for that player. Run \`/${command}\` again.`);
  // head-to-head buttons on /run, match calls and stream alerts are a shortcut for /h2h
  // in the set's game, so they run the short report with no second press
  return report(interaction, { player: who, opponent: against, verbose: action === 'more', melee, game, since, venue });
}

// a report's button. more greys out the buttons and swaps the message for the full report, new answers with
// another report, and private does too but only for whoever pressed it, so buttons on the automatic posts
// don't fill the channel. head-to-head buttons run the short report with no second press. the button
// only has profile slugs or player ids, so the players get looked up again
export async function handleButton(interaction) {
  // Are you sure and Undo answer by changing the message they're on, see confirm.js
  if (isChoice(interaction.customId)) return handleChoice(interaction);
  const { action } = readButton(interaction.customId);
  if (action !== 'more') {
    if (!await deferButtonOrRetry(interaction, action)) return;
    return answerButton(interaction);
  }
  // no message to swap, so there's nothing to share
  const messageId = interaction.message?.id;
  if (!messageId) {
    if (!await deferButtonOrRetry(interaction, action)) return;
    return answerButton(interaction);
  }
  const key = `${interaction.customId} ${messageId}`;
  const running = inflightButtons.get(key);
  if (running) return sameReport(interaction, running, key);
  // set before the first wait, so a second press in the meantime sees it
  const done = (async () => {
    if (!await deferButtonOrRetry(interaction, action)) return;
    return answerButton(interaction);
  })();
  inflightButtons.set(key, done);
  try {
    return await done;
  } finally {
    if (inflightButtons.get(key) === done) inflightButtons.delete(key);
  }
}

// the same Full report pressed again while it's still swapping. it says start.gg is on it instead of
// asking again, since the first press swaps the answer in for all to see. when the first
// press fails there's nothing to wait for, so the waiters share one retry instead of each asking alone
async function sameReport(interaction, running, key) {
  try {
    await deferButton(interaction, 'more');
  } catch (err) {
    if (err?.code === RESTJSONErrorCodes.InteractionHasAlreadyBeenAcknowledged) {} // press still alive, carry on
    // the first press owns delivery, so a dead waiter just watches the message
    else return console.error(`/${readButton(interaction.customId).command} button waiter couldn't answer:`, err.message);
  }
  await interaction.followUp({ content: 'Start.gg is already working on that one. The full report swaps in when it\'s done.', flags: MessageFlags.Ephemeral });
  if (await running.then(() => true, () => false)) return;
  // a waiter ahead of this one already started the retry, so share that instead of asking alone
  const shared = inflightButtons.get(key);
  if (shared) return shared;
  const retry = answerButton(interaction);
  inflightButtons.set(key, retry);
  try {
    return await retry;
  } finally {
    if (inflightButtons.get(key) === retry) inflightButtons.delete(key);
  }
}

// the same buttons, greyed out
function disabled(message) {
  return message.components.map((row) => {
    const { components, ...rest } = row.toJSON();
    return { ...rest, components: components.map((button) => ({ ...button, disabled: true })) };
  });
}

// only whoever pressed it hears what went wrong. a report that was being swapped goes back the way it was
export async function buttonFailed(interaction, content) {
  if (readButton(interaction.customId).action !== 'more' || !interaction.deferred) return replyEphemeralAfterDefer(interaction, content);
  const { message } = interaction;
  await interaction.editReply({ content: message.content || null, embeds: message.embeds, components: message.components, allowedMentions: { parse: [] } });
  return interaction.followUp({ content, flags: MessageFlags.Ephemeral });
}

export async function handleAutocomplete(interaction) {
  const focused = interaction.options.getFocused();
  const typed = focused.toLowerCase();
  const name = commandName(interaction);
  const choices = [];

  if (Object.hasOwn(TAKES_TOURNAMENT, name)) return interaction.respond(tournamentChoices(focused, { only: TAKES_TOURNAMENT[name] }));

  if (name === 'slippi remove' || name === 'slippi rank') return interaction.respond(slippiChoices(focused, { anyCode: name === 'slippi rank' }));

  if (name === 'socials_edit remove') {
    for (const social of state.socials) {
      const label = `${social.name} · ${social.url.replace(/^https?:\/\//, '')}`;
      if (label.toLowerCase().includes(typed)) choices.push({ name: label.slice(0, 100), value: social.url });
    }
    return interaction.respond(choices.slice(0, 25));
  }

  const trackedOnly = TRACKED_ONLY.includes(name);
  if (TAKES_ALL.includes(name) && 'all'.startsWith(typed)) choices.push({ name: 'all', value: 'all' });
  // tracked players, then people who linked themselves. only 25 fit, so tags that start with what's typed go
  // first, and among those whoever this person picked lately. with nothing typed yet that's the whole list
  const people = trackedOnly ? Object.values(state.players) : Object.values(pickable()).sort((a, b) => !state.players[a.userId] - !state.players[b.userId]);
  const recent = recentPicks(interaction.user.id);
  const recency = (player) => {
    const at = recent.indexOf(String(player.userId));
    return at === -1 ? recent.length : at;
  };
  const matches = people.filter((player) => nameMatches(player.tag, focused));
  const starts = (player) => nameMatches(player.tag, focused, { start: true });
  matches.sort((a, b) => starts(b) - starts(a) || recency(a) - recency(b));
  for (const player of matches) choices.push({ name: state.players[player.userId] ? player.tag : `${player.tag} (linked)`, value: String(player.userId) });

  // an empty list looks broken, so say why. picking it gets the not found reply
  if (!choices.length) {
    let why = trackedOnly ? `Nobody tracked matches "${focused}"` : `Nobody tracked or linked matches "${focused}", /track add them first`;
    if (!people.length) why = 'Nobody is tracked yet, /track add someone first';
    choices.push({ name: why.slice(0, 100), value: focused.slice(0, 100) || 'nobody' });
  }

  await interaction.respond(choices.slice(0, 25));
}

function status(interaction) {
  const tournaments = Object.values(state.tournaments).filter((tournament) => tournament.tracked && !tournament.resultsPosted);
  const info = {
    ...health,
    // only off the server, to spot a copy running somewhere it shouldn't. the server's is a random container id
    host: process.env.RAILWAY_ENVIRONMENT_NAME ? null : hostname(),
    deployedAt: deployedAt(),
    deployMessage: state.deploy?.message,
    avatar: interaction.client.user.displayAvatarURL(),
    players: Object.keys(state.players).length,
    slippi: Object.keys(state.slippi).length,
    tournaments: tournaments.length,
    queued: startgg.queueLength(),
  };
  return interaction.reply({ embeds: [embeds.status(info)], allowedMentions: { parse: [] } });
}

// just the picture, as big as discord has it
async function viewPfp(interaction) {
  const url = interaction.client.user.displayAvatarURL({ extension: 'png', size: 4096 });
  await interaction.deferReply();
  await interaction.editReply({ files: [{ attachment: url, name: `pfp.${new URL(url).pathname.split('.').pop()}` }] });
}
