#!/usr/bin/env node
// Writes a realistic, C4-shaped fixture into site/public/data/ so the site can be built and
// developed before the warehouse export exists. Data values are deterministic (seeded RNG);
// timestamps are anchored to "now" so freshness looks realistic.
//
// Usage: npm run fixture                 normal market: 30 days, 4 complete scans/day, newest scan partial
//        npm run fixture -- --no-complete  only partial scans exist yet
//        npm run fixture -- --days 1       only N days of complete scans (default 12; try 1 or 2 for
//                                          the dashboard's "not enough history" states)
//
// Shape follows docs/contracts.md C4 v4 exactly. Anything the contract leaves open is decided
// here and marked FIXTURE-CHOICE so it can be checked against the real export later.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const DATA = join(here, '..', 'public', 'data')
const SLUG = 'icecrown-alliance'
const REALM = 'Icecrown'
const FACTION = 'Alliance'
const MARKET_DIR = join(DATA, SLUG)
const NO_COMPLETE = process.argv.includes('--no-complete')
// FIXTURE-CHOICE: 12 days of complete scans by default, so the 7d extremes window is full and the
// 30d window (needs 15 days) is still short, as on the real site in its first weeks.
const daysArg = process.argv.indexOf('--days')
const HISTORY_DAYS = daysArg > 0 ? Math.max(1, Number(process.argv[daysArg + 1]) || 12) : 12

// ---------- deterministic RNG ----------
let seed = 0x5eed1234
function rand() {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = (a) => a[Math.floor(rand() * a.length)]
const between = (lo, hi) => lo + rand() * (hi - lo)
const intBetween = (lo, hi) => Math.floor(between(lo, hi + 1))
function gauss() {
  let u = 0
  while (u === 0) u = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}
function poisson(lambda) {
  if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * gauss()))
  const L = Math.exp(-lambda)
  let k = 0
  let p = 1
  do {
    k++
    p *= rand()
  } while (p > L)
  return k - 1
}
const G = 10000
const S = 100

// ---------- item catalogue ----------
// [itemId, name, quality, class, subclass, basePriceCopper, stackMax, activity(listings/scan), ilvl, req]
const items = []
function add(id, suffix, name, quality, cls, sub, price, stackMax, activity, ilvl, req, equipLoc = '') {
  items.push({ id, suffix, name, quality, cls, sub, price, stackMax, activity, ilvl, req, equipLoc })
}

const tradeGoods = [
  [36905, 'Lichbloom', 'Herb', 8 * G, 30],
  [36906, 'Icethorn', 'Herb', 9 * G, 25],
  [36903, "Adder's Tongue", 'Herb', 5 * G, 20],
  [36901, 'Goldclover', 'Herb', 2 * G, 25],
  [36904, 'Tiger Lily', 'Herb', 2 * G + 50 * S, 22],
  [36907, "Talandra's Rose", 'Herb', 3 * G, 18],
  [36908, 'Frost Lotus', 'Herb', 38 * G, 12],
  [37921, 'Deadnettle', 'Herb', 1 * G + 20 * S, 15],
  [36912, 'Saronite Ore', 'Metal & Stone', 3 * G, 35],
  [36910, 'Titanium Ore', 'Metal & Stone', 22 * G, 15],
  [36909, 'Cobalt Ore', 'Metal & Stone', 1 * G + 50 * S, 15],
  [36913, 'Saronite Bar', 'Metal & Stone', 7 * G, 14],
  [41163, 'Titanium Bar', 'Metal & Stone', 48 * G, 6],
  [37663, 'Titansteel Bar', 'Metal & Stone', 145 * G, 4],
  [36916, 'Cobalt Bar', 'Metal & Stone', 3 * G, 8],
  [33470, 'Frostweave Cloth', 'Cloth', 90 * S, 40],
  [41510, 'Bolt of Frostweave', 'Cloth', 3 * G + 20 * S, 12],
  [41511, 'Bolt of Imbued Frostweave', 'Cloth', 18 * G, 6],
  [41594, 'Moonshroud', 'Cloth', 95 * G, 3],
  [41593, 'Ebonweave', 'Cloth', 80 * G, 3],
  [41595, 'Spellweave', 'Cloth', 88 * G, 3],
  [33568, 'Borean Leather', 'Leather', 2 * G + 40 * S, 25],
  [44128, 'Arctic Fur', 'Leather', 32 * G, 8],
  [38425, 'Heavy Borean Leather', 'Leather', 14 * G, 8],
  [34054, 'Infinite Dust', 'Enchanting', 4 * G + 50 * S, 30],
  [34055, 'Greater Cosmic Essence', 'Enchanting', 16 * G, 18],
  [34052, 'Dream Shard', 'Enchanting', 22 * G, 15],
  [34057, 'Abyss Crystal', 'Enchanting', 27 * G, 12],
  [35627, 'Eternal Shadow', 'Elemental', 9 * G, 12],
  [36860, 'Eternal Fire', 'Elemental', 14 * G, 12],
  [35625, 'Eternal Life', 'Elemental', 11 * G, 12],
  [35622, 'Eternal Water', 'Elemental', 6 * G, 10],
  [35623, 'Eternal Air', 'Elemental', 7 * G, 10],
  [35624, 'Eternal Earth', 'Elemental', 4 * G, 10],
  [37701, 'Crystallized Earth', 'Elemental', 45 * S, 10],
  [37705, 'Crystallized Water', 'Elemental', 70 * S, 10],
  [43102, 'Frozen Orb', 'Elemental', 18 * G, 10],
  [39151, 'Alabaster Pigment', 'Parts', 50 * S, 10],
  [43103, 'Verdant Pigment', 'Parts', 2 * G, 8],
  [39334, 'Dusky Pigment', 'Parts', 80 * S, 8],
  [39343, 'Azure Pigment', 'Parts', 1 * G + 10 * S, 14],
  [43109, 'Icy Pigment', 'Parts', 9 * G, 10],
  [43126, 'Ink of the Sea', 'Parts', 3 * G, 16],
  [43127, 'Snowfall Ink', 'Parts', 21 * G, 8],
  [43012, 'Rhino Meat', 'Meat', 1 * G, 8],
  [43013, 'Chilled Meat', 'Meat', 1 * G + 40 * S, 10],
  [41809, 'Glacial Salmon', 'Meat', 1 * G + 10 * S, 8],
  [41813, 'Nettlefish', 'Meat', 2 * G, 8],
  [41806, 'Musselback Sculpin', 'Meat', 1 * G + 60 * S, 6],
  [41800, 'Deep Sea Monsterbelly', 'Meat', 3 * G, 6],
]
for (const [id, name, sub, price, act] of tradeGoods) {
  add(id, 0, name, 1, 'Trade Goods', sub, price, 20, act, 70, 0)
}
// a few uncommon/rare trade goods
add(45087, 0, 'Runed Orb', 3, 'Trade Goods', 'Other', 160 * G, 20, 2, 80, 0)
add(47556, 0, 'Crusader Orb', 4, 'Trade Goods', 'Other', 420 * G, 20, 2, 80, 0)
add(49908, 0, 'Primordial Saronite', 4, 'Trade Goods', 'Other', 1600 * G, 20, 1.2, 80, 0)

