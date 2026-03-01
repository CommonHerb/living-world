'use strict';

/**
 * Phase 2: NPC Memory System
 * 
 * Each NPC has a bounded memory array (max 12).
 * Each memory: { eventType, subject, value, fidelity (0-1), valence (-1 to 1), tick }
 * Memories decay each tick: fidelity *= 0.995
 * Below 0.2 fidelity = forgotten.
 */

const MAX_MEMORIES = 16;
const DECAY_RATE = 0.992;
const FORGET_THRESHOLD = 0.2;

// Higher initial fidelity for emotional/traumatic events
const BASE_FIDELITY = {
  food_shortage: 0.95,
  tax_raised: 0.85,
  tax_lowered: 0.75,
  election: 0.65,
  gossip_heard: 0.6,
  crisis: 0.95,
  surplus: 0.6,
  bankruptcy: 0.95,
  relief: 0.8,
  good_trade: 0.5,
  bad_trade: 0.7,
  robbed: 0.95,
  stole: 0.8,
  fined: 0.85,
  exiled: 0.99,
  family_exiled: 0.9,
  unjust_acquittal: 0.9,
  trial_juror: 0.6,
  bandit_attack: 0.9,
  drought: 0.95,
  harsh_winter: 0.95,
  winter_death: 0.95,
  plague: 0.99,
  flood: 0.95,
  fire: 0.90,
  raid: 0.95,
  prophet: 0.80,
  discovery: 0.85,
  bountiful_year: 0.80,
  traders: 0.70,
  migration: 0.85,
  coup: 0.95,
};

function createMemory(eventType, subject, value, valence, tick, fidelity) {
  return {
    eventType,
    type: eventType, // alias for compatibility with display/diagnostics
    subject,       // who/what — string or null
    value,         // numeric payload
    fidelity: fidelity !== undefined ? fidelity : (BASE_FIDELITY[eventType] || 0.7),
    valence,       // -1 to 1 (bad to good)
    tick,
  };
}

function addMemory(npc, memory) {
  npc.memories.push(memory);
  if (npc.memories.length > MAX_MEMORIES) {
    // Evict lowest-fidelity memory
    let weakest = 0;
    for (let i = 1; i < npc.memories.length; i++) {
      if (npc.memories[i].fidelity < npc.memories[weakest].fidelity) weakest = i;
    }
    npc.memories.splice(weakest, 1);
  }
}

// Memory types that are "boring" steady-state confirmations — cap these
const BORING_MEMORY_TYPES = new Set(['surplus', 'good_trade', 'election']);
const BORING_MEMORY_CAP = 2;

function formMemory(npc, eventType, subject, value, valence, tick) {
  // Cap boring/steady-state memories to prevent flooding
  if (BORING_MEMORY_TYPES.has(eventType)) {
    const existing = npc.memories.filter(m => m.eventType === eventType);
    if (existing.length >= BORING_MEMORY_CAP) {
      // Replace oldest boring memory instead of adding
      const oldest = existing.reduce((a, b) => a.tick < b.tick ? a : b);
      const idx = npc.memories.indexOf(oldest);
      if (idx !== -1) npc.memories.splice(idx, 1);
    }
  }
  const mem = createMemory(eventType, subject, value, valence, tick);
  addMemory(npc, mem);
}

function tickMemoryDecay(settlement) {
  for (const npc of settlement.npcs) {
    for (let i = npc.memories.length - 1; i >= 0; i--) {
      npc.memories[i].fidelity *= DECAY_RATE;
      if (npc.memories[i].fidelity < FORGET_THRESHOLD) {
        npc.memories.splice(i, 1);
      }
    }
  }
}

/**
 * Derive opinion shift from a single memory.
 * Returns { taxSentiment, leaderApproval, satisfaction } deltas.
 */
