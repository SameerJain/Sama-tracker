import { makeJoke } from './joke.js';

const PROMPT = `You are a Super Smash Bros. 64 lifer posting in a Discord server of Smash players. You've played the original on an N64 since 1999, and as far as you're concerned every Smash since is a knockoff that never gave it credit.
Write a post about how Smash 64 did it first and did it better, in the style given in the message. Build it around one or two of the talking points, and whatever the topic, bring it back to 64 having done it first, a different way each time. Anything 64 doesn't have, it never needed.
Be funny and over the top: grumpy, proud, wounded that Melee gets all the credit, sure the newer games are soft. Specific jokes beat generic old man yelling, and riff on the facts instead of reciting them.
Real players and scene moments are fair game, but this crowd notices mistakes, so for Smash 64 facts stick to the talking points and never make up frame data, results or quotes. 64 has no air dodge, so no wavedashing.`;

const STYLES = [
  'a reply to someone who said Melee is where competitive Smash started',
  'an old head telling the kids they had it easy',
  'an all-caps rant in one paragraph',
  'a numbered list of things 64 did first',
  'a copypasta',
  'a history lecture that gets more bitter as it goes',
  'a hot take that ends with "fight me"',
  'a eulogy for every Smash that came after',
  'a reply to a newcomer who asked which Smash to start with',
  'a museum tour guide showing off an N64',
  'a one star review of a newer Smash game that keeps comparing it to 64',
  'a commentator calling a zero-to-death like it is the moon landing',
  'a letter to Sakurai asking why he kept adding things',
  'a short rhyming poem',
  'a dating profile that is mostly about their N64',
  'two or three grumpy haiku',
  'a group chat message trying to get people to play on Dream Land',
  'a closing argument to a jury',
];

// haiku gives 64 melee's mechanics without real facts to go off
const TALKING_POINTS = [
  'only 12 characters: Mario, Donkey Kong, Link, Samus, Yoshi, Kirby, Fox and Pikachu, plus unlockable Luigi, Captain Falcon, Ness and Jigglypuff',
  'hitstun is huge, so combos go on forever and zero-to-deaths are normal',
  'Z-canceling: press Z in the 11 frames before landing an aerial and the landing lag drops to 4 frames. Melee\'s L-cancel only halves it',
  'shield break combos, like Yoshi and Ness double jump canceling Z-canceled aerials into a shield until it pops',
  'no air dodges, spot dodges, charged smash attacks, side specials, pummels, up throws or down throws. Melee added all of them',
  'Dream Land is the only legal stage, so every tournament match is played on it',
  'the September 2026 tier list: Pikachu and Yoshi on top, then Kirby and Captain Falcon, with Link and Luigi at the bottom',
  'Isai, a Pikachu main who can play the whole cast at the top level, widely called the greatest 64 player ever. He was so far ahead that "Isai is too good" became a meme',
  'Ness was 3rd on the first tier list for his double jump cancel combos, then dropped once people realized his range was too short. He\'s 8th now',
  'Donkey Kong is 9th on the tier list but still shows up at tournaments all the time',
  'the Hori Mini Pad, a small N64 controller that only came out in Japan, so rare that 64 players pay collector prices for one',
  'Smash Remix, a fan mod that adds 18 characters like Falco, Ganondorf, Marth and Mewtwo and leaves the original 12 untouched',
  'Sakurai started it at HAL Laboratory as Dragon King: The Fighting Game, then built a prototype with Mario, Donkey Kong, Samus and Fox without asking Nintendo and only showed them once it was balanced',
  'Satoru Iwata helped make it and came up with the name Super Smash Bros.',
  'Shigesato Itoi, who made EarthBound, had the idea of the fighters being dolls, which is how the intro shows them',
  'damage percent instead of health bars, and you win by knocking people off the stage. Every Smash since kept it',
  'it came out in 1999, two years before Melee',
  'Melee players calling 64 a prototype for Melee',
];

export default makeJoke({
  name: '64',
  line: 'SMASH 64 DID IT FIRST',
  category: 'Screenshots (SSB)',
  prompt: PROMPT,
  styles: STYLES,
  points: TALKING_POINTS,
  // smashwiki calls it the original Super Smash Bros.
  focus: /Smash 64|original Super Smash Bros|SSB64|N64/,
  articles: [
    'Characters (SSB)', 'Techniques (SSB)', 'Stages (SSB)', 'Items (SSB)', 'Pokémon (SSB)', 'Glitches (SSB)', 'Modes (SSB)',
    'Major tournaments (SSB)',
  ],
  videos: [
    'smash 64 combo video', 'smash 64 grand finals', 'smash 64 history', 'smash 64 tech tutorial', 'super smash bros 64 retrospective',
    'smash remix', 'smash 64 zero to death', 'smash 64 pikachu', 'smash 64 tier list',
  ],
});
