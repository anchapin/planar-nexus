#!/usr/bin/env tsx

/**
 * Verify that all cards in a decklist exist in your local card database.
 *
 * Usage:
 *   npx tsx scripts/verify-deck-in-db.ts --deck="path/to/decklist.txt" --db="path/to/my-cards.json"
 *
 * Or paste a decklist directly:
 *   npx tsx scripts/verify-deck-in-db.ts --db="./my-cards.json"
 *   (then paste the decklist and press Ctrl+D)
 */

import fs from "fs";

interface CardRecord {
  name: string;
  set: string;
  [key: string]: unknown;
}

const args = process.argv.slice(2);
const deckFile = args.find((arg) => arg.startsWith("--deck="))?.split("=")[1];
const dbFile =
  args.find((arg) => arg.startsWith("--db="))?.split("=")[1] ||
  "./my-cards.json";

const ARENA_NAME_ALIASES: Record<string, string> = {
  "A Most Helpful Weaver": "Origin of Spider-Man",
  "A Trail of Teacups": "Kraven's Last Hunt",
  "Ademi of the Silkchutes": "Spectacular Spider-Man",
  "Aggressive Symbiosis": "Alien Symbiosis",
  "Alenni, Brood Recruiter": "Silk, Web Weaver",
  "Alessos and Pras, Acrobats": "Spider-Man India",
  "Ancestral Carvings": "Pictures of Spider-Man",
  "Angler's Shield": "Biorganic Carapace",
  Arachnomania: "Spider-Verse",
  "Arala, Hedron Scaler": "Beetle, Legacy Criminal",
  "Archangler's Skyrod": "Web-Shooters",
  "Argyr, Tidal Spinner": "Spider-Byte, Web Warden",
  "Bane-Marked Leonin": "Venomized Cat",
  "Basil, Cabaretti Loudmouth": "Flash Thompson, Spider-Fan",
  "Bayo, Irritable Instructor": "Electro, Assaulting Battery",
  "Belion, the Parched": "Hydro-Man, Fluid Felon",
  "Borys, the Spider Rider": "Scarlet Spider, Ben Reilly",
  "Brako, Heartless Hunter": "Kraven the Hunter",
  "Cactarantula Saddle": "Spider-Suit",
  "Caldaia Brawlers": "Inner Demons Gangsters",
  "Cam and Farrik, Havoc Duo": "Hobgoblin, Mantled Marauder",
  "Carlo, Suave Schemer": "Prowler, Clawed Thief",
  "Carriage of Dreams": "Passenger Ferry",
  "Chizak, Apex Arachnosaur": "Spider-Rex, Daring Dino",
  "Chosen by Valgavoth": "With Great Power . . .",
  "Cirina Bargainspinner": "Sun-Spider, Nimble Webber",
  "Clandestine Work": "Risky Research",
  "Confessor's Bindings": "Rent Is Due",
  "Crash, Reckless Endrider": "Shriek, Treblemaker",
  "Crime-Scene Instructor": "Selfless Police Captain",
  "Cruel Caracals": "Kraven's Cats",
  "Damning Caress": "Venom's Hunger",
  "Darval, Whose Web Protects": "Spider-Man, Web-Slinger",
  "Data Scrubber": "Mechanical Mobster",
  "Deathflame Burst": "Electro's Bolt",
  "Demera, Soul of a Spider": "Mary Jane Watson",
  "Desecrex, Gift of Servitude": "Carnage, Crimson Chaos",
  "Detect Intrusion": "Spider-Sense",
  "Diligent Webkeepers": "Web-Warriors",
  "Dreadfang, Loathed by Fans": "Kraven, Proud Predator",
  "Drix Interception": "Amazing Acrobatics",
  "Druneth, Reviver of the Hive": "Jackal, Genius Geneticist",
  "Duskmourn's Claim": "Parker Luck",
  "Eccentric Arachnologist": "Guy in the Chair",
  "Egrix the Bile Bulwark": "Gwenom, Remorseless",
  "Error-9, Viral Node": "Living Brain, Mechanical Marvel",
  "Exclusive Nightclub": "Oscorp Industries",
  "Eztli of the Thousand Moons": "Starling, Aerial Ally",
  Fateweaver: "Radioactive Spider",
  "Favored Fighter": "Professional Wrestler",
  "Fearsome Ridgeline": "Daily Bugle Building",
  "Fire-Brained Scheme": "Heroes' Hangout",
  "Fizik, Etherium Mechanic": "Iron Spider, Stark Upgrade",
  "Freestrider Aces": "Wild Pack Squad",
  "Full-Throttle Fanatic": "Taxi Driver",
  "Galvanized Workforce": "Angry Rabble",
  "Generous Betty Wray": "Silver Sable, Mercenary Leader",
  "Giantcraft Helm": "Doc Ock's Tentacles",
  "Gloria, the Great Armorer": "Araña, Heart of the Spider",
  "Goro Rel, Scourge to Spiders": "Spider-Slayer, Hatred Honed",
  "Hex of Undeath": "Behold the Sinister Six!",
  "Hide in Mundanity": "Spider-Man No More",
  "Janai and Hoppy, Roofskippers": "Spider-Girl, Legacy Hero",
  "Kavaero, Mind-Bitten": "Superior Spider-Man",
  "Kazuo, Ruthless Rival": "Shocker, Unshakable",
  "Kephon, Rage Incubator": "Stegron the Dinosaur Man",
  "King of the Coldblood Curse": "Lizard, Connors's Curse",
  "Kivni, Orb Weaver": "Scarlet Spider, Kaine",
  "Knife Trick": "Pumpkin Bombardment",
  "Kraza, the Swarm as One": "Spider-Punk",
  "Kroble, Envoy of the Bog": "Spider-Man Noir",
  "Kumonosu, the Watchful": "SP//dr, Piloted by Peni",
  "Lavaborn Goblins": "Raging Goblinoids",
  "Lavabrink Repels the Magmaloth": "Maximum Carnage",
  "Lazlo, Enthusiastic Accuser": "J. Jonah Jameson",
  "Leyline Weaver": "Spider Manifestation",
  "Lively Leap": "Thwip!",
  "Lost in Littjara": "The Clone Saga",
  "Luis, Pompous Pillager": "Morlun, Devourer of Spiders",
  "Makdee and Itla, Skysnarers": "Spider-Woman, Stunning Savior",
  "Margot, On the Case": "Wraith, Vicious Vigilante",
  "Merata, Neuron Hacker": "Lady Octopus, Inspired Inventor",
  "Miasmic Mist": "Sandman's Quicksand",
  "Mothwing Shroud": "Web Up",
  "Neach, Pinnacle Pariah": "Doctor Octopus, Master Planner",
  "Nill, Vessel of Valgavoth": "Tombstone, Career Criminal",
  "Nu and Sumi, Career Criminals": "Green Goblin, Revenant",
  "Obscura Alleylurkers": "Doc Ock's Henchmen",
  "Olx, Mouth to Many Eyes": "Madame Web, Clairvoyant",
  "Opulent Valet": "News Helicopter",
  "Orris, Last of the Web Lords": "Ezekiel Sims, Spider-Totem",
  "Outsmart the Amateur": "School Daze",
  "Ozor, Chronicler of Collapse": "Doc Ock, Sinister Scientist",
  "Perfected Pastry": "Bagel and Schmear",
  "Perilous Lunge": "Kapow!",
  "Phantasmal Vision": "Mysterio's Phantasm",
  "Phenomena Recorder": "Peter Parker's Camera",
  "Pinnacle Research Team": "Oscorp Research Team",
  "Principled Referee": "Daily Bugle Reporters",
  "Qoneus, Horizon Splicer": "The Spot, Living Portal",
  "Quint's Insight": "Shadow of the Goblin",
  "Reality Fulcrum": "Interdimensional Web Watch",
  "Remarkable Readings": "Friendly Neighborhood",
  "Remorseless Coup": "The Spot's Portal",
  "Restless Razorkin": "Superior Foes of Spider-Man",
  "Rhilex the Accursed": "Agent Venom",
  "Rishei, Getaway Accomplice": "Vulture, Scheming Scavenger",
  "Rizna, the Spider-Crowned": "Spinneret and Spiderling",
  "Rouse the Swarm": "Wall Crawl",
  "Ruzic, Booed but Victorious": "Ultimate Green Goblin",
  "Sadistic String-Puller": "Spider-Islanders",
  "Sarn of the Silken Throne": "Spider-UK",
  "Scions of the Ur-Spider": "Cosmic Spider-Man",
  "Scorvus Ames, Crimelord": "Scorpion, Seething Striker",
  "Scuttling Spidercoach": "Spider-Mobile",
  "Selesnya Archivist": "Damage Control Crew",
  "Skittering Kitten": "Masked Meower",
  "Skv'x the Augmenter": "Symbiote Spider-Man",
  "Snatch Back": "Whoosh!",
  "Spectral Restitching": "Hide on the Ceiling",
  "Steelweb Surveyor": "Spider-Bot",
  "Stitcher's Wings": "Rocket-Powered Goblin Glider",
  "Tarantusk, Unwisely Awoken": "Spider-Ham, Peter Porker",
  "Tearle, Entropic Hunger": "Morbius the Living Vampire",
  "Temple Trap": "Steel Wrecking Ball",
  "Tethex, Gift of Malice": "Venom, Evil Unleashed",
  "The Clutter Cluster": "Spiders-Man, Heroic Horde",
  "The House Grows Hungry": "The Death of Gwen Stacy",
  "The Infernus": "Molten Man, Inferno Incarnate",
  "The Scouring Stormsoul": "Sandman, Shifting Scoundrel",
  "The Terminus of Return": "The Soul Stone",
  "The Watcher on the Road": "Mysterio, Master of Illusion",
  "Through the Omenpath": "Web of Life and Destiny",
  "Treat Trolley": "Hot Dog Cart",
  "Uharis, the Stormspinner": "Spider-Man 2099",
  "Vazin, Two-Faced Trickster": "Chameleon, Master of Disguise",
  "Verilax the Havenskin": "Anti-Venom, Horrifying Healer",
  "Vexed Bots": "Flying Octobot",
  "Vinewoven Chariot": "Subway Train",
  "Wardens of Silverweb Summit": "Spider-Gwen, Free Spirit",
  "Wekhdu, Midnight Hunter": "Swarm, Being of Bees",
  "Withar, Cocoon Keeper": "Mister Negative",
  "Wonderweave Aerialist": "Skyward Spider",
  "Wrench, Speedway Saboteur": "Black Cat, Cunning Thief",
  "Xecau, Predation's Shadow": "Rhino, Barreling Brute",
  "Yera and Oski, Weaver and Guide": "Arachne, Psionic Weaver",
  "Zan, Tunnelweb Explorer": "Spider-Man, Brooklyn Visionary",
  "Zora, Spider Fancier": "Aunt May",
};