const consumables = [
  [46376, 'Flask of the Frost Wyrm', 'Flask', 32 * G, 14],
  [46377, 'Flask of Endless Rage', 'Flask', 30 * G, 12],
  [46378, 'Flask of Pure Mojo', 'Flask', 22 * G, 6],
  [46379, 'Flask of Stoneblood', 'Flask', 26 * G, 6],
  [40211, 'Potion of Speed', 'Potion', 6 * G, 14],
  [40212, 'Potion of Wild Magic', 'Potion', 5 * G + 50 * S, 10],
  [33447, 'Runic Healing Potion', 'Potion', 2 * G + 20 * S, 12],
  [33448, 'Runic Mana Potion', 'Potion', 3 * G, 12],
  [40093, 'Indestructible Potion', 'Potion', 4 * G, 5],
  [44325, 'Elixir of Accuracy', 'Elixir', 3 * G + 50 * S, 5],
  [44330, 'Elixir of Armor Piercing', 'Elixir', 4 * G, 4],
  [39666, 'Elixir of Mighty Agility', 'Elixir', 5 * G, 6],
  [40078, 'Elixir of Mighty Fortitude', 'Elixir', 3 * G, 4],
  [43015, 'Fish Feast', 'Food & Drink', 28 * G, 10],
  [34753, 'Great Feast', 'Food & Drink', 9 * G, 3],
  [42999, 'Blackened Dragonfin', 'Food & Drink', 3 * G + 50 * S, 6],
  [34758, 'Mighty Rhino Dogs', 'Food & Drink', 2 * G, 5],
  [43001, 'Dragonfin Filet', 'Food & Drink', 3 * G, 6],
  [41119, 'Saronite Bomb', 'Explosives', 1 * G + 50 * S, 3],
  [44986, 'Scroll of Strength VIII', 'Scroll', 1 * G + 20 * S, 4],
  [43466, 'Scroll of Agility VIII', 'Scroll', 1 * G + 50 * S, 4],
  [41611, 'Eternal Belt Buckle', 'Other', 21 * G, 8],
  [38682, 'Enchanting Vellum', 'Other', 1 * G + 10 * S, 6],
  [37602, 'Armor Vellum III', 'Other', 2 * G, 6],
  [44957, 'Greater Inscription of the Gladiator', 'Item Enhancement', 75 * G, 2],
]
for (const [id, name, sub, price, act] of consumables) {
  add(id, 0, name, 1, 'Consumable', sub, price, 20, act, 75, 70)
}

// gems: raw and cut, uncommon (cheap), rare, epic
const gemColors = {
  Red: ['Bold', 'Bright', 'Delicate', 'Runed', 'Subtle', 'Flashing', 'Precise'],
  Yellow: ['Rigid', 'Smooth', 'Quick', 'Brilliant', 'Mystic'],
  Blue: ['Solid', 'Sparkling', 'Lustrous', 'Stormy'],
  Orange: ['Inscribed', 'Etched', 'Fierce', 'Glinting', 'Luminous', 'Potent', 'Reckless', 'Deadly'],
  Purple: ['Shifting', 'Sovereign', 'Glowing', 'Purified', 'Guardian\'s', 'Tenuous', 'Timeless'],
  Green: ['Jagged', 'Forceful', 'Misty', 'Seer\'s', 'Vivid', 'Energized'],
}
const gemNames = {
  Red: ['Bloodstone', 'Scarlet Ruby', 'Cardinal Ruby'],
  Yellow: ['Sun Crystal', 'Autumn\'s Glow', 'King\'s Amber'],
  Blue: ['Chalcedony', 'Sky Sapphire', 'Majestic Zircon'],
  Orange: ['Huge Citrine', 'Monarch Topaz', 'Ametrine'],
  Purple: ['Shadow Crystal', 'Twilight Opal', 'Dreadstone'],
  Green: ['Dark Jade', 'Forest Emerald', 'Eye of Zul'],
}
let gemId = 39900
for (const [color, cuts] of Object.entries(gemColors)) {
  const [unc, rare, epic] = gemNames[color]
  add(gemId++, 0, unc, 2, 'Gem', 'Simple', between(20, 80) * S, 20, 6, 70, 0)
  add(gemId++, 0, rare, 3, 'Gem', 'Simple', between(10, 30) * G, 20, 10, 80, 0)
  add(gemId++, 0, epic, 4, 'Gem', 'Simple', between(110, 190) * G, 20, 5, 80, 0)
  for (const cut of cuts) {
    add(gemId++, 0, `${cut} ${rare}`, 3, 'Gem', color, between(12, 40) * G, 20, between(3, 9), 80, 0)
    if (rand() < 0.7) add(gemId++, 0, `${cut} ${epic}`, 4, 'Gem', color, between(130, 260) * G, 20, between(1, 4), 80, 0)
    if (rand() < 0.4) add(gemId++, 0, `${cut} ${unc}`, 2, 'Gem', color, between(30, 200) * S, 20, between(0.3, 2), 70, 0)
  }
}

// glyphs
const glyphs = {
  'Death Knight': ['Obliterate', 'Disease', 'Dark Death', 'Howling Blast', 'Frost Strike', 'Scourge Strike', 'Icy Touch', 'Rune Strike'],
  Druid: ['Rejuvenation', 'Swiftmend', 'Wild Growth', 'Starfire', 'Insect Swarm', 'Shred', 'Rip', 'Savage Roar'],
  Hunter: ['Steady Shot', 'Serpent Sting', 'Explosive Shot', 'Kill Shot', 'Chimera Shot', 'Aimed Shot'],
  Mage: ['Frostbolt', 'Arcane Blast', 'Molten Armor', 'Living Bomb', 'Arcane Missiles', 'Fireball', 'Ice Lance'],
  Paladin: ['Seal of Command', 'Judgement', 'Holy Light', 'Beacon of Light', 'Seal of Vengeance', 'Hammer of the Righteous', 'Divine Storm'],
  Priest: ['Penance', 'Power Word: Shield', 'Flash Heal', 'Prayer of Healing', 'Mind Flay', 'Shadow Word: Pain', 'Dispersion'],
  Rogue: ['Mutilate', 'Hunger for Blood', 'Killing Spree', 'Rupture', 'Backstab', 'Tricks of the Trade'],
  Shaman: ['Lava Burst', 'Earth Shield', 'Chain Heal', 'Lightning Bolt', 'Flame Shock', 'Stormstrike', 'Totem of Wrath'],
  Warlock: ['Life Tap', 'Haunt', 'Corruption', 'Immolate', 'Conflagrate', 'Metamorphosis', 'Shadowburn'],
  Warrior: ['Mortal Strike', 'Bladestorm', 'Whirlwind', 'Revenge', 'Devastate', 'Execution', 'Rending'],
}
let glyphId = 43300
for (const [cls, names] of Object.entries(glyphs)) {
  for (const g of names) {
    const hot = rand() < 0.25
    add(glyphId++, 0, `Glyph of ${g}`, 1, 'Glyph', cls, hot ? between(25, 90) * G : between(1, 14) * G, 20, hot ? between(2, 6) : between(1, 5), 80, between(0, 1) < 0.5 ? 15 : 70)
  }
}

