import { GuildScheduledEventEntityType, GuildScheduledEventPrivacyLevel, GuildScheduledEventStatus, PermissionFlagsBits } from 'discord.js';
import { getRegistrationById, startggUrl } from './startgg.js';
import { state, save } from './store.js';
import { BIG_EVENT_ATTENDEES, BIG_EVENT_BRACKETS, BIG_EVENT_HOURS, messageSettings } from './message-settings.js';
import { venueText } from './embeds/shared.js';

const HOUR = 60 * 60;
const DAY = 24 * HOUR;
// a saved event is forgotten this long after its tournament started. discord events have to start in the
// future, so by then nothing would make it again anyway
const EVENT_KEPT_DAYS = 7;

// a major or regional, going by its size. past this an evening can't hold it
function looksBig(found) {
  return (found.numAttendees ?? 0) >= BIG_EVENT_ATTENDEES || (found.events ?? []).length >= BIG_EVENT_BRACKETS;
}

// how long an event runs when start.gg has no end time for it. usually the server's tuned
// length, but a major or regional gets pushed to a full day. that only ever pushes back,
// it never pulls a tuned length in
function defaultLengthHours(found) {
  if (looksBig(found)) return Math.max(messageSettings().eventLength, BIG_EVENT_HOURS);
  return messageSettings().eventLength;
}

const NO_PERMISSION = 'I need Manage Events permission to make Discord events.';

const secondsNow = () => Math.floor(Date.now() / 1000);

// discord external events need a location, 100 characters at most. the venue and its street address when
// the TO put them on start.gg, the address alone when both don't fit
function eventLocation(tournament) {
  if (tournament.isOnline) return 'Online';
  for (const each of [venueText(tournament), tournament.venueAddress?.trim()]) {
    if (each && each.length <= 100) return each;
  }
  return ([tournament.city, tournament.addrState].filter(Boolean).join(', ') || 'See the start.gg link').slice(0, 100);
}

// written out in the server's timezone, since an event description may not show discord timestamps
function timeText(seconds) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: messageSettings().timezone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(new Date(seconds * 1000));
}

// twitch names link to the channel, anything already a link stays one, the rest show with their source
function streamLink({ streamName, streamSource }) {
  if (streamSource === 'TWITCH') return `https://twitch.tv/${encodeURIComponent(streamName)}`;
  if (/^https?:\/\//i.test(streamName)) return streamName;
  return streamSource ? `${streamName} (${streamSource.charAt(0)}${streamSource.slice(1).toLowerCase()})` : streamName;
}

// the start.gg link gets a line to itself, which is how an event made earlier gets found again
function eventDescription(tournament) {
  const lines = [`${tournament.name} on start.gg`, startggUrl(tournament.slug), eventLocation(tournament)];
  const streams = (tournament.streams ?? []).filter((stream) => stream?.streamName).map(streamLink);
  if (streams.length) lines.push(`Streams: ${streams.join(', ')}`);
  if (tournament.registrationClosesAt && tournament.registrationClosesAt < tournament.startAt) {
    lines.push(`Registration closes ${timeText(tournament.registrationClosesAt)}`);
  }
  const names = (tournament.events ?? []).map((event) => event.name).filter(Boolean).slice(0, 10);
  if (names.length) lines.push(`Events: ${names.join(', ')}`);
  return lines.join('\n').slice(0, 1000);
}

// the banner for the discord cover, the logo when there's no banner. discord's cover is wide like the banner
function coverUrl(tournament) {
  const image = (type) => tournament.images?.find((each) => each.type === type)?.url;
  return image('banner') ?? image('profile') ?? null;
}

// downloaded, so a bad image leaves the event without a cover instead of failing the whole create
async function coverImage(tournament) {
  const url = coverUrl(tournament);
  if (!url) return { url: null, image: null };
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`status ${res.status}`);
    return { url, image: Buffer.from(await res.arrayBuffer()) };
  } catch (err) {
    console.error(`downloading the cover for ${tournament.name ?? tournament.id} failed:`, err.message);
    return { url: null, image: null };
  }
}

// what a discord event shows for a tournament from getRegistration. discord requires an end time on
// external events, and start.gg doesn't always have one, so that falls back to the server's tuned
// length, or a full day for a major or regional
function eventFields(found) {
  return {
    name: found.name.slice(0, 100),
    scheduledStartTime: new Date(found.startAt * 1000),
    scheduledEndTime: new Date((found.endAt > found.startAt ? found.endAt : found.startAt + defaultLengthHours(found) * HOUR) * 1000),
    description: eventDescription(found),
    entityMetadata: { location: eventLocation(found) },
  };
}

