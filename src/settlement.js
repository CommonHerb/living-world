'use strict';

const { RNG } = require('./rng');
const { createNPC } = require('./npc');
const { initMarket } = require('./market');
const { createChronicle, recordEvent } = require('./chronicle');
const { HerbVM } = require('./herb-vm');

/**
 * Settlement — the fundamental unit of civilization.
 * Each settlement has its own NPCs, economy, politics, laws.
 */

const GOVERNMENT_TYPES = {
  council: {
    name: 'Council',
    description: 'Elected representatives govern by consensus.',
    hasElections: true,
    councilSize: 3,
  },
  monarchy: {
    name: 'Monarchy',
    description: 'A single ruler holds power. Succession by merit or force.',
    hasElections: false,
    councilSize: 1, // the monarch
  },
};

function createSettlement(opts) {
  const {
    id,
    name,
    location,         // { x, y } on world map
    seed,
    populationCount = 25,
    government = 'council',
    startingTreasury = 150,
    startingGranary = 80,
  } = opts;

  const rng = new RNG(seed);
  const npcs = [];
  for (let i = 0; i < populationCount; i++) {
    const npc = createNPC(rng, i);
    npc.settlementId = id;
    npcs.push(npc);
  }

  const chronicle = createChronicle();
  const govInfo = GOVERNMENT_TYPES[government] || GOVERNMENT_TYPES.council;

  // Pick initial leaders
  let council;
  if (government === 'monarchy') {
    // Monarch = most assertive NPC
    const sorted = [...npcs].sort((a, b) => b.genome.assertiveness - a.genome.assertiveness);
    council = [sorted[0].id];
  } else {
    council = [npcs[1].id, npcs[npcs.length - 1].id, npcs[Math.min(13, npcs.length - 1)].id];
  }

  recordEvent(chronicle, 0, 'founding',
    [{ id: -1, name, role: 'settlement' }],
    `The settlement of ${name} was founded. ${populationCount} souls begin a new life.`,
    { isFirst: true, affectsAll: true, affectedCount: populationCount }
  );

  const settlement = {
    id,
    name,
    location,
    government,
    governmentInfo: govInfo,
    seed,
    granary: startingGranary,
    treasury: startingTreasury,
    taxRate: 0.20,
    council,
    npcs,
    events: [],
    history: [],
    chronicle,
    market: initMarket(),
    vm: new HerbVM(),
    rng,
    // Inter-settlement
    relationships: {},    // settlementId → { trust, tradeVolume }
    tradeRoutes: [],      // active trade routes
    // Track next NPC id per settlement
    nextNpcId: populationCount,
  };

  return settlement;
}

/**
 * Get the leader title for this settlement's government type.
 */
function getLeaderTitle(settlement) {
  return settlement.government === 'monarchy' ? 'Monarch' : 'Council';
}

/**
 * Get leader name(s) as string.
 */
function getLeaderNames(settlement) {
  return settlement.council
    .map(id => settlement.npcs.find(n => n.id === id))
    .filter(Boolean)
    .map(n => n.name)
    .join(', ');
}

/**
 * Get living adult NPCs in a settlement.
 */
function getLivingAdults(settlement) {
  return settlement.npcs.filter(n => n.alive !== false && !n.isChild);
}

/**
 * Compute average satisfaction of a settlement.
 */
function getSettlementSatisfaction(settlement) {
  const adults = getLivingAdults(settlement);
  if (adults.length === 0) return 0;
  return adults.reduce((s, n) => s + n.opinions.satisfaction, 0) / adults.length;
}

module.exports = {
  createSettlement, getLeaderTitle, getLeaderNames,
  getLivingAdults, getSettlementSatisfaction,
  GOVERNMENT_TYPES,
};
