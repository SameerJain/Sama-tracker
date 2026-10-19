import { GuildScheduledEventEntityType, GuildScheduledEventPrivacyLevel, PermissionFlagsBits } from 'discord.js';
import { startggUrl } from './startgg.js';
import { state } from './store.js';
import { messageSettings } from './message-settings.js';

const HOUR = 60 * 60;
// discord events need an end time, and start.gg doesn't always have one
const DEFAULT_LENGTH_HOURS = 6;
const NO_PERMISSION = 'I need Manage Events permission to make Discord events.';

// discord external events need a location, 100 characters at most
function eventLocation(tournament) {
  if (tournament.isOnline) return 'Online';
  return ([tournament.city, tournament.addrState].filter(Boolean).join(', ') || 'See the start.gg link').slice(0, 100);
}

// written out in the server's timezone, since an event description may not show discord timestamps
function timeText(seconds) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: messageSettings().timezone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(new Date(seconds * 1000));
}

// the start.gg link gets a line to itself, which is how an event made earlier gets found again
function eventDescription(tournament) {
  const lines = [`${tournament.name} on start.gg`, startggUrl(tournament.slug), eventLocation(tournament)];
  if (tournament.registrationClosesAt && tournament.registrationClosesAt < tournament.startAt) {
    lines.push(`Registration closes ${timeText(tournament.registrationClosesAt)}`);
  }
  const names = (tournament.events ?? []).map((event) => event.name).filter(Boolean).slice(0, 10);
  if (names.length) lines.push(`Events: ${names.join(', ')}`);
  return lines.join('\n').slice(0, 1000);
}

// why the bot can't make events in this server, or null when it can
export function cantMakeEvents(guild) {
  if (!guild?.scheduledEvents?.create) return 'Couldn\'t make a Discord event here.';
  const permissions = guild.members?.me?.permissions;
  if (permissions?.has && !permissions.has(PermissionFlagsBits.ManageEvents) && !permissions.has(PermissionFlagsBits.CreateEvents)) return NO_PERMISSION;
  return null;
}

const eventUrl = (guild, event) => event.url ?? `https://discord.com/events/${guild.id ?? ''}/${event.id}`;

// the discord event for a tournament from getRegistration, made or found: { url, isNew }, or { error } to
// show. the saved id goes first, then the start.gg link in a description, so /discord_event and
// /tournament add add_event:on land on the same one. the id is saved either way
export async function ensureDiscordEvent(found, guild) {
  const cant = cantMakeEvents(guild);
  if (cant) return { error: cant };
  const tournament = state.tournaments[found.id];
  const link = startggUrl(found.slug);

  try {
    const existing = [...((await guild.scheduledEvents.fetch())?.values?.() ?? [])];
    const made = existing.find((event) => String(event.id) === String(tournament?.discordEventId))
      ?? existing.find((event) => event.description?.split('\n').includes(link));
    if (made) {
      if (tournament) tournament.discordEventId = made.id;
      return { url: eventUrl(guild, made), isNew: false };
    }
  } catch (err) {
    console.error(`checking discord events for ${found.name ?? found.id} failed:`, err.message);
  }

  let created;
  try {
    created = await guild.scheduledEvents.create({
      name: found.name.slice(0, 100),
      scheduledStartTime: new Date(found.startAt * 1000),
      scheduledEndTime: new Date((found.endAt > found.startAt ? found.endAt : found.startAt + DEFAULT_LENGTH_HOURS * HOUR) * 1000),
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      entityType: GuildScheduledEventEntityType.External,
      description: eventDescription(found),
      entityMetadata: { location: eventLocation(found) },
    });
  } catch (err) {
    if (err.code === 50013) return { error: NO_PERMISSION };
    throw err;
  }
  if (tournament) tournament.discordEventId = created.id;
  return { url: eventUrl(guild, created), isNew: true };
}