// recipes / patterns (rare, sparse)
const recipes = [
  ['Pattern: Sash of Ancient Power', 'Tailoring', 900 * G],
  ['Pattern: Leggings of Woven Death', 'Tailoring', 600 * G],
  ['Plans: Titanium Spikeguards', 'Blacksmithing', 180 * G],
  ['Plans: Breastplate of the White Knight', 'Blacksmithing', 300 * G],
  ['Design: Bold Cardinal Ruby', 'Jewelcrafting', 450 * G],
  ['Design: Rigid King\'s Amber', 'Jewelcrafting', 260 * G],
  ['Formula: Enchant Weapon - Berserking', 'Enchanting', 1500 * G],
  ['Formula: Enchant Weapon - Black Magic', 'Enchanting', 1100 * G],
  ['Formula: Enchant Cloak - Wisdom', 'Enchanting', 140 * G],
  ['Recipe: Flask of the North', 'Alchemy', 40 * G],
  ['Schematic: Mekgineer\'s Chopper', 'Engineering', 350 * G],
  ['Pattern: Bracers of Swift Death', 'Leatherworking', 800 * G],
  ['Pattern: Earthsoul Boots', 'Leatherworking', 650 * G],
  ['Recipe: Mighty Rhino Dogs', 'Cooking', 2 * G],
]
let recipeId = 45500
for (const [name, sub, price] of recipes) {
  add(recipeId++, 0, name, price > 100 * G ? 4 : 3, 'Recipe', sub, price, 1, between(0.08, 0.7), 80, 75)
}

// gear with random suffixes (uncommon), BoE blues and epics
const greenBases = [
  ['Frostsaber Boots', 'Armor', 'Leather', 'INVTYPE_FEET'],
  ['Icebane Girdle', 'Armor', 'Plate', 'INVTYPE_WAIST'],
  ['Spiked Cobalt Helm', 'Armor', 'Plate', 'INVTYPE_HEAD'],
  ['Frostwoven Gloves', 'Armor', 'Cloth', 'INVTYPE_HAND'],
  ['Nerubian Shoulders', 'Armor', 'Mail', 'INVTYPE_SHOULDER'],
  ['Arctic Wristguards', 'Armor', 'Leather', 'INVTYPE_WRIST'],
  ['Tundra Ring', 'Armor', 'Miscellaneous', 'INVTYPE_FINGER'],
  ['Northern Cloak', 'Armor', 'Cloth', 'INVTYPE_CLOAK'],
  ['Vrykul Greatsword', 'Weapon', 'Two-Handed Swords', 'INVTYPE_2HWEAPON'],
  ['Dragonbone Staff', 'Weapon', 'Staves', 'INVTYPE_2HWEAPON'],
  ['Cobalt Skewer', 'Weapon', 'Daggers', 'INVTYPE_WEAPON'],
  ['Howling Fjord Bow', 'Weapon', 'Bows', 'INVTYPE_RANGED'],
  ['Kvaldir Mace', 'Weapon', 'One-Handed Maces', 'INVTYPE_WEAPON'],
]
const suffixes = [
  [-6, 'of the Bear'], [-19, 'of the Eagle'], [-33, 'of the Tiger'], [-41, 'of the Monkey'],
  [-50, 'of the Owl'], [-58, 'of the Boar'], [-66, 'of the Whale'], [-75, 'of the Falcon'],
  [-82, 'of the Wolf'], [-90, 'of Healing'], [-97, 'of Shadow Wrath'], [-103, 'of the Elder'],
]
let gearId = 36000
for (const [base, cls, sub, loc] of greenBases) {
  const id = gearId++
  const n = intBetween(2, 4)
  const used = new Set()
  for (let k = 0; k < n; k++) {
    const sfx = pick(suffixes)
    if (used.has(sfx[0])) continue
    used.add(sfx[0])
    add(id, sfx[0], `${base} ${sfx[1]}`, 2, cls, sub, between(4, 70) * G, 1, between(0.2, 1.5), intBetween(160, 187), intBetween(72, 80), loc)
  }
}
const boe = [
  ['Belt of the Titans', 'Armor', 'Plate', 'INVTYPE_WAIST', 4, 2200 * G],
  ['Pack of Endless Pockets', 'Container', 'Bag', 'INVTYPE_BAG', 4, 230 * G],
  ['Frostweave Bag', 'Container', 'Bag', 'INVTYPE_BAG', 2, 45 * G],
  ['Glacial Bag', 'Container', 'Bag', 'INVTYPE_BAG', 4, 520 * G],
  ['Mighty Frostguard Boots', 'Armor', 'Plate', 'INVTYPE_FEET', 4, 1800 * G],
  ['Deathchill Cloak', 'Armor', 'Cloth', 'INVTYPE_CLOAK', 4, 1400 * G],
  ['Wispcloak', 'Armor', 'Cloth', 'INVTYPE_CLOAK', 4, 1300 * G],
  ['Titanium Earthguard Ring', 'Armor', 'Miscellaneous', 'INVTYPE_FINGER', 4, 650 * G],
  ['Sash of Ancient Power', 'Armor', 'Cloth', 'INVTYPE_WAIST', 4, 4800 * G],
  ['Bladeborn Leggings', 'Armor', 'Leather', 'INVTYPE_LEGS', 4, 6500 * G],
  ['Ebonweave Robe', 'Armor', 'Cloth', 'INVTYPE_ROBE', 4, 900 * G],
  ['Shadowmourne Replica (fixture)', 'Weapon', 'Two-Handed Axes', 'INVTYPE_2HWEAPON', 5, 25000 * G],
  ['Titansteel Destroyer', 'Weapon', 'Two-Handed Maces', 'INVTYPE_2HWEAPON', 4, 900 * G],
  ['Titansteel Guardian', 'Weapon', 'One-Handed Maces', 'INVTYPE_WEAPON', 4, 700 * G],
  ['Cobalt Tenderizer', 'Weapon', 'One-Handed Maces', 'INVTYPE_WEAPON', 3, 30 * G],
  ['Saronite Ambusher', 'Weapon', 'Daggers', 'INVTYPE_WEAPON', 3, 60 * G],
  ['Tempered Saronite Gauntlets', 'Armor', 'Plate', 'INVTYPE_HAND', 3, 25 * G],
  ['Mammoth Mining Bag', 'Container', 'Mining Bag', 'INVTYPE_BAG', 3, 90 * G],
  ['Mechano-Hog', 'Miscellaneous', 'Mount', '', 4, 9000 * G],
  ['Reins of the Ice Mammoth (fixture)', 'Miscellaneous', 'Mount', '', 4, 14000 * G],
  ['Proto-Drake Whelp', 'Miscellaneous', 'Pet', '', 1, 700 * G],
  ['Tickbird Hatchling', 'Miscellaneous', 'Pet', '', 1, 280 * G],
  ['Mr. Chilly', 'Miscellaneous', 'Pet', '', 3, 1200 * G],
]
let boeId = 42100
for (const [name, cls, sub, loc, q, price] of boe) {
  add(boeId++, 0, name, q, cls, sub, price, 1, q >= 4 ? between(0.1, 0.9) : between(0.5, 3), q >= 4 ? 213 : 187, 80, loc)
}

