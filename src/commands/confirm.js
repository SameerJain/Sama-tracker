import { ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { buttonRow, replyEphemeral } from './shared.js';

// a removal can be put back this long after
const UNDO_SECONDS = 60;

// Are you sure buttons for changes that are a pain to put back, and Undo buttons for removals. discord keeps
// nothing but a button's id, so it's choice:kind:target:discordId, with discordId whoever ran the command,
// the only one who can press it. each kind is set up with confirmable by the module whose command it is:
//   command: the command, for telling anyone else who presses it
//   run(target): makes the change, returning { content } and undo, what was removed, when it can be put back
//   cancel(target): the reply when they press Cancel
//   undo(record, discordId): puts record back, returning the reply
//   tooLate: the reply when Undo is pressed after the minute
const kinds = new Map();
const CHOICES = ['confirm', 'cancel', 'undo'];

// what Undo would put back, in memory since it's only kept a minute. a restart in that minute loses it
const removed = new Map();
// a double press before the first update lands runs twice without this
const confirming = new Set();

function confirmable(kind, spec) {
  kinds.set(kind, spec);
}

const isChoice = (customId) => CHOICES.includes(customId.split(':')[0]);

function choiceButton(choice, kind, target, discordId, label, style) {
  return new ButtonBuilder().setCustomId([choice, kind, target, discordId].join(':')).setLabel(label).setStyle(style);
}

// the question goes in the channel like the answer would have, with label on the button that goes ahead.
// a command that had to look something up first already deferred, so it edits that in
function askFirst(interaction, kind, target, question, label) {
  const { id } = interaction.user;
  const asking = {
    content: question,
    components: buttonRow(choiceButton('confirm', kind, target, id, label, ButtonStyle.Danger), choiceButton('cancel', kind, target, id, 'Cancel', ButtonStyle.Secondary)),
    allowedMentions: { parse: [] },
  };
  return interaction.deferred ? interaction.editReply(asking) : interaction.reply(asking);
}

// an Undo button that puts record back, and comes off the message once the minute is up. reply is the
// interaction whose reply has the button
function undoRow(reply, kind, target, record) {
  const { id } = reply.user;
  const key = [kind, target, id].join(':');
  const kept = { record, at: Date.now() };
  removed.set(key, kept);
  setTimeout(() => {
    if (removed.get(key) === kept) removed.delete(key);
    reply.editReply({ components: [] }).catch(() => {});
  }, UNDO_SECONDS * 1000).unref?.();
  return buttonRow(choiceButton('undo', kind, target, id, 'Undo', ButtonStyle.Secondary));
}

async function handleChoice(interaction) {
  // target could hold a colon one day, so the outer parts are pinned and the middle stays whole
  const parts = interaction.customId.split(':');
  const [choice, kind] = parts;
  const discordId = parts.at(-1);
  const target = parts.slice(2, -1).join(':');
  const spec = kinds.get(kind);
  if (parts.length < 4 || !target || !spec) return replyEphemeral(interaction, 'That button doesn\'t work anymore.');
  if (interaction.user.id !== discordId) return replyEphemeral(interaction, `Only whoever ran \`${spec.command}\` can press this.`);

  if (choice === 'cancel') return interaction.update({ content: spec.cancel(target), components: [], allowedMentions: { parse: [] } });
  if (choice === 'confirm') {
    const key = interaction.customId;
    if (confirming.has(key)) return replyEphemeral(interaction, 'Already on it, one press is enough.');
    confirming.add(key);
    try {
      const { content, undo } = spec.run(target);
      return await interaction.update({ content, components: undo ? undoRow(interaction, kind, target, undo) : [], allowedMentions: { parse: [] } });
    } finally {
      confirming.delete(key);
    }
  }

  const key = [kind, target, discordId].join(':');
  const kept = removed.get(key);
  removed.delete(key);
  if (!kept || Date.now() - kept.at > UNDO_SECONDS * 1000) {
    await interaction.update({ components: [] });
    return interaction.followUp({ content: spec.tooLate, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  }
  return interaction.update({ content: spec.undo(kept.record, discordId), components: [], allowedMentions: { parse: [] } });
}

export { confirmable, isChoice, askFirst, undoRow, handleChoice, UNDO_SECONDS };
