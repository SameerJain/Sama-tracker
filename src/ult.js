import { makeJoke } from './joke.js';

const PROMPT = `You are a competitive Super Smash Bros. Ultimate player posting in a Discord server of Smash players. You've played it almost every day since it came out in December 2018, you hate it, and you are never going to stop.
Write a post complaining about the game, in the style given in the message. Build it around one or two of the talking points and gripe like a burnt-out tournament grinder: the meta, the characters, the top players, online, Nintendo.
Be funny: bitter, exhausted, dramatic, petty. The joke is that you keep playing out of pure habit, so let that slip somewhere, a different way each time. Specific jokes beat generic complaining, and riff on the facts like someone who lives in this game instead of reciting them.
Real players and scene moments are fair game, but this crowd notices mistakes, so for Ultimate facts stick to the talking points and never make up results, patch notes or quotes.`;

const STYLES = [
  'a resignation letter to the game, with a P.S. that they are queueing anyway',
  'a 3am rant right after losing to a Steve online',
  'a numbered list of grievances',
  'a support group share that starts "Hi, my name is"',
  'a one star review that mentions thousands of hours played',
  'an all-caps rant in one paragraph',
  'a copypasta',
  'a breakup text to the game',
  'a commentator who is completely over it, calling a set',
  'a hot take that ends with "fight me"',
  'a short, sad poem',
  'a dating profile for the game with every red flag listed',
  'an old head saying the game was better in 2019',
  'a reply to a friend asking if they want to play tonight',
  'a reply to someone who said Ultimate is in a good place',
  'a letter to Sakurai begging for one more balance patch',
  'an exit interview after quitting for the fifth time',
  'a winner\'s interview after taking a major, sounding miserable',
  'a group chat message at 2am that keeps going',
  'a tier list explanation where every placement is a grudge',
  'two or three bitter haiku',
];

// haiku makes up patches and results without real facts to go off
const TALKING_POINTS = [
  'Steve mines blocks, crafts tools, drops anvils, minecart grabs people and blows them up with TNT',
  'three of the UltRank 2025 top 10 main Steve: acola 3rd, Syrup 7th, Carmelo 9th',
  'Steve camping the ledge with down tilt flames, blocks and TNT',
  'Phantom MLG, a Steve block cancel found in 2023, got him banned at a bunch of tournaments',
  'Steve\'s only real nerf ever was a small up smash change in 13.0.1',
  'the last balance patch was 13.0.1 in December 2021, so the meta has been frozen for years',
  'Sora in October 2021 was the last fighter ever added',
  'Kazuya takes a stock in a couple of touches with his 10-hit combo and Electric Wind God Fist',
  'Hero\'s Command Selection is RNG, and it rolls Thwack or Hocus Pocus at the worst time',
  'Doramigi, a Min Min and Hero player, was ranked #1 in UltRank 2025',
  'Min Min zoning with ARMS from across the stage and edgeguarding from the middle of it',
  'Sonic getting a lead and running away for the rest of the game; Sonix\'s Sonic was 6th in UltRank 2025',
  'Snake camping with grenades and C4; Hurt, a Snake main, was 4th in UltRank 2025',
  'R.O.B. players and their gyro, with Zomba 8th in UltRank 2025',
  'Pyra and Mythra everywhere',
  'MkLeo, long called the best Ultimate player ever, finished 2025 ranked 14th',
  'Light is the only Fox main in the UltRank 2025 top 20, at 16th',
  'six of the UltRank 2025 top 10 are from Japan',
  'online: Elite Smash, GSP, input delay, wifi players and Quickplay ignoring your preferred rules',
  'every character has had the same 3 frame jumpsquat since launch',
  'Nintendo shut down Smash World Tour in 2022, and its 2023 tournament guidelines cap unlicensed events at 200 entrants in person and $5,000 in prizes',
  'Ganondorf and Sheik waiting on buffs that are never coming',
  'Pikachu, Wolf, Joker and Palutena players getting carried by their character',
  'Melee players still calling Ultimate a party game',
];

export default makeJoke({
  name: 'ult',
  line: 'I HATE SMASH BROS ULTIMATE',
  category: 'Screenshots (SSBU)',
  prompt: PROMPT,
  styles: STYLES,
  points: TALKING_POINTS,
});
