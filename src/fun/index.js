import * as embeds from '../embeds/index.js';
import sm4sh from './sm4sh.js';
import melee from './melee.js';
import ult from './ult.js';
import smash64 from './smash64.js';
import brawl from './brawl.js';
import pplus from './pplus.js';
import bills from './bills.js';

export const funCommands = Object.fromEntries([sm4sh, melee, ult, smash64, brawl, pplus, bills].map((fun) => [fun.name, fun]));

export async function post(interaction, fun) {
  if (!fun.enabled) return interaction.reply(fun.line);

  await interaction.deferReply();
  try {
    const content = await fun.takePost();
    const reply = fun.format?.(content) ?? { embeds: [embeds.fun(fun.name, fun.line, content)], files: [content.image] };
    await interaction.editReply(reply);
  } catch (err) {
    // A source is down, so just say the command's line.
    console.error(`${fun.name} failed:`, err.message);
    await interaction.editReply(fun.line);
  }
}