function memoryOpinionEffect(mem) {
  const delta = { taxSentiment: 0, leaderApproval: 0, satisfaction: 0 };
  const weight = mem.fidelity * Math.abs(mem.valence);

  switch (mem.eventType) {
    case 'tax_raised':
      delta.taxSentiment = -weight * 0.3;
      delta.leaderApproval = -weight * 0.15;
      break;
    case 'tax_lowered':
      delta.taxSentiment = weight * 0.2;
      delta.leaderApproval = weight * 0.1;
      break;
    case 'food_shortage':
      delta.satisfaction = -weight * 0.2;
      delta.leaderApproval = -weight * 0.1;
      // Food shortage doesn't inherently affect tax opinion
      break;
    case 'crisis':
      delta.satisfaction = -weight * 0.2;
      delta.leaderApproval = -weight * 0.15;
      // Crisis is ambiguous — some blame taxes, some want more government
      break;
    case 'surplus':
      delta.satisfaction = weight * 0.1;
      delta.leaderApproval = weight * 0.05;
      break;
    case 'election':
      // Mild — elections are neutral
      delta.leaderApproval = mem.valence * weight * 0.05;
      break;
    case 'gossip_heard':
      delta.satisfaction = mem.valence * weight * 0.1;
      delta.leaderApproval = mem.valence * weight * 0.05;
      break;
    case 'bankruptcy':
      delta.satisfaction = -weight * 0.4;
      delta.taxSentiment = -weight * 0.3;  // blame taxes
      delta.leaderApproval = -weight * 0.3;
      break;
    case 'relief':
      // Treasury saved me → mildly pro-tax
      delta.satisfaction = weight * 0.3;
      delta.taxSentiment = weight * 0.2;
      delta.leaderApproval = weight * 0.15;
      break;
    case 'good_trade':
      delta.satisfaction = weight * 0.05;
      break;
    case 'bad_trade':
      delta.satisfaction = -weight * 0.05;
      delta.taxSentiment = -weight * 0.1;  // blame taxes for bad prices
      break;
    case 'robbed':
      delta.satisfaction = -weight * 0.3;
      delta.taxSentiment = weight * 0.2;  // want more guards → pro-tax
      delta.leaderApproval = -weight * 0.1;  // why aren't they protecting me?
      break;
    case 'stole':
      delta.satisfaction = -weight * 0.1;  // guilt
      break;
    case 'fined':
      delta.satisfaction = -weight * 0.3;
      delta.leaderApproval = -weight * 0.15;
      break;
    case 'exiled':
      delta.satisfaction = -weight * 0.5;
      delta.leaderApproval = -weight * 0.4;
      delta.taxSentiment = -weight * 0.3;  // anti-establishment
      break;
    case 'family_exiled':
      delta.satisfaction = -weight * 0.3;
      delta.leaderApproval = -weight * 0.3;
      break;
    case 'unjust_acquittal':
      delta.satisfaction = -weight * 0.3;
      delta.leaderApproval = -weight * 0.2;
      break;
    case 'bandit_attack':
      delta.satisfaction = -weight * 0.3;
      delta.taxSentiment = weight * 0.2;  // want protection
      break;
    case 'drought':
      delta.satisfaction = -weight * 0.4;
      delta.leaderApproval = -weight * 0.1;
      break;
    case 'harsh_winter':
      delta.satisfaction = -weight * 0.4;
      delta.leaderApproval = -weight * 0.15;
      break;
    case 'winter_death':
      delta.satisfaction = -weight * 0.5;
      delta.leaderApproval = -weight * 0.2;
      break;
    case 'plague':
      delta.satisfaction = -weight * 0.5;
      delta.leaderApproval = -weight * 0.3;
      break;
    case 'flood':
      delta.satisfaction = -weight * 0.4;
      break;
    case 'fire':
      delta.satisfaction = -weight * 0.3;
      break;
    case 'raid':
      delta.satisfaction = -weight * 0.4;
      delta.taxSentiment = weight * 0.3;  // want defense spending
      delta.leaderApproval = -weight * 0.15;
      break;
    case 'prophet':
      delta.satisfaction = mem.valence * weight * 0.2;
      delta.leaderApproval = mem.valence * weight * 0.15;
      break;
    case 'discovery':
      delta.satisfaction = weight * 0.3;
      delta.leaderApproval = weight * 0.1;
      break;
    case 'bountiful_year':
      delta.satisfaction = weight * 0.3;
      break;
    case 'traders':
      delta.satisfaction = weight * 0.2;
      break;
    case 'coup':
      delta.satisfaction = mem.valence * weight * 0.3;
      delta.leaderApproval = mem.valence * weight * 0.4;
      break;
  }
  return delta;
}

/**
 * Compute opinion targets from all memories.
 * Returns what the NPC's opinions SHOULD drift toward based on what they remember.
 */
function computeMemoryBasedOpinions(npc) {
  const target = { taxSentiment: 0, leaderApproval: 0, satisfaction: 0 };
  let totalWeight = 0;

  for (const mem of npc.memories) {
    const effect = memoryOpinionEffect(mem);
    const w = mem.fidelity;
    target.taxSentiment += effect.taxSentiment;
    target.leaderApproval += effect.leaderApproval;
    target.satisfaction += effect.satisfaction;
    totalWeight += w;
  }

  // Normalize — if no memories, target is neutral (0)
  if (totalWeight > 0) {
    // Don't normalize by weight — let accumulated memories stack
    // But clamp the result
    target.taxSentiment = clamp(target.taxSentiment, -1, 1);
    target.leaderApproval = clamp(target.leaderApproval, -1, 1);
    target.satisfaction = clamp(target.satisfaction, -1, 1);
  }

  return target;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

module.exports = {
  createMemory, addMemory, formMemory, tickMemoryDecay,
  computeMemoryBasedOpinions, memoryOpinionEffect,
  MAX_MEMORIES, DECAY_RATE, FORGET_THRESHOLD,
};
