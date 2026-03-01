'use strict';

const { distance, getRelationship, updateRelationship } = require('./npc');
const { createMemory, addMemory } = require('./memory');
const { recordEvent } = require('./chronicle');

/**
 * Phase 2 Gossip: Transmits MEMORIES with fidelity loss (~20% per hop).
 * The receiving NPC gets a copy of the memory with reduced fidelity.
 * This is how misinformation emerges.
 */

function tickGossip(world) {
  const rng = world.tickRng;
  const npcs = world.npcs;

  for (const npc of npcs) {
    // Assertiveness check
    if (npc.genome.assertiveness <= rng.random()) continue;

    // Pick strongest-fidelity memory
    if (npc.memories.length === 0) continue;
    let strongest = npc.memories[0];
    for (const mem of npc.memories) {
      if (mem.fidelity > strongest.fidelity) strongest = mem;
    }
    if (strongest.fidelity < 0.3) continue;

    // Find neighbor within vision
    const neighbors = npcs.filter(
      other => other.id !== npc.id && distance(npc.position, other.position) <= npc.genome.vision
    );
    if (neighbors.length === 0) continue;
    const target = rng.pick(neighbors);

    // Check if target already has this exact memory (same type + subject + close tick)
    const alreadyKnows = target.memories.some(m =>
      m.eventType === strongest.eventType &&
      m.subject === strongest.subject &&
      Math.abs(m.tick - strongest.tick) < 5
    );
    if (alreadyKnows) continue;

    // Credulity gate: target must be credulous enough
    const rel = getRelationship(target, npc.id);
    const believeChance = target.genome.credulity * 0.6 + Math.max(0, rel.trust) * 0.4;
    if (rng.random() > believeChance) continue;

    // Transmit memory with ~20% fidelity loss + value distortion
    const fidelityLoss = 0.7 + rng.random() * 0.2; // 70-90% of original (avg ~20% loss)
    const valueDrift = 0.8 + rng.random() * 0.4;    // ±20% on numeric value
    const valenceDrift = 0.85 + rng.random() * 0.3;  // slight emotional drift

    const gossipMemory = createMemory(
      strongest.eventType,
      strongest.subject,
      strongest.value * valueDrift,
      Math.max(-1, Math.min(1, strongest.valence * valenceDrift)),
      strongest.tick,
      strongest.fidelity * fidelityLoss  // reduced fidelity
    );

    addMemory(target, gossipMemory);

    // Gossip builds bonds
    updateRelationship(npc, target.id, 0.02, 0.01);
    updateRelationship(target, npc.id, 0.01, 0.01);

    world.events.push({
      tick: world.tick,
      type: 'gossip',
      text: `${npc.name} told ${target.name} about ${formatGossipTag(strongest.eventType)} (fidelity: ${gossipMemory.fidelity.toFixed(2)}).`,
    });

    // Record in chronicle only if it's a notable gossip chain (low fidelity = distorted)
    if (gossipMemory.fidelity < 0.4 && world.chronicle) {
      recordEvent(world.chronicle, world.tick, 'gossip_distortion', [
        { id: npc.id, name: npc.name, role: 'teller' },
        { id: target.id, name: target.name, role: 'listener' },
      ], `Distorted memory of "${strongest.eventType}" passed from ${npc.name} to ${target.name}. ` +
         `Original value: ${strongest.value.toFixed(1)}, transmitted as: ${gossipMemory.value.toFixed(1)}. ` +
         `Fidelity: ${gossipMemory.fidelity.toFixed(2)}.`,
      { affectedCount: 2 });
    }
  }
}

function formatGossipTag(eventType) {
  switch (eventType) {
    case 'tax_raised': return 'taxes being raised';
    case 'tax_lowered': return 'taxes being lowered';
    case 'food_shortage': return 'the food shortage';
    case 'election': return 'the election';
    case 'crisis': return 'the food crisis';
    case 'surplus': return 'the surplus';
    default: return eventType;
  }
}

module.exports = { tickGossip };