// grey junk (poor) — vendor trash people still post
const junk = [
  ['Broken Fang', 15 * S], ['Ragged Pelt', 22 * S], ['Fractured Shell', 18 * S], ['Ice Shard', 30 * S],
  ['Shredded Wing', 12 * S], ['Cracked Tusk', 40 * S], ['Frozen Spleen', 35 * S], ['Crumbling Bone', 9 * S],
  ['Tattered Cloth Gloves', 1 * G + 10 * S], ['Rusty Vrykul Blade', 2 * G], ['Worn Chain Leggings', 1 * G + 70 * S],
  ['Darkmoon Card Fragment', 80 * S],
]
let junkId = 43800
for (const [name, price] of junk) {
  add(junkId++, 0, name, 0, 'Miscellaneous', 'Junk', price, 20, between(0.3, 3), 70, 0)
}

// common white items to round out the count
const commonsExtra = [
  ['Light Parchment', 'Parts', 15 * S], ['Copper Rod', 'Parts', 10 * S], ['Pristine Hide', 'Leather', 9 * G],
  ['Arctic Fur Scrap', 'Leather', 1 * G], ['Fire Leaf', 'Herb', 1 * G + 50 * S], ['Snowfall Ink Bundle', 'Parts', 20 * G],
  ['Northern Spices', 'Cooking', 40 * S], ['Chunk of Mammoth Meat', 'Meat', 70 * S], ['Shoveltusk Flank', 'Meat', 60 * S],
  ['Wyrm Meat', 'Meat', 90 * S], ['Rockfin Grouper', 'Meat', 1 * G + 20 * S], ['Imperial Manta Ray', 'Meat', 1 * G + 40 * S],
  ['Dragonfin Angelfish', 'Meat', 2 * G + 20 * S], ['Moonglow Cuttlefish', 'Meat', 90 * S], ['Fangtooth Herring', 'Meat', 1 * G],
  ['Nettlefish Filet', 'Meat', 1 * G + 70 * S], ['Fishing Lure', 'Other', 50 * S], ['Saronite Arrow', 'Other', 1 * S],
  ['Iceblade Arrow', 'Other', 2 * S], ['Mammoth Cutters', 'Other', 6 * G],
]
let commonId = 44000
for (const [name, sub, price] of commonsExtra) {
  add(commonId++, 0, name, 1, 'Trade Goods', sub, price, 20, between(0.4, 8), 70, 0)
}

// ---------- icons (C4 v3) ----------
// Real WotLK texture basenames for the real item ids above, checked against Wowhead's
// tooltip data (nether.wowhead.com/wotlk/tooltip/item/<id>) when this was written.
const REAL_ICONS = {
  33447: 'inv_alchemy_elixir_05', 33448: 'inv_alchemy_elixir_02', 33470: 'inv_fabric_soulcloth',
  33568: 'inv_misc_leatherscrap_15', 34052: 'inv_enchant_dreamshard_02', 34054: 'inv_misc_dust_infinite',
  34055: 'inv_enchant_essencecosmicgreater', 34057: 'inv_enchant_abysscrystal', 34753: 'ability_hunter_pet_boar',
  34758: 'inv_misc_food_66', 35622: 'inv_elemental_eternal_water', 35623: 'inv_elemental_eternal_air',
  35624: 'inv_elemental_eternal_earth', 35625: 'inv_elemental_eternal_life', 35627: 'inv_elemental_eternal_shadow',
  36860: 'inv_elemental_eternal_fire', 36901: 'inv_misc_herb_goldclover', 36903: 'inv_misc_herb_evergreenmoss',
  36904: 'inv_misc_herb_tigerlily', 36905: 'inv_misc_herb_whispervine', 36906: 'inv_misc_herb_icethorn',
  36907: 'inv_misc_herb_talandrasrose', 36908: 'inv_misc_herb_frostlotus', 36909: 'inv_ore_cobalt',
  36910: 'inv_ore_platinum_01', 36912: 'inv_ore_saronite_01', 36913: 'inv_ingot_yoggthorite',
  36916: 'inv_ingot_cobalt', 37602: 'inv_inscription_armorscroll02', 37663: 'inv_ingot_titansteel_blue',
  37701: 'inv_elemental_crystal_earth', 37705: 'inv_elemental_crystal_water', 37921: 'inv_misc_herb_constrictorgrass',
  38425: 'inv_misc_leatherscrap_19', 38682: 'inv_inscription_armorscroll01', 39151: 'inv_inscription_pigment_white',
  39334: 'inv_inscription_pigment_grey', 39343: 'inv_inscription_pigment_azure', 39666: 'inv_potion_162',
  40078: 'inv_potion_164', 40093: 'inv_alchemy_elixir_empty', 40211: 'inv_alchemy_elixir_04',
  40212: 'inv_alchemy_elixir_01', 41119: 'inv_misc_enggizmos_32', 41163: 'inv_ingot_platinum',
  41510: 'inv_fabric_frostweave_bolt', 41511: 'inv_fabric_frostweave_imbuedbolt', 41593: 'inv_fabric_ebonweave',
  41594: 'inv_fabric_moonshroud', 41595: 'inv_fabric_spellweave', 41611: 'inv_belt_36',
  41800: 'inv_misc_fish_60', 41806: 'inv_misc_fish_62', 41809: 'inv_misc_fish_51',
  41813: 'inv_misc_fish_72', 42999: 'inv_misc_food_142_fish', 43001: 'inv_misc_food_85_stegadonbite',
  43012: 'inv_misc_food_119_rhinomeat', 43013: 'inv_misc_food_120_sharkmeat', 43015: 'inv_misc_fish_52',
  43102: 'spell_frost_frozencore', 43103: 'inv_inscription_pigment_verdant', 43109: 'inv_inscription_pigment_icy',
  43126: 'inv_inscription_inkpurple01', 43127: 'inv_inscription_inkbluewhite01', 43466: 'inv_scroll_02',
  44128: 'inv_misc_pelt_14', 44325: 'inv_potion_61', 44330: 'inv_alchemy_potion_06',
  44957: 'inv_shoulder_61', 44986: 'inv_potion_10', 45087: 'inv_misc_runedorb_01',
  46376: 'inv_alchemy_endlessflask_04', 46377: 'inv_alchemy_endlessflask_06', 46378: 'inv_alchemy_endlessflask_03',
  46379: 'inv_alchemy_endlessflask_05', 47556: 'spell_holy_rune', 49908: 'spell_fire_felflamebreath',
}
// FIXTURE-CHOICE: synthetic ids (gems, glyphs, recipes, gear, junk, commons) get a plausible
// real texture by kind, so the images exist on the CDN.
const GEM_ICONS = {
  Red: 'inv_jewelcrafting_gem_37', Yellow: 'inv_jewelcrafting_gem_38', Blue: 'inv_jewelcrafting_gem_42',
  Orange: 'inv_jewelcrafting_gem_39', Purple: 'inv_jewelcrafting_gem_40', Green: 'inv_jewelcrafting_gem_41',
}
const GLYPH_ICONS = {
  'Death Knight': 'inv_glyph_majordeathknight', Druid: 'inv_glyph_majordruid', Hunter: 'inv_glyph_majorhunter',
  Mage: 'inv_glyph_majormage', Paladin: 'inv_glyph_majorpaladin', Priest: 'inv_glyph_majorpriest',
  Rogue: 'inv_glyph_majorrogue', Shaman: 'inv_glyph_majorshaman', Warlock: 'inv_glyph_majorwarlock',
  Warrior: 'inv_glyph_majorwarrior',
}
const SLOT_ICONS = {
  INVTYPE_FEET: 'inv_boots_cloth_01', INVTYPE_WAIST: 'inv_belt_23', INVTYPE_HEAD: 'inv_helmet_25',
  INVTYPE_HAND: 'inv_gauntlets_17', INVTYPE_SHOULDER: 'inv_shoulder_22', INVTYPE_WRIST: 'inv_bracer_07',
  INVTYPE_FINGER: 'inv_jewelry_ring_43', INVTYPE_CLOAK: 'inv_misc_cape_18', INVTYPE_LEGS: 'inv_pants_leather_24',
  INVTYPE_ROBE: 'inv_chest_cloth_43', INVTYPE_BAG: 'inv_misc_bag_enchantedmageweave',
}
const WEAPON_ICONS = {
  'Two-Handed Swords': 'inv_sword_61', Staves: 'inv_staff_70', Daggers: 'inv_weapon_shortblade_61', Bows: 'inv_weapon_bow_31',
  'One-Handed Maces': 'inv_mace_63', 'Two-Handed Maces': 'inv_mace_51', 'Two-Handed Axes': 'inv_axe_113',
}
// FIXTURE-CHOICE: C1 icon names may contain `&` and `-` (^[a-z0-9_&-]+$). Two real textures
// with those characters, so the site's URL encoding is exercised (`&` must become %26).
const SPECIAL_ICONS = { 'Northern Spices': 'inv_misc_fork&knife', 'Fire Leaf': 'inv_misc_spineleaf-_01' }
function fixtureIcon(it) {
  if (SPECIAL_ICONS[it.name]) return SPECIAL_ICONS[it.name]
  // FIXTURE-CHOICE: about 1 in 10 items have no icon yet (null), to exercise the placeholder.
  // A hash of the key rather than rand(), so adding icons didn't change the generated prices.
  // Potion of Speed always keeps its icon (it is the documented hover example).
  const h = Math.imul(it.id ^ (it.suffix * 7919), 2654435761) >>> 0
  if (it.id !== 40211 && h % 10 === 0) return null
  if (REAL_ICONS[it.id]) return REAL_ICONS[it.id]
  if (it.cls === 'Gem') return GEM_ICONS[it.sub] ?? GEM_ICONS[it.name.split(' ').at(-1)] ?? 'inv_jewelcrafting_gem_28'
  if (it.cls === 'Glyph') return GLYPH_ICONS[it.sub] ?? 'inv_glyph_majormage'
  if (it.cls === 'Recipe') return pickBy(it.id, ['inv_scroll_03', 'inv_scroll_04', 'inv_scroll_05', 'inv_scroll_06'])
  if (it.cls === 'Weapon') return WEAPON_ICONS[it.sub] ?? 'inv_sword_61'
  if (it.sub === 'Mount') return 'ability_mount_mammoth_white'
  if (it.sub === 'Pet') return pickBy(it.id, ['inv_pet_babyblizzardbear', 'inv_misc_head_dragon_bronze'])
  if (SLOT_ICONS[it.equipLoc]) return SLOT_ICONS[it.equipLoc]
  if (it.sub === 'Junk') return pickBy(it.id, ['inv_misc_monsterfang_01', 'inv_misc_pelt_wolf_ruin_02', 'inv_misc_bone_09'])
  if (it.sub === 'Meat' || it.sub === 'Cooking') return 'inv_misc_food_15'
  return pickBy(it.id, ['inv_misc_ammo_arrow_01', 'inv_misc_key_14', 'inv_misc_bag_10'])
}
const pickBy = (n, a) => a[n % a.length]
for (const it of items) it.icon = fixtureIcon(it)

