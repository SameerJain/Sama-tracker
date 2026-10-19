import * as embeds from '../embeds/index.js';
import sm4sh from './sm4sh.js';
import melee from './melee.js';
import ult from './ult.js';
import smash64 from './smash64.js';
import brawl from './brawl.js';
import pplus from './pplus.js';
import bills from './bills.js';

// release order, with project+ after the official games
export const funCommands = Object.fromEntries([smash64, melee, brawl, sm4sh, ult, pplus, bills].map((fun) => [fun.name, fun]));

export async function post(interaction, fun) {
  if (!fun.enabled) return interaction.reply(fun.line);

  await interaction.deferReply();
  try {
    const content = await fun.takePost();
    const reply = fun.format?.(content) ?? { embeds: [embeds.fun(fun.name, fun.line, content)], files: [content.image] };
    // haiku and wiki text are quoted material, so they never get to ping
    await interaction.editReply({ ...reply, allowedMentions: { parse: [] } });
  } catch (err) {
    // a source is down, so fall back to the line
    console.error(`${fun.name} failed:`, err.message);
    await interaction.editReply(fun.line);
  }
}
