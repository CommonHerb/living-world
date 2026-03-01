'use strict';

const { distance, formMemory, getRelationship, updateRelationship } = require('./npc');

function tickGossip(world) {
  const rng = world.tickRng;
  const npcs = world.npcs;

  for (const npc of npcs) {
    // Assertiveness check — does this NPC gossip this tick?
    if (npc.genome.assertiveness <= rng.random()) continue;

    // Pick strongest memory
    if (npc.memories.length === 0) continue;
    let strongest = npc.memories[0];
    for (const mem of npc.memories) {
      if (mem.intensity > strongest.intensity) strongest = mem;
    }
    if (strongest.intensity < 0.3) continue;

    // Find a neighbor within vision
    const neighbors = npcs.filter(
      other => other.id !== npc.id && distance(npc.position, other.position) <= npc.genome.vision
    );
    if (neighbors.length === 0) continue;
    const target = rng.pick(neighbors);

    // Transmit with distortion
    const distortionFactor = 0.8 + rng.random() * 0.4; // ±20%
    const gossipPayload = {
      tag: strongest.tag,
      valence: strongest.valence * distortionFactor,
      intensity: strongest.intensity * 0.6, // Weakened
      data: strongest.data * distortionFactor, // Numeric drift
    };

    // Target forms memory if credulous enough
    if (target.genome.credulity > rng.random() * 0.5) {
      formMemory(target, gossipPayload.tag, gossipPayload.valence, gossipPayload.data, world.tick);

      // Gossip affects target's opinions
      if (gossipPayload.tag === 'tax_raised' || gossipPayload.tag === 'tax_lowered') {
        target.opinions.taxSentiment = Math.max(-1, Math.min(1,
          target.opinions.taxSentiment + gossipPayload.valence * 0.1
        ));
      }
      if (gossipPayload.tag === 'food_shortage') {
        target.opinions.satisfaction = Math.max(-1, Math.min(1,
          target.opinions.satisfaction + gossipPayload.valence * 0.1
        ));
        target.opinions.leaderApproval = Math.max(-1, Math.min(1,
          target.opinions.leaderApproval + gossipPayload.valence * 0.05
        ));
      }
    }

    // Gossip builds bonds
    updateRelationship(npc, target.id, 0.02, 0.01);
    updateRelationship(target, npc.id, 0.01, 0.01);

    world.events.push({
      tick: world.tick,
      type: 'gossip',
      text: `${npc.name} told ${target.name} about ${formatGossipTag(gossipPayload.tag)}.`,
    });
  }
}

function formatGossipTag(tag) {
  switch (tag) {
    case 'tax_raised': return 'taxes being raised';
    case 'tax_lowered': return 'taxes being lowered';
    case 'food_shortage': return 'the food shortage';
    case 'election': return 'the election';
    default: return tag;
  }
}

module.exports = { tickGossip };