// ---------- scans ----------
const nowSec = Math.floor(Date.now() / 1000)
const DAY = 86400
const slots = [7, 12, 17, 21] // scan hours UTC
const scanTimes = []
const todayUtc = Math.floor(nowSec / DAY) * DAY
for (let d = 32; d >= 0; d--) {
  for (const h of slots) {
    const t = todayUtc - d * DAY + h * 3600 + intBetween(-25, 25) * 60
    if (t < nowSec - 90 * 60) scanTimes.push(t)
  }
}
// Each scan: { at, complete, coverage }. A partial scan stops early, so it holds a prefix of rows.
// FIXTURE-CHOICE: normal mode = HISTORY_DAYS × 4 complete scans plus 3 partial ones, the newest scan being partial,
// so the site must show it in the freshness line but never plot it.
// --no-complete = three partial scans in the last day and nothing else.
const scans = NO_COMPLETE
  ? [
      { at: nowSec - 26 * 3600, complete: false, coverage: 0.31 },
      { at: nowSec - 6 * 3600, complete: false, coverage: 0.58 },
      { at: nowSec - 40 * 60, complete: false, coverage: 0.42 },
    ]
  : (() => {
      // Whole UTC days only, so historyDays is exactly HISTORY_DAYS.
      const firstDay = todayUtc - (HISTORY_DAYS - 1) * DAY
      const complete = scanTimes.filter((t) => t >= firstDay)
      const at = (f) => complete[Math.floor((complete.length - 1) * f)]
      return [
        ...complete.map((at) => ({ at, complete: true, coverage: 1 })),
        ...(complete.length > 4
          ? [
              { at: at(0.25) + 1800, complete: false, coverage: 0.37 },
              { at: at(0.65) + 2400, complete: false, coverage: 0.66 },
            ]
          : []),
        { at: nowSec - 40 * 60, complete: false, coverage: 0.42 },
      ].sort((a, b) => a.at - b.at)
    })()
const completeScans = scans.filter((s) => s.complete)
const lastComplete = completeScans.at(-1) ?? null
const lastCompleteAt = lastComplete?.at ?? null
const newest = scans.at(-1)

const sellerPool = [
  'Fiftyb', 'Goldpaw', 'Auctioneerx', 'Frostcoin', 'Saronique', 'Glyphmaster', 'Herbalina', 'Minewell',
  'Ásgeir', 'Dustmonger', 'Flaskforge', 'Gemcutter', 'Tradewind', 'Silverlode', 'Thaumaturge', 'Kvaldir',
  'Mooncloth', 'Bankalt', 'Coldsnap', 'Rhinoqueen', 'Lichking', 'Vellumite', 'Oretrain', 'Zulgem',
]
// FIXTURE-CHOICE: ~85% of listings have seller null (C2: server sent no name).
const SELLER_KNOWN_RATE = 0.15

// Per-item price process: log random walk, with some planted movers.
const movers = new Map()
for (const it of items) {
  const r = rand()
  if (r < 0.04) movers.set(it, { kind: 'jump1d', f: between(1.35, 2.2) })
  else if (r < 0.08) movers.set(it, { kind: 'jump1d', f: between(0.45, 0.75) })
  else if (r < 0.13) movers.set(it, { kind: 'drift7d', f: between(0.6, 1.6) })
}
// Sparse items: very low activity, appear only in some scans.
for (const it of items) if (rand() < 0.08) it.activity = between(0.05, 0.25)

