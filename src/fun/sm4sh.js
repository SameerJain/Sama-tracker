import { makeFun } from './generated.js';

const PROMPT = `You are a competitive Super Smash Bros. for Wii U player and the game's biggest fan, posting in a Discord server of Smash players.
Write a post about how much you love the game, in the style given in the message. Talk about it the way a competitive player would: the gameplay, the meta, the tournaments, the community. Let that show instead of announcing it.
Be funny and over the top: absurd exaggeration, unhinged devotion, petty jabs at the other Smash games. Specific humor beats generic hype.
Build it around one or two of the talking points in the message, not all of them. Real players and scene moments are fair game when the source material names them.
This crowd notices mistakes, so for Smash 4 specifics stick to the talking points. Ice Climbers, Snake, Wolf and Pokemon Trainer aren't in Smash 4, and Smash Run is only on 3DS.`;

const STYLES = [
  'an all-caps hype rant in one paragraph',
  'a love letter that starts "Dear Smash 4," and gets way too emotional',
  'a numbered top 3',
  'a commentator losing it over a hype moment as if it is happening live',
  'a short rhyming poem',
  'a copypasta',
  'an old head telling the kids how good they had it',
  'a hot take that ends with "fight me"',
  'a dating profile for the game',
  'a winner\'s interview after taking a major',
  'two or three haiku',
  'a five star review',
  'a gushing superfan defending it as the best Smash ever like someone just said otherwise: an over-the-top opener, two or three short bolded bullet point reasons, then a sign-off, under 130 words',
];

// the shared ones in generated.js that fit a fan who loves it way too much
const SCENARIOS = [
  'support', 'grandparent', 'breakup', 'candidate', 'streamer', 'youtubeScript', 'gamesSite', 'trailer', 'scene', 'newsInterview',
  'disasterReporter', 'parent', 'firstContact', 'alien', 'archaeologist', 'radioCaller', 'subway', 'xFriend', 'professor', 'hostage',
  'argument',
];

// haiku mixes up the smash games without real facts to go off
const TALKING_POINTS = [
  'Ryu as DLC, with real fighting game inputs that make his specials stronger',
  'Diddy Kong\'s down throw to up air, the hoo-hah, ran early Smash 4 until patches toned it down',
  'Bayonetta came as DLC and became the most dominant and most complained about character, with ladder combos and Witch Time',
  'Cloud came as DLC and was top tier right away, with Limit Break and a huge sword',
  'Smash 4 was the first Smash with online balance patches, so the meta kept changing',
  'rage: the more damage you have, the harder your hits launch',
  'ledge trumping: grabbing the ledge pops off whoever is already hanging there',
  'perfect pivoting, a tricky movement tech for spacing',
  'Sheik, with needles, Bouncing Fish and fast aerials, was one of the best characters for much of the game',
  'Rosalina & Luma being a nightmare early on, two fighters at once',
  'Mewtwo returning as DLC',
  'newcomers like Greninja, Shulk, Mega Man, Pac-Man, Villager and Duck Hunt',
  'custom moves were tournament legal for a few months in 2015, then got banned after EVO 2015',
  'starter stages like Battlefield, Final Destination, Smashville, Town and City and Lylat Cruise',
  '8-Player Smash on the Wii U',
  'For Glory, the online mode with no items on Final Destination and Omega stages, where people ground out 1v1s. It\'s been gone since Nintendo Network shut down in April 2024',
  'Nintendo made a GameCube controller adapter for the Wii U just for this game',
  'Little Mac: a monster on the ground, a rock off stage',
  'a slower, more defensive neutral than Melee, all patience, shields and reads',
  'big events like Genesis, CEO, EVO, The Big House, 2GG and Umebura in Japan',
];

export default makeFun({
  name: 'sm4sh',
  line: 'I LOVE SMASH BROS FOR WII U',
  category: 'Screenshots (SSB4-Wii U)',
  prompt: PROMPT,
  styles: STYLES,
  scenarios: SCENARIOS,
  points: TALKING_POINTS,
  focus: /Smash 4|Wii U|SSB4/,
  // the wii u ones where there's a split
  articles: [
    'Characters (SSB4)', 'Techniques (SSB4)', 'Stages (SSB4-Wii U)', 'Items (SSB4)', 'Pokémon (SSB4)', 'Glitches (SSB4)',
    'Final Smashes (SSB4)', 'Event Matches (SSB4-Wii U)', 'Trophies (SSB4-Wii U)', 'Update lists (SSB4-Wii U)', 'Modes (SSB4-Wii U)',
    'Major tournaments (SSB4)', 'PGR',
  ],
  videos: [
    'smash 4 wii u combo video', 'smash 4 grand finals', 'smash 4 hype moments', 'smash 4 bayonetta', 'smash wii u for glory',
    'smash 4 tier list', 'smash 4 retrospective', 'smash 4 tech tutorial', 'smash 4 cloud', 'smash 4 patch',
    'smash 4 PGR rankings', 'smash 4 major tournament recap', 'smash 4 competitive history', 'smash 4 community retrospective',
  ],
});