function parseDecklistLine(
  line: string,
): { name: string; quantity: number } | null {
  const trimmedLine = line.trim();
  if (!trimmedLine) return null;
  const match = trimmedLine.match(/^(?:(\d+)\s*x?\s*)?(.+)/);
  if (!match) return null;
  const skipHeaders = [
    "sideboard",
    "deck",
    "about",
    "name",
    "mainboard",
    "maybeboard",
  ];
  let name = match[2]?.trim();
  if (!name || /^\/\//.test(name) || skipHeaders.includes(name.toLowerCase())) {
    return null;
  }
  name = name.replace(/\s*[([][A-Z0-9]{3,4}[)\]]\s*\d+.*$/i, "").trim();
  name = name.replace(/\s*[([][A-Z0-9]{3,4}[)\]]\s*$/i, "").trim();
  if (name.includes("/") && !name.includes(" // ")) {
    name = name.replace(/\s*\/\s*/g, " // ");
  }
  if (ARENA_NAME_ALIASES[name]) {
    name = ARENA_NAME_ALIASES[name];
  }
  const count = parseInt(match[1] || "1", 10);
  return { name, quantity: count };
}

function loadDatabase(path: string): Map<string, CardRecord[]> {
  if (!fs.existsSync(path)) {
    console.error(`Database file not found: ${path}`);
    process.exit(1);
  }

  const cards: CardRecord[] = JSON.parse(fs.readFileSync(path, "utf-8"));
  const map = new Map<string, CardRecord[]>();

  for (const card of cards) {
    const lower = card.name.toLowerCase();
    if (!map.has(lower)) map.set(lower, []);
    map.get(lower)!.push(card);
  }

  return map;
}