const anchorAt = lastCompleteAt ?? newest.at
function priceAt(it, walk, t) {
  let p = it.price * Math.exp(walk)
  const m = movers.get(it)
  if (m) {
    const age = anchorAt - t
    if (m.kind === 'jump1d' && age < DAY * 0.9) p *= m.f
    if (m.kind === 'drift7d' && age < 7 * DAY) p *= Math.pow(m.f, 1 - age / (7 * DAY))
  }
  return p
}

function quantile(sorted, q) {
  if (sorted.length === 0) return null
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo))
}

/** TSM AuctionDB-style market value over one scan's buyout unit prices (one point per auction). */
function marketValue(units) {
  const sorted = [...units].sort((a, b) => a - b)
  const n = sorted.length
  let kept = sorted.slice(0, Math.max(1, Math.ceil(0.3 * n)))
  for (let j = 1; j < kept.length; j++) {
    if (j >= 0.15 * n && kept[j] >= 1.2 * kept[j - 1]) {
      kept = kept.slice(0, j)
      break
    }
  }
  if (kept.length >= 2) {
    const mean = kept.reduce((a, x) => a + x, 0) / kept.length
    const sd = Math.sqrt(kept.reduce((a, x) => a + (x - mean) ** 2, 0) / kept.length)
    kept = kept.filter((x) => Math.abs(x - mean) <= 1.5 * sd)
  }
  return Math.round(kept.reduce((a, x) => a + x, 0) / kept.length)
}

const timeWeights = [0.08, 0.17, 0.3, 0.45] // P(timeLeft = 1..4)
function drawTimeLeft() {
  let r = rand()
  for (let i = 0; i < 4; i++) {
    r -= timeWeights[i]
    if (r <= 0) return i + 1
  }
  return 4
}
function drawStack(it) {
  if (it.stackMax <= 1) return 1
  const opts = it.price > 50 * G ? [1, 1, 1, 2, 5] : [1, 5, 10, 20, 20, 20]
  return Math.min(it.stackMax, pick(opts))
}

const history = new Map(items.map((it) => [it, []]))
const lastSeen = new Map()
const walks = new Map(items.map((it) => [it, gauss() * 0.05]))
const series = []
const scanIds = new Map()
const currentListings = new Map() // item -> rows of the newest complete scan
const currentStats = new Map() // item -> history point of the newest complete scan
const scanValues = new Map(items.map((it) => [it, []])) // item -> [{ at, value, listings, quantity }], complete scans

for (const scan of scans) {
  const t = scan.at
  const hour = new Date(t * 1000).getUTCHours()
  const busy = hour >= 17 ? 1.25 : hour <= 8 ? 0.8 : 1
  const weekend = [0, 6].includes(new Date(t * 1000).getUTCDay()) ? 1.1 : 1
  const isCurrent = scan === lastComplete
  const pt = { at: t, complete: scan.complete, coverage: 0, listings: 0, quantity: 0, items: 0, sellers: 0 }
  const sellersSeen = new Set()
  let expected = 0
  for (const it of items) {
    const w = walks.get(it) + gauss() * 0.025
    walks.set(it, w * 0.985)
    const nAll = poisson(it.activity * busy * weekend)
    expected += nAll
    // a partial scan only got through the first `coverage` share of rows
    const n = scan.complete ? nAll : Math.round(nAll * scan.coverage * between(0.6, 1.4))
    if (n === 0) continue
    lastSeen.set(it, t)
    pt.items++
    const median = priceAt(it, w, t)
    const units = []
    const rows = []
    let qty = 0
    for (let k = 0; k < n; k++) {
      const stack = drawStack(it)
      let unit = Math.max(1, Math.round(median * Math.exp(gauss() * 0.18) * (rand() < 0.06 ? between(1.6, 3) : 1)))
      if (unit > 100 * G) unit = Math.round(unit / 10000) * 10000 // big prices are round gold
      else if (unit > 1 * G) unit = Math.round(unit / 100) * 100 // round silver
      const bidOnly = rand() < 0.03
      const buyout = bidOnly ? null : unit * stack
      const minBid = Math.max(1, Math.round((buyout ?? unit * stack) * between(0.7, 0.95)))
      const bid = rand() < 0.07 ? Math.round(minBid * between(1, 1.05)) : null
      const seller = rand() < SELLER_KNOWN_RATE ? pick(sellerPool) : null
      if (seller) sellersSeen.add(seller)
      qty += stack
      if (!bidOnly) units.push(unit)
      if (isCurrent) rows.push({ stack, minBid, buyout, unit: bidOnly ? null : unit, bid, timeLeft: drawTimeLeft(), seller })
    }
    pt.listings += n
    pt.quantity += qty
    if (scan.complete && units.length > 0) {
      units.sort((a, b) => a - b)
      const h = { at: t, min: units[0], p25: quantile(units, 0.25), median: quantile(units, 0.5), p75: quantile(units, 0.75), listings: n, quantity: qty }
      history.get(it).push(h)
      scanValues.get(it).push({ at: t, value: marketValue(units), listings: n, quantity: qty })
      if (isCurrent) currentStats.set(it, h)
    }
    if (isCurrent) currentListings.set(it, rows)
  }
  pt.sellers = sellersSeen.size
  pt.coverage = scan.complete ? 1 : Math.round((pt.listings / Math.max(1, expected)) * 1000) / 1000
  scan.rowCount = pt.listings
  scan.expectedTotal = scan.complete ? pt.listings : expected
  scanIds.set(scan, `${t}-Fiftyb`)
  series.push(pt)
}

// ---------- write ----------
rmSync(DATA, { recursive: true, force: true })
mkdirSync(join(MARKET_DIR, 'items'), { recursive: true })
mkdirSync(join(MARKET_DIR, 'sellers'), { recursive: true })
const write = (path, obj) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(obj))
}
writeFileSync(
  join(DATA, 'README.md'),
  '# Generated data — do not edit\n\nEverything in this directory is generated and gitignored.\n\n' +
    '- Real data: written by the warehouse export (contract C4 in `docs/contracts.md`).\n' +
    '- Local fixture: `npm run fixture` (or `npm run fixture -- --no-complete`); see `site/scripts/make-fixture.mjs`.\n',
)

// C4: index.json, itemCount and item files cover the items seen in that market in any scan.
const seenItems = items.filter((it) => lastSeen.has(it))
const keyOf = (it) => `${it.id}:${it.suffix}`
const fileKey = (k) => k.replace(':', '_')

write(join(DATA, 'markets.json'), [
  { slug: SLUG, realm: REALM, faction: FACTION, lastScanAt: newest.at, lastCompleteScanAt: lastCompleteAt, scans: scans.length },
])

write(join(MARKET_DIR, 'meta.json'), {
  generatedAt: nowSec - 25 * 60,
  lastScan: { id: scanIds.get(newest), at: newest.at, rowCount: newest.rowCount, expectedTotal: newest.expectedTotal, complete: newest.complete },
  lastCompleteScan: lastComplete ? { id: scanIds.get(lastComplete), at: lastComplete.at, rowCount: lastComplete.rowCount } : null,
  scanCount: scans.length,
  completeScanCount: completeScans.length,
  itemCount: seenItems.length,
})

