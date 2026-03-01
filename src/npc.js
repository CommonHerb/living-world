'use strict';

const { generateName } = require('./names');
const { initNPCMarketData } = require('./market');

const JOBS = ['farmer', 'miller', 'guard', 'woodcutter', 'miner', 'smith'];
// 25 NPCs: 8 farmers, 3 millers, 4 guards, 4 woodcutters, 3 miners, 3 smiths
const JOB_DISTRIBUTION = { farmer: 13, miller: 2, guard: 3, woodcutter: 3, miner: 2, smith: 2 };

function createGenome(rng) {
  return {
    vision: rng.int(1, 4),
    metabolism: rng.int(1, 2),
    riskTolerance: rng.float(0, 1),
    agreeableness: rng.float(0, 1),
    assertiveness: rng.float(0, 1),
    fairnessSens: rng.float(0, 1),
    stubbornness: rng.float(0, 1),
    credulity: rng.float(0, 1),
  };
}

function createNPC(rng, id) {
  const genome = createGenome(rng);
  const name = generateName(rng, id);

  // Assign job based on distribution
  let job;
  let cumulative = 0;
  for (const [j, count] of Object.entries(JOB_DISTRIBUTION)) {
    cumulative += count;
    if (id < cumulative) {
      job = j;
      break;
    }
  }
  if (!job) job = 'farmer'; // fallback

  // Position on 10x10 grid
  let x, y;
  if (job === 'farmer' || job === 'woodcutter') {
    // Edge positions (fields/forest)
    const side = rng.int(0, 3);
    if (side === 0) { x = 0; y = rng.int(0, 9); }
    else if (side === 1) { x = 9; y = rng.int(0, 9); }
    else if (side === 2) { x = rng.int(0, 9); y = 0; }
    else { x = rng.int(0, 9); y = 9; }
  } else if (job === 'miner') {
    // Corners (quarry)
    x = rng.int(0, 1) * 9;
    y = rng.int(0, 1) * 9;
  } else {
    // Town center
    x = rng.int(3, 6);
    y = rng.int(3, 6);
  }

  const npc = {
    id,
    name,
    genome,
    job,
    position: { x, y },
    wealth: 10,  // legacy — kept for compatibility, gold is the real money
    gold: 0,     // set by initNPCMarketData
    opinions: {
      taxSentiment: rng.float(-0.3, 0.3),
      leaderApproval: 0,
      satisfaction: 0.2,
    },
    memories: [],
    relationships: {},
    emotionalState: 0,
    inventory: {},
    idealInventory: {},
    priceBeliefs: {},
  };

  // Initialize market data (gold, inventory, beliefs)
  initNPCMarketData(npc, rng);

  return npc;
}

function getRelationship(npc, otherId) {
  if (!npc.relationships[otherId]) {
    npc.relationships[otherId] = { trust: 0.1, affinity: 0 };
  }
  return npc.relationships[otherId];
}

function updateRelationship(npc, otherId, trustDelta, affinityDelta) {
  const rel = getRelationship(npc, otherId);
  rel.trust = Math.max(-1, Math.min(1, rel.trust + trustDelta));
  rel.affinity = Math.max(-1, Math.min(1, rel.affinity + affinityDelta));
}

function distance(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function getMoodLabel(satisfaction) {
  if (satisfaction > 0.5) return 'Happy';
  if (satisfaction > 0.2) return 'Content';
  if (satisfaction > -0.2) return 'Neutral';
  if (satisfaction > -0.5) return 'Restless';
  return 'Angry';
}

function getOverallMood(npcs) {
  const avg = npcs.reduce((s, n) => s + n.opinions.satisfaction, 0) / npcs.length;
  return getMoodLabel(avg);
}

module.exports = {
  createNPC, getRelationship, updateRelationship,
  distance, getMoodLabel, getOverallMood, JOBS, JOB_DISTRIBUTION,
};
