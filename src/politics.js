'use strict';

const { formMemory } = require('./npc');

function tickElection(world) {
  const rng = world.tickRng;
  const npcs = world.npcs;

  // Candidacy: NPCs with high assertiveness run
  let candidates = npcs.filter(n => n.genome.assertiveness > 0.6);

  // Draft random NPCs to fill if needed
  if (candidates.length < 3) {
    const pool = npcs.filter(n => !candidates.includes(n));
    rng.shuffle(pool);
    while (candidates.length < 3 && pool.length > 0) {
      candidates.push(pool.pop());
    }
  }

  // Voting
  const votes = new Map();
  for (const c of candidates) votes.set(c.id, 0);

  const incumbentSet = new Set(world.council);

  for (const voter of npcs) {
    // Find candidate closest to voter's tax sentiment
    let bestCandidate = candidates[0];
    let bestDist = Math.abs(voter.opinions.taxSentiment - candidates[0].opinions.taxSentiment);

    for (let i = 1; i < candidates.length; i++) {
      const d = Math.abs(voter.opinions.taxSentiment - candidates[i].opinions.taxSentiment);
      // Stubbornness > 0.7 gives incumbency bonus
      const incumbentBonus = (incumbentSet.has(candidates[i].id) && voter.genome.stubbornness > 0.7) ? 0.2 : 0;
      if (d - incumbentBonus < bestDist) {
        bestDist = d - incumbentBonus;
        bestCandidate = candidates[i];
      }
    }

    votes.set(bestCandidate.id, (votes.get(bestCandidate.id) || 0) + 1);
  }

  // Top 3 vote-getters form council
  const sorted = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  const oldCouncil = [...world.council];
  world.council = sorted.slice(0, 3).map(([id]) => id);

  const councilNPCs = world.council.map(id => npcs.find(n => n.id === id));

  // Council sets tax rate
  const oldTaxRate = world.taxRate;
  const avgSentiment = councilNPCs.reduce((s, n) => s + n.opinions.taxSentiment, 0) / councilNPCs.length;
  // Map [-1, 1] to [0.05, 0.50]
  world.taxRate = Math.round((0.275 + avgSentiment * 0.225) * 100) / 100;
  world.taxRate = Math.max(0.05, Math.min(0.50, world.taxRate));

  const councilNames = councilNPCs.map(n => `${n.name} (${n.job[0].toUpperCase()})`).join(', ');
  const oldPct = Math.round(oldTaxRate * 100);
  const newPct = Math.round(world.taxRate * 100);

  world.events.push({
    tick: world.tick,
    type: 'election',
    text: `ELECTION: ${councilNames} elected. Tax rate: ${oldPct}% → ${newPct}%.`,
  });

  // Election results
  world.events.push({
    tick: world.tick,
    type: 'election_detail',
    text: `Votes: ${sorted.map(([id, v]) => `${npcs.find(n => n.id === id).name}: ${v}`).join(', ')}`,
  });

  // If tax changed, everyone forms a memory
  if (world.taxRate !== oldTaxRate) {
    const raised = world.taxRate > oldTaxRate;
    for (const npc of npcs) {
      const valence = raised ? -0.5 * npc.genome.fairnessSens : 0.3 * npc.genome.fairnessSens;
      formMemory(npc, raised ? 'tax_raised' : 'tax_lowered', valence, world.taxRate, world.tick);
    }
  }

  // Everyone remembers the election
  for (const npc of npcs) {
    formMemory(npc, 'election', 0.1, world.tick, world.tick);
  }
}

function tickGranaryCheck(world) {
  if (world.granary < 10) {
    for (const npc of world.npcs) {
      npc.opinions.satisfaction = Math.max(-1, npc.opinions.satisfaction - 0.1);
      npc.opinions.leaderApproval = Math.max(-1, npc.opinions.leaderApproval - 0.15);
      formMemory(npc, 'food_shortage', -0.6, world.granary, world.tick);
    }
    world.events.push({
      tick: world.tick,
      type: 'crisis',
      text: `FOOD CRISIS: Granary at ${world.granary} food!`,
    });
  } else if (world.granary > 100) {
    for (const npc of world.npcs) {
      npc.opinions.satisfaction = Math.min(1, npc.opinions.satisfaction + 0.05);
      npc.opinions.leaderApproval = Math.min(1, npc.opinions.leaderApproval + 0.05);
    }
    world.events.push({
      tick: world.tick,
      type: 'surplus',
      text: `Granary surplus: ${world.granary} food stored.`,
    });
  }
}

function detectFactions(world) {
  const npcs = world.npcs;
  // Simple clustering: anti-tax (< -0.2), pro-tax (> 0.2), unaligned
  const antiTax = npcs.filter(n => n.opinions.taxSentiment < -0.2);
  const proTax = npcs.filter(n => n.opinions.taxSentiment > 0.2);
  const unaligned = npcs.filter(n => Math.abs(n.opinions.taxSentiment) <= 0.2);

  const factions = [];
  if (antiTax.length >= 2) {
    const avg = antiTax.reduce((s, n) => s + n.opinions.taxSentiment, 0) / antiTax.length;
    factions.push({
      name: 'The Tillers',
      emoji: '🌾',
      desc: 'anti-tax, farmer-heavy',
      members: antiTax,
      avgSentiment: avg,
    });
  }
  if (proTax.length >= 2) {
    const avg = proTax.reduce((s, n) => s + n.opinions.taxSentiment, 0) / proTax.length;
    factions.push({
      name: 'The Shields',
      emoji: '🛡️',
      desc: 'pro-tax, guard/miller-heavy',
      members: proTax,
      avgSentiment: avg,
    });
  }

  return { factions, unaligned };
}

function giniCoefficient(npcs) {
  const vals = npcs.map(n => n.wealth).sort((a, b) => a - b);
  const n = vals.length;
  if (n === 0) return 0;
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  if (mean === 0) return 0;
  let sumDiffs = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      sumDiffs += Math.abs(vals[i] - vals[j]);
    }
  }
  return sumDiffs / (2 * n * n * mean);
}

module.exports = { tickElection, tickGranaryCheck, detectFactions, giniCoefficient };
