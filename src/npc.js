'use strict';

const { generateName } = require('./names');

const JOBS = ['farmer', 'miller', 'guard'];
const JOB_DISTRIBUTION = { farmer: 15, miller: 4, guard: 6 }; // out of 25

function createGenome(rng) {
  return {
    vision: rng.int(1, 4),
    metabolism: rng.int(1, 3),
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
  if (id === 0) {
    job = 'farmer'; // Player starts as farmer
  } else if (id <= JOB_DISTRIBUTION.farmer) {
    job = 'farmer';
  } else if (id <= JOB_DISTRIBUTION.farmer + JOB_DISTRIBUTION.miller) {
    job = 'miller';
  } else {
    job = 'guard';
  }

  // Position on 10x10 grid
  // Farmers on edges, guards/millers center
  let x, y;
  if (job === 'farmer') {
    // Edge positions
    const side = rng.int(0, 3);
    if (side === 0) { x = 0; y = rng.int(0, 9); }
    else if (side === 1) { x = 9; y = rng.int(0, 9); }
    else if (side === 2) { x = rng.int(0, 9); y = 0; }
    else { x = rng.int(0, 9); y = 9; }
  } else {
    // Center area
    x = rng.int(3, 6);
    y = rng.int(3, 6);
  }

  return {
    id,
    name,
    genome,
    job,
    position: { x, y },
    wealth: 10, // Starting food stockpile
    opinions: {
      taxSentiment: rng.float(-0.3, 0.3), // Slight initial lean
      leaderApproval: 0,
      satisfaction: 0.2, // Mildly content
    },
    memories: [],
    relationships: {}, // { [npcId]: { trust, affinity } }
    emotionalState: 0,
  };
}

function formMemory(npc, tag, valence, data, tick) {
  const mem = { tick, valence, intensity: Math.abs(valence), tag, data };
  npc.memories.push(mem);
  // Keep max 5 memories — evict weakest
  if (npc.memories.length > 5) {
    let weakest = 0;
    for (let i = 1; i < npc.memories.length; i++) {
      if (npc.memories[i].intensity < npc.memories[weakest].intensity) weakest = i;
    }
    npc.memories.splice(weakest, 1);
  }
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
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); // Manhattan
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
  createNPC, formMemory, getRelationship, updateRelationship,
  distance, getMoodLabel, getOverallMood, JOBS,
};
