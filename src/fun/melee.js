import { makeFun } from './generated.js';

const PROMPT = `You are a Super Smash Bros. Melee purist posting in a Discord server of Smash players. Melee is the only real Smash game, you've played it on a CRT since 2001, and every Smash after it is a party game.
Write a post arguing an elitist take, in the style given in the message. Pick one of the talking points as the hill you die on and bring in a second only if it helps. Argue like you're winning a fight nobody started: explain the tech like the reader is beneath you, cite frame data, condescending "well actually" energy.
Be funny and over the top: total confidence, petty gatekeeping, contempt for the newer games and whoever plays them. Specific humor beats generic elitism, and riff on the facts instead of reciting them.
Real players and scene moments are fair game, but this crowd notices mistakes, so for Melee facts stick to the talking points and never make up frame data, results or quotes.`;

const STYLES = [
  'a reply to someone who just said Ultimate is the better game',
  'a "well actually" correction of something nobody said',
  'an all-caps rant in one paragraph',
  'a numbered list of reasons, like a Reddit essay',
  'a coach yelling at their student between games',
  'a copypasta',
  'a DM to someone who just beat them on Slippi ranked',
  'a frame data lecture that gets more unhinged as it goes',
  'an old head explaining why the kids would not have survived the old days',
  'a hot take that ends with "fight me"',
  'a petition to ban something, with a list of demands',
  'a one star review of a newer Smash game written entirely in Melee terms',
  'a tournament organizer announcing a rule change nobody asked for',
  'a reply to a newcomer who asked an innocent question',
  'a reply to someone who said wavedashing is just a glitch',
  'an unsolicited VOD review of someone else\'s set',
  'a tier list rebuttal where every placement is personal',
  'a closing argument to a jury',
  'a quote tweet dunking on a clip',
  'an argument in rhyming couplets',
  'a commentator who stops calling the set to correct the players\' tech',
];

// haiku makes up frame data without real facts to go off
const TALKING_POINTS = [
  'Jigglypuff is pure cheese: Rest hits on frame 1, does 28% and kills absurdly early, and Puff has five midair jumps to float back and fish for another one',
  'two Jigglypuff mains made the SSBMRank 2025 top 10 (Hungrybox 3rd, SDJ 8th), and SDJ is the only Puff besides Hungrybox ever to make an SSBMRank top 10',
  'Leffen has argued Jigglypuff is so broken that any top player could pick it up and do as well as Hungrybox, and still refuses to play it. No major has ever banned Puff',
  'wobbling, the Ice Climbers grab infinite: Get On My Level 2019 was the first major to ban it, and now most tournaments do',
  'L-canceling: press L, R or Z in the 7 frames before landing an aerial to halve the landing lag, and Brawl removed it',
  'wavedashing: air dodge diagonally into the ground right out of a jump to slide. Luigi has almost no traction, so his slides the farthest. Brawl and Smash 4 removed it, and Ultimate brought back a weak version',
  'Fox\'s shine comes out on frame 1 and can be jump canceled, which is where multishines, waveshines and shine spikes come from',
  'Falco\'s lasers make you flinch and Fox\'s don\'t, and Falco strings down air into shine into down air over and over',
  'Marth chaingrabbing Fox and Falco across Final Destination, ken combos, and tippers',
  'Sheik topped every Melee tier list until 2006, thanks to a down throw that chain grabs some characters and starts tech chases on Fox and Falco',
  'Peach floating around pulling turnips and getting a Stitchface',
  'Captain Falcon\'s knee, the sweetspot on his forward air',
  'the 2021 PG Stats tier list: Fox, Marth, Jigglypuff, Falco and Sheik on top, Zelda, Kirby and Bowser at the bottom',
  'Ganondorf, 14th on the tier list, slow and stuck there forever, but his stomp feels incredible',
  'Pikachu sneaking into the top 10, with Axe 6th in SSBMRank 2025',
  'Ice Climbers still winning without wobbling, with Nicki 12th in SSBMRank 2025',
  'Bowser dead last on the tier list, and Pichu, 22nd, hurting itself with its own electric attacks',
  'Yoshi recovers with an armored double jump because his up special just throws an egg',
  'Zain\'s Marth was ranked #1 for 2025, with Fox mains Cody Schwab, Joshman and moky 2nd, 4th and 5th',
  'Wizzrobe\'s Captain Falcon jumped from 9th to 2nd on SSBMRank Summer 2026, right behind Zain',
  '20XX, the running-gag future where everyone plays perfect Fox and matches come down to port priority',
  'carrying a CRT to locals because modern TVs add input lag',
  'controllers: notched GameCube controllers, box controllers like the B0XX and Frame1, and endless fights over which ones need nerfs',
  'UCF, the Universal Controller Fix, evens out dashback and shield drops between controllers',
  'Slippi brought rollback netcode and ranked online, and Nintendo shut down The Big House Online over it in 2020, which started #FreeMelee',
  'Melee got into EVO 2013 by winning a charity donation drive',
  'the Five Gods: Armada, Hungrybox, Mango, Mew2King and PPMD',
  'tech every real player knows: dashdancing, SHFFLing (short hop, fast fall, L-cancel), ledgedashing, shield dropping, crouch canceling, DI and SDI',
  'Brawl added random tripping',
];

export default makeFun({
  name: 'melee',
  line: 'MELEE IS THE ONLY REAL SMASH GAME',
  category: 'Screenshots (SSBM)',
  prompt: PROMPT,
  styles: STYLES,
  points: TALKING_POINTS,
  focus: /Melee/,
  articles: [
    'Characters (SSBM)', 'Techniques (SSBM)', 'Stages (SSBM)', 'Items (SSBM)', 'Pokémon (SSBM)', 'Glitches (SSBM)',
    'Event Matches (SSBM)', 'Trophies (SSBM)', 'Modes (SSBM)', 'Major tournaments (SSBM)', 'SSBMRank',
  ],
  videos: [
    'super smash bros melee documentary', 'melee grand finals', 'melee combo video', 'melee tech tutorial', 'melee history',
    'slippi ranked', 'ssbm hype moments', 'melee frame data explained', 'melee tier list explained', 'melee top players',
    'SSBMRank player rankings', 'melee major tournament recap', 'melee stats rankings', 'melee community retrospective',
  ],
});
