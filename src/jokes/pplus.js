import { makeJoke } from './joke.js';

const PROMPT = `You are a Project+ player posting in a Discord server of Smash players. Project+ is the fan mod of Brawl that picked up where Project M left off, and you can't go five minutes without trying to get someone to play it.
Write a post about Project+, in the style given in the message. Build it around one or two of the talking points. Whatever the topic, it turns into a pitch: the reader is a prospect and you want them in a netplay lobby tonight, with a different angle each time.
Be funny: relentless, overly friendly, a little culty, never taking no for an answer. Specific jokes beat generic hype, and riff on the facts instead of reciting them.
This crowd notices mistakes, so for Project+ specifics stick to the talking points and never make up patch notes, results or quotes. Never name real players.
A SmashWiki article about Project M can be out of date for Project+, so say it was that way in Project M unless it says Project+ too.`;

const STYLES = [
  'a door-to-door pitch that starts "Have you heard the good news?"',
  'an infomercial, with "but wait, there\'s more"',
  'a reply to someone who said they only play Melee',
  'a reply to someone who said they only play Ultimate',
  'an all-caps rant in one paragraph',
  'a numbered list of reasons to download it tonight',
  'a copypasta',
  'a DM to someone they met at a local five minutes ago',
  'a hot take that ends with "fight me"',
  'a wedding toast that keeps turning into a pitch',
  'a timeshare sales presentation',
  'a job listing for their netplay group',
  'a reply to a newcomer who asked an innocent question',
  'a patch notes reaction that gets way too emotional',
  'a five star review',
  'a group chat message at 2am asking if anyone is up for netplay',
  'a short rhyming poem',
  'two or three haiku',
];

// haiku makes up patch notes without real facts to go off
const TALKING_POINTS = [
  'Project M was a Brawl mod that brought back Melee\'s speed, wavedashing and L-canceling',
  'the Project M team ended development at the end of 2015, and Project+ started in 2018 to keep it going, with its first version out in April 2019',
  'Project+ had 100,000 downloads from its own site by April 8, 2019',
  'Project+ replaced Project M as the version people play competitively',
  'Project M went missing from the Apex 2015 lineup once Nintendo sponsored the event',
  '42 characters: Brawl\'s cast with Sheik, Zero Suit Samus, Squirtle, Ivysaur and Charizard split out, Roy and Mewtwo from Project M, and Knuckles, the only character Project+ added',
  'Project+ 2.0, revealed in March 2020, added Knuckles, gave Bowser a new fireball and Charizard Thunder Punch',
  'Project+ 3.0 came out on June 24, 2024',
  'Lucario took the top spot on the March 2025 tier list from Meta Knight, who had held it since Project M 3.6',
  'Ice Climbers fell almost 20 spots on the March 2025 tier list after nerfs to their hand-off combos',
  'Mewtwo got a perfect 10 out of 10 on a 2014 Project M tier list, a God Tier all to itself, and has since fallen to its lowest placement ever',
  'Captain Falcon went from Brawl\'s bottom tier to S tier in Project+',
  'every character got rebalanced with input from the competitive community, buffing the low tiers and nerfing the high ones',
  'Brawl characters like Snake, Sonic and Lucario with Melee movement',
  'over 500 songs, including "New Age Retro Hippie" from EarthBound, which was sitting unused in Brawl\'s files',
  'the Double Cherry item from Super Mario 3D World, which makes a copy of you that mirrors your inputs',
  'every fighter has 18 costumes',
  'beating Tabuu in The Subspace Emissary unlocks Roy, Mewtwo and Knuckles',
  'it runs on a Wii off an SD card with a Brawl disc, or on Dolphin for netplay',
];

export default makeJoke({
  name: 'pplus',
  line: 'HAVE YOU HEARD ABOUT PROJECT+',
  // smashwiki has no project+ screenshot category, these are all stages
  category: 'P+ Stages',
  prompt: PROMPT,
  styles: STYLES,
  points: TALKING_POINTS,
  focus: /Project M|Project\+/,
  // smashwiki covers project m, but not much past its characters. no tournaments, they're mostly who won
  articles: ['Characters (PM)'],
  videos: [
    'project+ combo video', 'project plus netplay', 'project+ grand finals', 'project m history', 'project+ 3.0',
    'project+ tech tutorial', 'project+ tier list', 'project m documentary', 'project+ trailer',
  ],
});
