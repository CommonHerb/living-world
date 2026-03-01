'use strict';

const { distance, getRelationship } = require('./npc');
const { computeMemoryBasedOpinions } = require('./memory');

/**
 * Phase 2: Opinions are now DERIVED from memories.
 * 
 * Each tick:
 * 1. Compute memory-based opinion targets (what memories say you should think)
 * 2. Blend with social influence from neighbors
 * 3. Apply stubbornness as resistance to change
 */
function tickOpinions(world) {
  const npcs = world.npcs;

  for (const npc of npcs) {
    // 1. Memory-based opinion target
    const memTarget = computeMemoryBasedOpinions(npc);

    // 2. Social influence from nearby NPCs
    const neighbors = npcs.filter(
      other => other.id !== npc.id && distance(npc.position, other.position) <= npc.genome.vision
    );

    let socialTarget = { taxSentiment: 0, leaderApproval: 0, satisfaction: 0 };
    if (neighbors.length > 0) {
      let weightSum = 0;
      for (const neighbor of neighbors) {
        const rel = getRelationship(npc, neighbor.id);
        const w = Math.max(0.01, 0.5 + rel.trust);
        socialTarget.taxSentiment += neighbor.opinions.taxSentiment * w;
        socialTarget.leaderApproval += neighbor.opinions.leaderApproval * w;
        socialTarget.satisfaction += neighbor.opinions.satisfaction * w;
        weightSum += w;
      }
      socialTarget.taxSentiment /= weightSum;
      socialTarget.leaderApproval /= weightSum;
      socialTarget.satisfaction /= weightSum;
    }

    // 3. Personality-driven baseline opinions (genome anchors)
    const personalityAnchor = {
      taxSentiment: (npc.genome.fairnessSens - 0.5) * 1.2,  // high fairness → strongly pro-tax
      leaderApproval: (npc.genome.agreeableness - 0.5) * 0.5,
      satisfaction: (npc.genome.riskTolerance - 0.3) * 0.3,
    };
    // Guards should lean pro-tax (they're paid by treasury)
    if (npc.job === 'guard') {
      personalityAnchor.taxSentiment += 0.4;
    }
    // Farmers lean anti-tax (they produce, taxes take from them)
    if (npc.job === 'farmer') {
      personalityAnchor.taxSentiment -= 0.15;
    }

    // 4. Blend: personality anchor + memory + social, stubbornness resists
    const s = npc.genome.stubbornness;
    const memWeight = (1 - s) * 0.25;      // Reduced from 0.4 — less herd convergence
    const socialWeight = (1 - s) * npc.genome.agreeableness * 0.08;  // Reduced social pull
    const anchorWeight = 0.06;  // Constant pull back to personality baseline

    for (const dim of ['taxSentiment', 'leaderApproval', 'satisfaction']) {
      const current = npc.opinions[dim];
      
      // Personality anchor pull (always active, creates diversity)
      let newVal = current + anchorWeight * (personalityAnchor[dim] - current);

      // Memory pull
      newVal += memWeight * (memTarget[dim] - newVal);
      
      // Social pull
      if (neighbors.length > 0) {
        newVal += socialWeight * (socialTarget[dim] - newVal);
      }

      // Individual noise (tiny random walk based on risk tolerance)
      const noise = (world.tickRng.random() - 0.5) * 0.04 * npc.genome.riskTolerance;
      newVal += noise;

      // Natural drift toward neutral (very slow)
      newVal *= 0.998;

      npc.opinions[dim] = clamp(newVal, -1, 1);
    }

    // Decay emotional state
    npc.emotionalState *= 0.95;
  }
}

function getMedianWealth(npcs) {
  const sorted = npcs.map(n => n.wealth).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

module.exports = { tickOpinions, getMedianWealth };
