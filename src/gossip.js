'use strict';

const { distance, getRelationship, updateRelationship } = require('./npc');
const { createMemory, addMemory } = require('./memory');
const { recordEvent } = require('./chronicle');

/**
 * Gossip: Transmits MEMORIES with fidelity loss.
 * Now operates per-settlement.
 */

function tickGossip(settlement, tick) {
  const rng = settlement.tickRng;
  const npcs = settlement.npcs.filter(n => n.alive !== false && !n.isChild);

  for (const npc of npcs) {
    if (npc.genome.assertiveness <= rng.random()) continue;
    if (npc.memories.length === 0) continue;

    let strongest = npc.memories[0];
    for (const mem of npc.memories) {
      if (mem.fidelity > strongest.fidelity) strongest = mem;
    }
    if (strongest.fidelity < 0.3) continue;

    const neighbors = npcs.filter(
      other => other.id !== npc.id && distance(npc.position, other.position) <= npc.genome.vision
    );
    if (neighbors.length === 0) continue;
    const target = rng.pick(neighbors);

    const alreadyKnows = target.memories.some(m =>
      m.eventType === strongest.eventType &&
      m.subject === strongest.subject &&
      Math.abs(m.tick - strongest.tick) < 5
    );
    if (alreadyKnows) continue;

    const rel = getRelationship(target, npc.id);
    const believeChance = target.genome.credulity * 0.6 + Math.max(0, rel.trust) * 0.4;
    if (rng.random() > believeChance) continue;

    const fidelityLoss = 0.3 + rng.random() * 0.35;  // 0.3-0.65 multiplier — aggressive degradation
    const valueDrift = 0.4 + rng.random() * 1.2;    // heavy value distortion
    const valenceDrift = 0.5 + rng.random() * 1.0;  // heavy valence distortion

    const gossipMemory = createMemory(
      strongest.eventType,
      strongest.subject,
      strongest.value * valueDrift,
      Math.max(-1, Math.min(1, strongest.valence * valenceDrift)),
      strongest.tick,
      strongest.fidelity * fidelityLoss
    );

    addMemory(target, gossipMemory);

    // Retelling meaningfully degrades the teller's own memory
    strongest.fidelity *= (0.75 + rng.random() * 0.15);

    updateRelationship(npc, target.id, 0.02, 0.01);
    updateRelationship(target, npc.id, 0.01, 0.01);

    settlement.events.push({
      tick,
      type: 'gossip',
      text: `${npc.name} told ${target.name} about ${formatGossipTag(strongest.eventType)} (fidelity: ${gossipMemory.fidelity.toFixed(2)}).`,
    });

    if (gossipMemory.fidelity < 0.4 && settlement.chronicle) {
      recordEvent(settlement.chronicle, tick, 'gossip_distortion', [
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