// start.gg's side of an event as of the last make or sync. the sync only edits when this changes, so an edit a
// mod made in discord stays until the TO changes something on start.gg
function syncKey(fields, cover) {
  const { name, scheduledStartTime, scheduledEndTime, description, entityMetadata } = fields;
  return JSON.stringify([name, +scheduledStartTime, +scheduledEndTime, description, entityMetadata.location, cover ?? null]);
}

// synced null means the event may not match start.gg yet, and the next sync puts start.gg's details on it
function remember(found, eventId, synced) {
  state.discordEvents[found.id] = { eventId, slug: found.slug, startAt: found.startAt, synced };
}

// why the bot can't make events in this server, or null when it can
export function cantMakeEvents(guild) {
  if (!guild?.scheduledEvents?.create) return 'Couldn\'t make a Discord event here.';
  // the bot's own member isn't always cached, and then discord says no on the create instead
  const permissions = guild.members?.me?.permissions;
  if (permissions && !permissions.has(PermissionFlagsBits.ManageEvents) && !permissions.has(PermissionFlagsBits.CreateEvents)) return NO_PERMISSION;
  return null;
}

const eventUrl = (guild, event) => event.url ?? `https://discord.com/events/${guild.id ?? ''}/${event.id}`;

// the discord event for a tournament from getRegistration, made or found: { url, isNew }, or { error } to
// show. the saved id goes first, then the start.gg link in a description, so /t-o tournament event, add_event:on
// and /messages events land on the same one. the id gets saved either way, for the sync and so a deleted
// event isn't made again
export async function ensureDiscordEvent(found, guild) {
  const cant = cantMakeEvents(guild);
  if (cant) return { error: cant };
  const saved = state.discordEvents[found.id];
  const link = startggUrl(found.slug);

  try {
    const existing = [...(await guild.scheduledEvents.fetch()).values()];
    const made = existing.find((event) => String(event.id) === String(saved?.eventId))
      ?? existing.find((event) => event.description?.split('\n').includes(link));
    if (made) {
      if (String(saved?.eventId) !== String(made.id)) remember(found, made.id, null);
      return { url: eventUrl(guild, made), isNew: false };
    }
  } catch (err) {
    console.error(`checking discord events for ${found.name ?? found.id} failed:`, err.message);
  }

  const fields = eventFields(found);
  const cover = await coverImage(found);
  const options = { ...fields, privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly, entityType: GuildScheduledEventEntityType.External };
  if (cover.image) options.image = cover.image;
  let created;
  try {
    created = await guild.scheduledEvents.create(options);
  } catch (err) {
    if (err.code === 50013) return { error: NO_PERMISSION };
    throw err;
  }
  remember(found, created.id, syncKey(fields, cover.url));
  return { url: eventUrl(guild, created), isNew: true };
}

// the discord events the bot made keep up with start.gg until they start: a new time, end time, cover, name,
// venue, close time, streams or event list gets edited in, and a tournament deleted or unpublished on start.gg cancels
// its event. it goes by tournament id, since a TO can change the link. an event a mod deleted, or one that
// started, is left alone. nothing gets posted, and each event costs one start.gg request a run
export async function syncDiscordEvents(guild, now = secondsNow()) {
  let changed = false;
  for (const [id, saved] of Object.entries(state.discordEvents)) {
    if (saved.startAt && saved.startAt < now - EVENT_KEPT_DAYS * DAY) {
      delete state.discordEvents[id];
      changed = true;
    }
  }
  const due = Object.entries(state.discordEvents).filter(([, saved]) => !saved.gone && saved.startAt > now);
  if (due.length && !cantMakeEvents(guild)) {
    const events = await guild.scheduledEvents.fetch();
    for (const [id, saved] of due) {
      try {
        const event = events.get(saved.eventId);
        // deleted by a mod, started or cancelled in discord. a deleted one stays deleted
        if (!event || (event.status ?? GuildScheduledEventStatus.Scheduled) !== GuildScheduledEventStatus.Scheduled) {
          saved.gone = true;
          changed = true;
          continue;
        }
        const found = await getRegistrationById(id);
        if (!found) {
          await guild.scheduledEvents.edit(event, { status: GuildScheduledEventStatus.Canceled });
          saved.gone = true;
          changed = true;
          continue;
        }
        // moved to a time that's already past, which discord won't take
        if (!(found.startAt > now)) continue;
        const fields = eventFields(found);
        const key = syncKey(fields, coverUrl(found));
        if (key === saved.synced) continue;
        // a cover that won't download still gets the text edits. the saved key keeps no cover, so the next
        // run tries the image again
        const cover = await coverImage(found);
        await guild.scheduledEvents.edit(event, cover.image ? { ...fields, image: cover.image } : fields);
        Object.assign(saved, { slug: found.slug, startAt: found.startAt, synced: syncKey(fields, cover.url) });
        changed = true;
      } catch (err) {
        console.error(`syncing the discord event for tournament ${id} failed:`, err.message);
      }
    }
  }
  if (changed) save();
}
