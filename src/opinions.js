'use strict';

const { distance, getRelationship } = require('./npc');
const { computeMemoryBasedOpinions } = require('./memory');

/**
 * Phase 2: Opinions derived from memories.
 * Now operates per-settlement.
 */
function tickOpinions(settlement, tick) {
  const npcs = settlement.npcs.filter(n => n.alive !== false && !n.isChild);

  for (const npc of npcs) {
    const memTarget = computeMemoryBasedOpinions(npc);

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

    const personalityAnchor = {
      taxSentiment: (npc.genome.fairnessSens - 0.5) * 1.2,
      leaderApproval: (npc.genome.agreeableness - 0.5) * 0.5,
      satisfaction: (npc.genome.riskTolerance - 0.3) * 0.3,
    };
    if (npc.job === 'guard') personalityAnchor.taxSentiment += 0.4;
    if (npc.job === 'farmer') personalityAnchor.taxSentiment -= 0.15;

    const s = npc.genome.stubbornness;
    const memWeight = (1 - s) * 0.25;
    const socialWeight = (1 - s) * npc.genome.agreeableness * 0.08;
    const anchorWeight = 0.06;

    for (const dim of ['taxSentiment', 'leaderApproval', 'satisfaction']) {
      const current = npc.opinions[dim];
      let newVal = current + anchorWeight * (personalityAnchor[dim] - current);
      newVal += memWeight * (memTarget[dim] - newVal);
      if (neighbors.length > 0) {
        newVal += socialWeight * (socialTarget[dim] - newVal);
      }
      const noise = (settlement.tickRng.random() - 0.5) * 0.04 * npc.genome.riskTolerance;
      newVal += noise;
      newVal *= 0.998;
      npc.opinions[dim] = clamp(newVal, -1, 1);
    }

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
