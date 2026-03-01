'use strict';

/**
 * Phase 2: NPC Memory System
 * 
 * Each NPC has a bounded memory array (max 12).
 * Each memory: { eventType, subject, value, fidelity (0-1), valence (-1 to 1), tick }
 * Memories decay each tick: fidelity *= 0.995
 * Below 0.2 fidelity = forgotten.
 */

const MAX_MEMORIES = 12;
const DECAY_RATE = 0.995;
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
};

function createMemory(eventType, subject, value, valence, tick, fidelity) {
  return {
    eventType,
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

function formMemory(npc, eventType, subject, value, valence, tick) {
  const mem = createMemory(eventType, subject, value, valence, tick);
  addMemory(npc, mem);
}

function tickMemoryDecay(world) {
  for (const npc of world.npcs) {
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
    case 'crisis':
      delta.satisfaction = -weight * 0.3;
      delta.leaderApproval = -weight * 0.2;
      delta.taxSentiment = -weight * 0.1;
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
      // Gossip-received memories influence based on their original type tag
      // The valence already encodes the direction
      delta.satisfaction = mem.valence * weight * 0.1;
      delta.leaderApproval = mem.valence * weight * 0.05;
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
