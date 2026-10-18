// Adds every attendee of a start.gg tournament to the tracked list, from the bot's host.
// Run `npm run track`, or `node tools/track-attendees.js` in the app folder on Railway.
// The bot has to be the one that saves state, so this leaves a request it picks up within 30s.
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import * as startgg from '../src/startgg.js';
import { state } from '../src/store.js';
import { parseTournamentLink, readTrackRequest, writeTrackRequest } from '../src/track-request.js';

const WAIT_SECONDS = 60;
const POLL_MS = 2000;
// names listed in the output, then just the count
const NAMES_SHOWN = 25;

const fail = (message) => {
  throw new Error(message);
};

async function main() {
  if (!process.env.STARTGG_TOKEN) {
    fail('STARTGG_TOKEN is not set. Run this on the bot\'s host, or use `npm run track` with a .env present.');
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const input = (await rl.question('Tournament link: ').catch(() => '')).trim();
  rl.close();

  if (!input) fail('No link given.');
  const link = parseTournamentLink(input);
  if (!link) fail(`Couldn't find a tournament in "${input}". Paste its link, like start.gg/tournament/smashcade-2-4.`);

  console.log(`Reading ${link.slug} from start.gg...`);
  const tournament = await startgg.getRegistration(link.slug);
  if (!tournament) {
    fail(`No tournament on start.gg for "${link.slug}". Check the link, or the event filter in it.`);
  }
  if (link.eventIds) console.log(`Events: ${link.eventIds.join(', ')}`);

  const attendees = await startgg.getAttendees(tournament.id, { eventIds: link.eventIds });
  if (!attendees.length) {
    // a hidden list and an event with nobody in it both come back empty
    const why = !link.eventIds && startgg.attendeesHidden(tournament, attendees)
      ? 'start.gg hides the attendee list'
      : `no attendees${link.eventIds ? ` in events ${link.eventIds.join(', ')}` : ''}`;
    fail(`Nothing to add: ${why} for ${tournament.name}.`);
  }

  // a TO can add people who never made an account, and a filter can bring back an event's list twice
  const seen = new Set();
  const accounts = attendees.filter((attendee) => {
    if (!attendee.userId || !attendee.playerId || seen.has(attendee.userId)) return false;
    seen.add(attendee.userId);
    return true;
  });
  const adding = accounts.filter((attendee) => !state.players[attendee.userId]);
  const stats = [`${attendees.length} attendees`, `${accounts.length} with an account`];
  if (accounts.length - adding.length) stats.push(`${accounts.length - adding.length} already tracked`);
  if (attendees.length - accounts.length) stats.push(`${attendees.length - accounts.length} without an account`);
  console.log(`${tournament.name} · ${stats.join(' · ')}`);

  if (!adding.length) {
    console.log('Everyone here is already tracked.');
    return;
  }

  // a run that happened after the last check may still be waiting, so they go in the same request
  const pending = readTrackRequest();
  const players = [...new Map([...(pending?.players ?? []), ...adding].map((player) => [player.userId, player])).values()];
  writeTrackRequest({ source: tournament.name, createdAt: Math.floor(Date.now() / 1000), players });

  const names = adding.map((player) => player.tag);
  const listed = names.length > NAMES_SHOWN ? `${names.slice(0, NAMES_SHOWN).join(', ')} and ${names.length - NAMES_SHOWN} more` : names.join(', ');
  console.log(`Queued ${adding.length} player${adding.length === 1 ? '' : 's'}: ${listed}`);
  console.log('Their set results and stream alerts start off. /sets and /stream in Discord turn them on.');

  // on the bot's host the request is read within 30 seconds and this can say it's done. anywhere
  // else there may be no bot running, and it'll be read on the next start
  if (!process.env.RAILWAY_ENVIRONMENT_NAME) {
    console.log('The bot adds queued players on its next check. Nothing else to do.');
    return;
  }
  process.stdout.write('Waiting for the bot');
  for (let waited = 0; waited < WAIT_SECONDS * 1000; waited += POLL_MS) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    if (!readTrackRequest()) {
      console.log(`\nDone, they're tracked now.`);
      return;
    }
    process.stdout.write('.');
  }
  console.log('\nThe bot hasn\'t picked the request up yet. It gets added on the next check or restart.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