function findCard(
  db: Map<string, CardRecord[]>,
  name: string,
): CardRecord[] | null {
  // Exact match
  const exact = db.get(name.toLowerCase());
  if (exact) return exact;

  // DFC front-face match (e.g. "Serah Farron" matches "Serah Farron // Crystallized Serah")
  for (const [key, cards] of db) {
    if (key.includes(" // ")) {
      const frontFace = key.split(" // ")[0].trim();
      if (frontFace === name.toLowerCase()) {
        return cards;
      }
    }
  }

  return null;
}

function main() {
  console.log(`Loading database: ${dbFile}`);
  const db = loadDatabase(dbFile);
  console.log(`Loaded ${db.size} unique card names.\n`);

  let deckText: string;

  if (deckFile) {
    if (!fs.existsSync(deckFile)) {
      console.error(`Deck file not found: ${deckFile}`);
      process.exit(1);
    }
    deckText = fs.readFileSync(deckFile, "utf-8");
  } else {
    console.log(
      "Reading decklist from stdin (paste your decklist, then press Ctrl+D):",
    );
    deckText = fs.readFileSync(0, "utf-8");
  }

  const lines = deckText.split("\n");
  const deckCards: { name: string; quantity: number }[] = [];

  for (const line of lines) {
    const parsed = parseDecklistLine(line);
    if (parsed) deckCards.push(parsed);
  }

  const found: { name: string; quantity: number; prints: number }[] = [];
  const missing: { name: string; quantity: number }[] = [];

  for (const card of deckCards) {
    const matches = findCard(db, card.name);
    if (matches) {
      found.push({
        name: card.name,
        quantity: card.quantity,
        prints: matches.length,
      });
    } else {
      missing.push(card);
    }
  }

  console.log("━".repeat(50));
  console.log(`DECK VERIFICATION RESULTS`);
  console.log(`Total unique cards in decklist: ${deckCards.length}`);
  console.log(`Found in database: ${found.length}`);
  console.log(`Missing from database: ${missing.length}`);
  console.log("━".repeat(50));

  if (found.length > 0) {
    console.log("\n✅ FOUND CARDS:");
    for (const card of found) {
      const printInfo = card.prints > 1 ? ` (${card.prints} printings)` : "";
      console.log(`  ${card.quantity}x ${card.name}${printInfo}`);
    }
  }

  if (missing.length > 0) {
    console.log("\n❌ MISSING CARDS (not in database):");
    for (const card of missing) {
      console.log(`  ${card.quantity}x ${card.name}`);
    }
    console.log("\n💡 To fix missing cards:");
    console.log("   1. Check if the card name is spelled correctly");
    console.log(
      "   2. The card might be from a very new set not yet on Scryfall",
    );
    console.log(
      "   3. Try re-running: npx tsx scripts/fetch-cards-for-db.ts --format=standard",
    );
    console.log(
      "   4. Or fetch a broader format: npx tsx scripts/fetch-cards-for-db.ts --format=modern --limit=30000",
    );
  }

  console.log("");
}

main();
