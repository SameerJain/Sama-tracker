import { MessageFlags } from 'discord.js';
import { asCommand, commandProgress, queueLength } from '../startgg.js';
import { commandLabel, roughly, t } from './shared.js';

// besides the one running. more than this and the newest gets turned away
const QUEUED_PER_PERSON = 3;
// waiting start.gg requests across everyone past this, and the newest command is
// turned away instead of queueing for minutes behind the rest
const QUEUED_GLOBAL_MAX = 200;
// the time left on the one ahead only shows once it's this long
const LEFT_SHOWN_SECONDS = 10;

// each person's commands that haven't finished, oldest first. keyed by server too, so a slow
// command in one server doesn't hold up theirs in another
const lines = new Map();
const lineKey = (interaction) => `${interaction.guildId ?? ''}:${interaction.user.id}`;

// runs a command in its turn. it starts right away, so it checks its input and answers discord in time
// with whatever reply it wants, public or private. only its start.gg requests wait for the person's last
// command to finish, so a command that needs none never waits, and nobody gets two turns in start.gg's
// line at once. run gets the command's progress, for logging. false when it was turned away
async function inTurn(interaction, run) {
  const key = lineKey(interaction);
  const line = lines.get(key) ?? [];
  if (line.length > QUEUED_PER_PERSON) {
    await interaction.reply({ content: t`You have ${line.length} commands going already. Try again once one is done.`, flags: MessageFlags.Ephemeral });
    return false;
  }

  const ahead = line.at(-1);
  const turn = { label: commandLabel(interaction), finished: false, progress: null };
  turn.done = new Promise((resolve) => { turn.finish = resolve; });
  // the global check runs before this command takes a slot, so a backed-up
  // start.gg turns the newest away instead of queueing it for minutes
  if (!ahead && queueLength() >= QUEUED_GLOBAL_MAX) {
    await interaction.reply({ content: t('start.gg is backed up right now, try again in a minute.'), flags: MessageFlags.Ephemeral });
    return false;
  }
  line.push(turn);
  lines.set(key, line);
  // the queued line has to land before the command goes on, or it could replace the answer
  const wait = ahead && (() => (ahead.finished ? null : Promise.all([ahead.done, showQueued(interaction, ahead)])));
  try {
    // by server too, so one busy server takes one turn a round in start.gg's line like any other
    await asCommand(() => {
      turn.progress = commandProgress();
      return run(turn.progress);
    }, wait, interaction.guildId ?? '');
    return true;
  } finally {
    turn.finished = true;
    turn.finish();
    line.splice(line.indexOf(turn), 1);
    if (!line.length) lines.delete(key);
  }
}

// the reply says what it's waiting on. the one ahead's time left counts everyone else's start.gg requests
// in between too. the command's next edit replaces it
async function showQueued(interaction, ahead) {
  const { seconds } = ahead.progress?.() ?? { seconds: 0 };
  const left = seconds >= LEFT_SHOWN_SECONDS ? t`, which has about ${roughly(seconds)} left` : '';
  await interaction.editReply(t`**Queued** behind your ${ahead.label}${left}. This one starts when it's done.`).catch(() => {});
}

export { inTurn, QUEUED_PER_PERSON, QUEUED_GLOBAL_MAX };
