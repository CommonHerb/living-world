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
    job = 'farmer';
  } else if (id <= JOB_DISTRIBUTION.farmer) {
    job = 'farmer';
  } else if (id <= JOB_DISTRIBUTION.farmer + JOB_DISTRIBUTION.miller) {
    job = 'miller';
  } else {
    job = 'guard';
  }

  // Position on 10x10 grid
  let x, y;
  if (job === 'farmer') {
    const side = rng.int(0, 3);
    if (side === 0) { x = 0; y = rng.int(0, 9); }
    else if (side === 1) { x = 9; y = rng.int(0, 9); }
    else if (side === 2) { x = rng.int(0, 9); y = 0; }
    else { x = rng.int(0, 9); y = 9; }
  } else {
    x = rng.int(3, 6);
    y = rng.int(3, 6);
  }

  return {
    id,
    name,
    genome,
    job,
    position: { x, y },
    wealth: 10,
    opinions: {
      taxSentiment: rng.float(-0.3, 0.3),
      leaderApproval: 0,
      satisfaction: 0.2,
    },
    memories: [],         // Phase 2: bounded to 12, each with fidelity/valence/etc
    relationships: {},
    emotionalState: 0,
  };
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
  distance, getMoodLabel, getOverallMood, JOBS,
};