write(join(MARKET_DIR, 'overview.json'), { series })

const cols = ['key', 'id', 'name', 'quality', 'icon', 'class', 'subclass', 'median', 'min', 'listings', 'lastSeenAt']
const rows = seenItems.map((it) => {
  const cur = currentStats.get(it)
  const n = currentListings.get(it)?.length ?? 0
  return [keyOf(it), it.id, it.name, it.quality, it.icon, it.cls, it.sub, cur?.median ?? null, cur?.min ?? null, n, lastSeen.get(it) ?? null]
})
write(join(MARKET_DIR, 'index.json'), { cols, rows })

// movers: median now vs the complete scan closest to `window` earlier (within 6h), min listings both ends.
const MIN_LISTINGS = 3
const windows = {}
for (const [name, span] of [['1d', DAY], ['7d', 7 * DAY]]) {
  if (!lastComplete) break
  const target = lastComplete.at - span
  const prevScan = completeScans.reduce((best, s) => (Math.abs(s.at - target) < Math.abs((best?.at ?? Infinity) - target) ? s : best), null)
  if (!prevScan || Math.abs(prevScan.at - target) > 6 * 3600) continue // omitted when prevAt would be missing
  const rowsW = []
  for (const it of items) {
    const now = currentStats.get(it)
    const prev = history.get(it).find((p) => p.at === prevScan.at)
    if (!now || !prev || now.listings < MIN_LISTINGS || prev.listings < MIN_LISTINGS) continue
    const pct = Math.round(((now.median - prev.median) / prev.median) * 1000) / 10
    rowsW.push({ key: keyOf(it), name: it.name, quality: it.quality, icon: it.icon, median: now.median, prev: prev.median, pct, listings: now.listings })
  }
  rowsW.sort((a, b) => b.pct - a.pct)
  windows[name] = {
    prevAt: prevScan.at,
    up: rowsW.filter((m) => m.pct > 0).slice(0, 10),
    down: rowsW.filter((m) => m.pct < 0).reverse().slice(0, 10),
  }
}
write(join(MARKET_DIR, 'movers.json'), { minListings: MIN_LISTINGS, windows })

// ---------- dashboard.json (C4 v4) ----------
// Follows the contract's definitions step by step: market value per scan, day value, normal price,
// chained Jevons index, breadth, deals, overpriced, extremes, valuable.
const PARAMS = { dealPct: 30, overPct: 30, minGainCopper: 10000, indexMinListings: 5, refMinDays: 2, refWindowDays: 14, refHalfLifeDays: 2, breadthFlatPct: 5 }
const GROUPS = [
  { id: 'cloth', label: 'Cloth' },
  { id: 'herb', label: 'Herbs' },
  { id: 'metal', label: 'Metal & Stone' },
  { id: 'elemental', label: 'Elemental' },
  { id: 'enchanting', label: 'Enchanting' },
  { id: 'leather', label: 'Leather' },
  { id: 'meat', label: 'Meat' },
  { id: 'gem', label: 'Gems' },
  { id: 'glyph', label: 'Glyphs' },
  { id: 'consumable', label: 'Consumables' },
  { id: 'recipe', label: 'Recipes' },
  { id: 'gear', label: 'Gear' },
]
const TRADE_GROUPS = { Cloth: 'cloth', Herb: 'herb', 'Metal & Stone': 'metal', Elemental: 'elemental', Enchanting: 'enchanting', Leather: 'leather', Meat: 'meat' }
function groupOf(it) {
  if (it.cls === 'Trade Goods') return TRADE_GROUPS[it.sub] ?? null
  if (it.cls === 'Gem') return 'gem'
  if (it.cls === 'Glyph') return 'glyph'
  if (it.cls === 'Consumable') return 'consumable'
  if (it.cls === 'Recipe') return 'recipe'
  if (it.cls === 'Armor' || it.cls === 'Weapon') return 'gear'
  return null
}
const round1 = (x) => Math.round(x * 10) / 10
const dayOf = (t) => Math.floor(t / DAY) * DAY

