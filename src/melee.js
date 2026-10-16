import { makeJoke } from './joke.js';

const PROMPT = `You are a Super Smash Bros. Melee purist posting in a Discord server of Smash players. Melee is the only real Smash game, you've played it on a CRT since 2001, and every Smash after it is a party game.
Write a post arguing an elitist take, in the style given in the message. Pick one of the talking points as the hill you die on and bring in a second only if it helps. Argue like you're winning a fight nobody started: explain the tech like the reader is beneath you, cite frame data, condescending "well actually" energy.
Be funny and over the top: total confidence, petty gatekeeping, contempt for the newer games and whoever plays them. Specific jokes beat generic elitism, and riff on the facts instead of reciting them.
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
  'two Jigglypuff mains made the SSBMRank 2025 top 10 (Hungrybox 3rd, SDJ 8th), the first time since 2008',
  'Leffen has publicly called for a Jigglypuff ban after losing to Hungrybox',
  'wobbling, the Ice Climbers grab infinite, has been banned at most tournaments since 2019',
  'L-canceling: press L, R or Z in the 7 frames before landing an aerial to halve the landing lag, and Brawl removed it',
  'wavedashing: air dodge diagonally into the ground right out of a jump to slide. Luigi has almost no traction, so his slides the farthest. Brawl and Smash 4 removed it, and Ultimate brought back a weak version',
  'Fox\'s shine comes out on frame 1 and can be jump canceled, which is where multishines, waveshines and shine spikes come from',
  'Falco\'s lasers make you flinch and Fox\'s don\'t, and Falco\'s pillar combos go down air, shine, down air, again',
  'Marth chaingrabbing Fox and Falco across Final Destination, ken combos, and tippers',
  'Sheik\'s down throw regrab on Fox was so strong early on that people argued about banning it',
  'Peach floating around pulling turnips and getting a Stitchface',
  'Captain Falcon\'s knee, the sweetspot on his forward air',
  'the 2021 PG Stats tier list: Fox, Marth, Jigglypuff, Falco and Sheik on top, Zelda, Kirby and Bowser at the bottom',
  'Ganondorf, 14th on the tier list, slow and stuck there forever, but his stomp feels incredible',
  'Pikachu sneaking into the top 10, with Axe 6th in SSBMRank 2025',
  'Ice Climbers still winning without wobbling, with Nicki 12th in SSBMRank 2025',
  'Pichu, Kirby and Bowser at the bottom, and Pichu hurts itself with its own electric attacks',
  'Yoshi recovers with an armored double jump because his up special just throws an egg',
  'Zain\'s Marth was ranked #1 for 2025, with Fox mains Cody Schwab, Joshman and moky 2nd, 4th and 5th',
  '20XX, the joke future where everyone plays perfect Fox and matches come down to port priority',
  'carrying a CRT to locals because modern TVs add input lag',
  'controllers: notched GameCube controllers, box controllers like the B0XX and Frame1, and endless fights over which ones need nerfs',
  'UCF, the Universal Controller Fix, evens out dashback and shield drops between controllers',
  'Slippi brought rollback netcode and ranked online, and Nintendo shut down The Big House Online over it in 2020, which started #FreeMelee',
  'Melee got into EVO 2013 by winning a charity donation drive',
  'the Five Gods: Armada, Hungrybox, Mango, Mew2King and PPMD',
  'tech every real player knows: dashdancing, SHFFLing (short hop, fast fall, L-cancel), ledgedashing, shield dropping, crouch canceling, DI and SDI',
  'Brawl added random tripping',
];

export default makeJoke({
  name: 'melee',
  line: 'MELEE IS THE ONLY REAL SMASH GAME',
  category: 'Screenshots (SSBM)',
  prompt: PROMPT,
  styles: STYLES,
  points: TALKING_POINTS,
});
