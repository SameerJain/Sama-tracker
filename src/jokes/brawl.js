import { makeJoke } from './joke.js';

const PROMPT = `You are a Super Smash Bros. Brawl player posting in a Discord server of Smash players, and the last person alive still defending Brawl. You've loved it since it came out on the Wii in 2008 and you won't hear a word against it.
Write a post defending Brawl, in the style given in the message. Build it around one or two of the talking points. Take whatever people hate about it and argue, completely sincerely, that it was actually a strength, with the argument getting shakier as it goes.
Be funny: defensive, delusional, a little wounded, sure everyone else just didn't get it. Specific jokes beat generic coping, and riff on the facts instead of reciting them.
Real players and scene moments are fair game, but this crowd notices mistakes, so for Brawl facts stick to the talking points and never make up frame data, results or quotes.`;

const STYLES = [
  'a reply to someone who just said Brawl killed competitive Smash',
  'a TED talk',
  'a numbered list of reasons Brawl was the best one',
  'an all-caps rant in one paragraph',
  'a copypasta',
  'a defense attorney\'s closing argument',
  'a hot take that ends with "fight me"',
  'a five star review that admits nothing',
  'a press release from Brawl\'s PR team doing damage control',
  'a reply to a Melee player, staying extremely polite',
  'a nature documentary narrator describing a Meta Knight in the wild',
  'a tier list explanation where every placement is a compliment',
  'a 2008 forum post, signature and all',
  'a commentator hyping up the slowest set ever played',
  'an apology letter on behalf of everyone who was ever mean to Brawl',
  'a short rhyming poem',
  'two or three haiku',
];

// haiku makes up results without real facts to go off
const TALKING_POINTS = [
  'random tripping: a 1% chance to fall over whenever you start a dash, and 1.25% when you turn around in a run',
  'Meta Knight alone in SS tier on the last tier list in 2013, with five midair jumps, a glide, Mach Tornado and a recovery that is nearly impossible to edgeguard',
  'Meta Knight won $42,394 of 2011 US tournament prize money when it was split by character. Snake was next with $12,125',
  'at KTAR 6, five of the top eight used Meta Knight',
  'the Unity Ruleset Committee banned Meta Knight starting January 2012, disbanded that April, and most tournaments went back to allowing him',
  'after the Meta Knight ban, the Melee Back Room jokingly banned Meta Knight from Melee too',
  'Ice Climbers 2nd on the tier list, with chain grabs that turn one grab into a stock',
  'Diddy Kong and his banana peels, 4th on the tier list',
  'Snake and Sonic were the first third-party fighters in Smash, and tapping down taunt on Shadow Moses Island starts one of Snake\'s codec calls',
  'Ganondorf finished dead last on the tier list',
  'Salem won Apex 2013 with Zero Suit Samus, and nobody saw it coming',
  'planking: hanging on the ledge to run out the clock, until tournaments added ledge grab limits',
  'Sakurai took out wavedashing and L-canceling because he thought they made the gap between new and advanced players too big',
  'hitstun canceling lets you air dodge out of combos early, so true combos are rare',
  'DACUS, the dash attack canceled up smash, which sends Snake sliding across the stage',
  'glide tossing: throwing an item out of a roll to slide',
  'The Subspace Emissary, the story mode with cutscenes, an army of R.O.B.s and Tabuu at the end',
  'Final Smashes and the Smash Ball came in Brawl',
  'Sakurai\'s Smash Bros. DOJO!! site posting something new almost every day before launch',
  'online lag, and Nintendo Wi-Fi Connection shutting down in May 2014',
  'the main theme by Nobuo Uematsu, with Latin lyrics',
  'Project M started as a Brawl mod, so Brawl technically gets credit for it',
];

export default makeJoke({
  name: 'brawl',
  line: 'BRAWL WAS GOOD ACTUALLY',
  category: 'Screenshots (SSBB)',
  prompt: PROMPT,
  styles: STYLES,
  points: TALKING_POINTS,
  focus: /Brawl\b/,
  articles: [
    'Characters (SSBB)', 'Techniques (SSBB)', 'Stages (SSBB)', 'Items (SSBB)', 'Pokémon (SSBB)', 'Glitches (SSBB)',
    'Final Smashes (SSBB)', 'Event Matches (SSBB)', 'Trophies (SSBB)', 'Modes (SSBB)', 'Major tournaments (SSBB)',
  ],
  videos: [
    'super smash bros brawl retrospective', 'brawl meta knight', 'brawl grand finals', 'brawl tripping', 'subspace emissary',
    'brawl combo video', 'brawl tier list', 'brawl planking', 'brawl glitches', 'brawl competitive history',
  ],
});