function buildDashboard() {
  const empty = (days) => ({ days, haveDays: 0, needDays: Math.max(3, Math.ceil(days / 2)), low: [], high: [] })
  const marketDays = [...new Set(completeScans.map((s) => dayOf(s.at)))].sort((a, b) => a - b)
  const base = { asOf: lastCompleteAt, historyDays: marketDays.length, params: PARAMS, groups: GROUPS }
  if (!lastComplete) {
    return { ...base, index: { series: [] }, breadth: null, deals: [], overpriced: [], extremes: { '7d': empty(7), '30d': empty(30) }, valuable: [] }
  }
  const today = dayOf(lastComplete.at)
  const lastScanOfDay = new Map()
  for (const s of completeScans) lastScanOfDay.set(dayOf(s.at), s.at)

  // day values: item -> Map(day -> { value, listings, quantity })
  const dayValues = new Map()
  for (const it of items) {
    const byDay = new Map()
    for (const v of scanValues.get(it)) {
      const d = dayOf(v.at)
      const e = byDay.get(d) ?? { sum: 0, n: 0, listings: 0, quantity: 0 }
      e.sum += v.value
      e.n++
      e.listings = Math.max(e.listings, v.listings)
      e.quantity = Math.max(e.quantity, v.quantity)
      byDay.set(d, e)
    }
    const out = new Map()
    for (const [d, e] of byDay) out.set(d, { value: e.sum / e.n, listings: e.listings, quantity: e.quantity })
    dayValues.set(it, out)
  }

  // normal price + bundle
  const refs = new Map()
  for (const it of items) {
    const prior = [...dayValues.get(it)].filter(([d]) => d < today && d >= today - PARAMS.refWindowDays * DAY)
    if (prior.length < PARAMS.refMinDays) continue
    const meanListings = prior.reduce((a, [, v]) => a + v.listings, 0) / prior.length
    if (meanListings < 3) continue
    let wsum = 0
    let vsum = 0
    for (const [d, v] of prior) {
      const w = Math.pow(0.5, (today - d) / DAY / PARAMS.refHalfLifeDays)
      wsum += w
      vsum += w * v.value
    }
    const meanQty = prior.reduce((a, [, v]) => a + v.quantity, 0) / prior.length
    const bundle = meanQty < 10 ? 1 : meanQty < 50 ? 5 : meanQty < 200 ? 10 : 20
    refs.set(it, { ref: Math.round(vsum / wsum), bundle })
  }

  // market index (chained Jevons); FIXTURE-CHOICE: every group starts at 100 on the first day.
  const ids = ['all', ...GROUPS.map((g) => g.id)]
  const level = Object.fromEntries(ids.map((id) => [id, 100]))
  const series = []
  let lastRel = null // relatives of the last pair, for breadth
  marketDays.forEach((d1, k) => {
    const values = Object.fromEntries(ids.map((id) => [id, 100]))
    let eligible = 0
    if (k > 0) {
      const d0 = marketDays[k - 1]
      const logs = Object.fromEntries(ids.map((id) => [id, []]))
      const rel = []
      for (const it of items) {
        const a = dayValues.get(it).get(d0)
        const b = dayValues.get(it).get(d1)
        if (!a || !b || a.listings < PARAMS.indexMinListings || b.listings < PARAMS.indexMinListings) continue
        const r = Math.min(2, Math.max(0.5, b.value / a.value))
        rel.push(b.value / a.value)
        logs.all.push(Math.log(r))
        const g = groupOf(it)
        if (g) logs[g].push(Math.log(r))
      }
      eligible = logs.all.length
      lastRel = rel
      for (const id of ids) {
        const l = logs[id]
        if (l.length < 5) {
          values[id] = null
          continue
        }
        level[id] *= Math.exp(l.reduce((a, x) => a + x, 0) / l.length)
        values[id] = Math.round(level[id] * 100) / 100
      }
    }
    series.push({ at: lastScanOfDay.get(d1), values, items: eligible })
  })

  let breadth = null
  if (series.length >= 2 && lastRel) {
    const f = PARAMS.breadthFlatPct / 100
    const up = lastRel.filter((r) => r > 1 + f).length
    const down = lastRel.filter((r) => r < 1 - f).length
    breadth = { at: series.at(-1).at, prevAt: series.at(-2).at, up, down, flat: lastRel.length - up - down }
  }

  const head = (it) => ({ key: keyOf(it), name: it.name, quality: it.quality, icon: it.icon })
  const cmpKey = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  const deals = []
  const overpriced = []
  const valuable = []
  for (const it of items) {
    const cur = scanValues.get(it).find((v) => v.at === lastComplete.at)
    if (!cur) continue
    const stats = currentStats.get(it)
    valuable.push({ ...head(it), unit: cur.value, min: stats.min, listings: cur.listings })
    const r = refs.get(it)
    if (!r) continue
    // deals: mean of the cheapest `bundle` units, partial stacks allowed
    const rows = (currentListings.get(it) ?? []).filter((l) => l.unit != null).sort((a, b) => a.unit - b.unit)
    if (cur.quantity >= r.bundle) {
      let need = r.bundle
      let cost = 0
      for (const l of rows) {
        const take = Math.min(need, l.stack)
        cost += take * l.unit
        need -= take
        if (need === 0) break
      }
      if (need === 0) {
        const unit = Math.round(cost / r.bundle)
        const gain = (r.ref - unit) * r.bundle
        if (unit <= r.ref * (1 - PARAMS.dealPct / 100) && gain >= PARAMS.minGainCopper)
          deals.push({ ...head(it), bundle: r.bundle, unit, ref: r.ref, pct: round1((unit / r.ref - 1) * 100), gain, listings: cur.listings })
      }
    }
    if (cur.listings >= 3) {
      const unit = cur.value
      const gain = (unit - r.ref) * r.bundle
      if (unit >= r.ref * (1 + PARAMS.overPct / 100) && gain >= PARAMS.minGainCopper)
        overpriced.push({ ...head(it), bundle: r.bundle, unit, ref: r.ref, pct: round1((unit / r.ref - 1) * 100), gain, listings: cur.listings })
    }
  }
  deals.sort((a, b) => a.pct - b.pct || b.gain - a.gain || cmpKey(a, b))
  overpriced.sort((a, b) => b.pct - a.pct || b.gain - a.gain || cmpKey(a, b))
  valuable.sort((a, b) => b.unit - a.unit || cmpKey(a, b))

  const extremes = {}
  for (const [name, days] of [['7d', 7], ['30d', 30]]) {
    const from = today - (days - 1) * DAY
    const haveDays = marketDays.filter((d) => d >= from && d <= today).length
    const needDays = Math.max(3, Math.ceil(days / 2))
    const low = []
    const high = []
    if (haveDays >= needDays) {
      for (const it of items) {
        const dv = dayValues.get(it)
        const t = dv.get(today)
        if (!t || t.listings < 3) continue
        const others = [...dv].filter(([d]) => d >= from && d < today).map(([, v]) => v.value)
        if (others.length + 1 < needDays) continue
        const unit = Math.round(t.value)
        const lo = Math.round(Math.min(...others))
        const hi = Math.round(Math.max(...others))
        if (unit < lo) low.push({ ...head(it), unit, prev: lo, pct: round1((unit / lo - 1) * 100), listings: t.listings })
        if (unit > hi) high.push({ ...head(it), unit, prev: hi, pct: round1((unit / hi - 1) * 100), listings: t.listings })
      }
    }
    low.sort((a, b) => a.pct - b.pct || cmpKey(a, b))
    high.sort((a, b) => b.pct - a.pct || cmpKey(a, b))
    extremes[name] = { days, haveDays, needDays, low: low.slice(0, 25), high: high.slice(0, 25) }
  }

  return { ...base, index: { series }, breadth, deals: deals.slice(0, 50), overpriced: overpriced.slice(0, 50), extremes, valuable: valuable.slice(0, 25) }
}
const dashboard = buildDashboard()
write(join(MARKET_DIR, 'dashboard.json'), dashboard)

const byUnit = (a, b) => (a.unit === null ? 1 : 0) - (b.unit === null ? 1 : 0) || (a.unit ?? 0) - (b.unit ?? 0)
const sellerAgg = new Map()
for (const it of seenItems) {
  const key = keyOf(it)
  const listings = [...(currentListings.get(it) ?? [])].sort(byUnit)
  write(join(MARKET_DIR, 'items', `${fileKey(key)}.json`), {
    item: {
      key,
      id: it.id,
      suffixId: it.suffix,
      name: it.name,
      quality: it.quality,
      itemLevel: it.ilvl,
      reqLevel: it.req,
      itemType: it.cls,
      itemSubtype: it.sub,
      stackMax: it.stackMax,
      vendorSell: Math.round(it.quality === 0 ? it.price * 0.9 : it.price * 0.05),
      equipLoc: it.equipLoc,
      icon: it.icon,
    },
    history: history.get(it),
    listings,
  })
  for (const l of listings) {
    if (!l.seller) continue
    const s = sellerAgg.get(l.seller) ?? { listings: 0, items: new Map() }
    s.listings++
    const e = s.items.get(key) ?? { key, name: it.name, quality: it.quality, icon: it.icon, count: 0, unit: null }
    e.count++
    if (l.unit !== null && (e.unit === null || l.unit < e.unit)) e.unit = l.unit
    s.items.set(key, e)
    sellerAgg.set(l.seller, s)
  }
}
for (const [seller, s] of sellerAgg) {
  write(join(MARKET_DIR, 'sellers', `${seller}.json`), {
    seller,
    listings: s.listings,
    items: [...s.items.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  })
}

const sparse = items.filter((it) => history.get(it).length < 30).length
console.log(
  `fixture${NO_COMPLETE ? ' (--no-complete)' : ''}: ${items.length} items (${sparse} sparse), ` +
    `${completeScans.length} complete + ${scans.length - completeScans.length} partial scans, ${sellerAgg.size} named sellers, ` +
    `movers windows [${Object.keys(windows).join(', ')}], dashboard ${dashboard.historyDays} days / ` +
    `${dashboard.index.series.length} index points / ${dashboard.deals.length} deals / ${dashboard.overpriced.length} overpriced -> ${DATA}`,
)
