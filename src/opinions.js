'use strict';

const { distance, getRelationship } = require('./npc');

function tickOpinions(world) {
  const npcs = world.npcs;
  const medianWealth = getMedianWealth(npcs);

  for (const npc of npcs) {
    // 1. Tax sentiment based on personal wealth
    const wealthRatio = medianWealth > 0 ? npc.wealth / medianWealth : 1;
    let experienceSignal = 0;
    if (wealthRatio < 0.5) {
      experienceSignal = -0.1 * npc.genome.fairnessSens;
    } else if (wealthRatio > 2.0) {
      experienceSignal = 0.05;
    }
    npc.opinions.taxSentiment = clamp(npc.opinions.taxSentiment + experienceSignal, -1, 1);

    // 2. Social influence from nearby NPCs
    const neighbors = npcs.filter(
      other => other.id !== npc.id && distance(npc.position, other.position) <= npc.genome.vision
    );
    if (neighbors.length > 0) {
      let weightSum = 0;
      let pullSum = 0;
      for (const neighbor of neighbors) {
        const rel = getRelationship(npc, neighbor.id);
        const w = Math.max(0.01, 0.5 + rel.trust);
        pullSum += neighbor.opinions.taxSentiment * w;
        weightSum += w;
      }
      const socialPull = pullSum / weightSum;
      const socialWeight = (1 - npc.genome.stubbornness) * npc.genome.agreeableness * 0.1;
      npc.opinions.taxSentiment = clamp(
        npc.opinions.taxSentiment + socialWeight * (socialPull - npc.opinions.taxSentiment),
        -1, 1
      );
    }

    // 3. Decay emotional state toward neutral
    npc.emotionalState *= 0.95;

    // Clamp satisfaction
    npc.opinions.satisfaction = clamp(npc.opinions.satisfaction, -1, 1);
    npc.opinions.leaderApproval = clamp(npc.opinions.leaderApproval, -1, 1);
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
