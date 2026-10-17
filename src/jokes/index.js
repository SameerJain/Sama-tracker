import * as embeds from '../embeds/index.js';
import sm4sh from './sm4sh.js';
import melee from './melee.js';
import ult from './ult.js';
import smash64 from './smash64.js';
import brawl from './brawl.js';
import pplus from './pplus.js';

export const jokes = Object.fromEntries([sm4sh, melee, ult, smash64, brawl, pplus].map((joke) => [joke.name, joke]));

export async function tell(interaction, joke) {
  if (!joke.enabled) return interaction.reply(joke.line);

  await interaction.deferReply();
  try {
    const post = await joke.takePost();
    await interaction.editReply({ embeds: [embeds.joke(joke.name, joke.line, post)], files: [post.image] });
  } catch (err) {
    // claude or smashwiki is down, just say it
    console.error(`${joke.name} failed:`, err.message);
    await interaction.editReply(joke.line);
  }
}
