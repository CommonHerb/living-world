'use strict';

const { formMemory } = require('./memory');
const { recordEvent } = require('./chronicle');

/**
 * Elections for council governments.
 * Monarchy succession for monarchies.
 * Now operates per-settlement.
 */

function tickElection(settlement, tick) {
  if (settlement.government === 'monarchy') {
    return tickMonarchySuccession(settlement, tick);
  }
  return tickCouncilElection(settlement, tick);
}

function tickCouncilElection(settlement, tick) {
  const rng = settlement.tickRng;
  const npcs = settlement.npcs.filter(n => n.alive !== false && !n.isChild);
  if (npcs.length < 3) return;

  const candidacyScore = (npc) =>
    npc.genome.assertiveness * 0.4 +
    npc.genome.riskTolerance * 0.3 +
    Math.max(0, -npc.opinions.satisfaction) * 0.3;

  const scored = npcs.map(n => ({ npc: n, score: candidacyScore(n) }))
    .sort((a, b) => b.score - a.score);
  let candidates = scored.slice(0, Math.max(4, Math.min(6, scored.filter(s => s.score > 0.4).length)))
    .map(s => s.npc);

  const votes = new Map();
  for (const c of candidates) votes.set(c.id, 0);
  const incumbentSet = new Set(settlement.council);

  const avgSatisfaction = npcs.reduce((s, n) => s + n.opinions.satisfaction, 0) / npcs.length;

  for (const voter of npcs) {
    let bestCandidate = candidates[0];
    let bestScore = -Infinity;

    for (const cand of candidates) {
      const policyDist = Math.abs(voter.opinions.taxSentiment - cand.opinions.taxSentiment);
      let score = -policyDist;

      const isIncumbent = incumbentSet.has(cand.id);
      if (isIncumbent && avgSatisfaction < -0.2) {
        score -= 0.15 + Math.abs(avgSatisfaction) * 0.2;
      }
      if (isIncumbent && voter.genome.stubbornness > 0.6 && avgSatisfaction > -0.2) {
        score += 0.1;
      }
      if (isIncumbent) {
        const crisisMemories = voter.memories.filter(m =>
          (m.eventType === 'crisis' || m.eventType === 'food_shortage') && m.fidelity > 0.3
        );
        if (crisisMemories.length > 3) {
          score -= 0.2;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestCandidate = cand;
      }
    }
    votes.set(bestCandidate.id, (votes.get(bestCandidate.id) || 0) + 1);
  }

  const sorted = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  const oldCouncil = [...settlement.council];
  settlement.council = sorted.slice(0, 3).map(([id]) => id);
  const councilNPCs = settlement.council.map(id => npcs.find(n => n.id === id));

  const oldTaxRate = settlement.taxRate;
  const avgSentiment = councilNPCs.reduce((s, n) => s + n.opinions.taxSentiment, 0) / councilNPCs.length;
  settlement.taxRate = Math.round((0.275 + avgSentiment * 0.225) * 100) / 100;
  settlement.taxRate = Math.max(0.05, Math.min(0.50, settlement.taxRate));

  const councilNames = councilNPCs.map(n => `${n.name} (${n.job[0].toUpperCase()})`).join(', ');
  const oldPct = Math.round(oldTaxRate * 100);
  const newPct = Math.round(settlement.taxRate * 100);
  const changesLeadership = !oldCouncil.every(id => settlement.council.includes(id));

  settlement.events.push({
    tick,
    type: 'election',
    text: `ELECTION: ${councilNames} elected. Tax rate: ${oldPct}% → ${newPct}%.`,
  });

  settlement.events.push({
    tick,
    type: 'election_detail',
    text: `Votes: ${sorted.map(([id, v]) => `${npcs.find(n => n.id === id).name}: ${v}`).join(', ')}`,
  });

  if (settlement.chronicle) {
    recordEvent(settlement.chronicle, tick, 'election',
      councilNPCs.map(n => ({ id: n.id, name: n.name, role: 'council' })),
      `${councilNames} elected to council. Tax: ${oldPct}% → ${newPct}%.`,
      { changesLeadership, affectsAll: true, affectedCount: npcs.length }
    );
  }

  if (settlement.taxRate !== oldTaxRate) {
    const raised = settlement.taxRate > oldTaxRate;
    const tag = raised ? 'tax_raised' : 'tax_lowered';

    if (settlement.chronicle) {
      recordEvent(settlement.chronicle, tick, 'tax_change',
        councilNPCs.map(n => ({ id: n.id, name: n.name, role: 'council' })),
        `Tax rate ${raised ? 'raised' : 'lowered'} from ${oldPct}% to ${newPct}%.`,
        { affectsAll: true, affectedCount: npcs.length }
      );
    }

    for (const npc of npcs) {
      const valence = raised ? -0.5 * npc.genome.fairnessSens : 0.3 * npc.genome.fairnessSens;
      formMemory(npc, tag, 'council', settlement.taxRate, valence, tick);
    }
  }

  for (const npc of npcs) {
    const winnersIncludeMe = settlement.council.includes(npc.id);
    const valence = winnersIncludeMe ? 0.3 : 0.1;
    formMemory(npc, 'election', 'council', tick, valence, tick);
  }
}

/**
 * Monarchy succession — the monarch rules until death or overthrow.
 * Check for coups when satisfaction is very low.
 */
function tickMonarchySuccession(settlement, tick) {
  const rng = settlement.tickRng;
  const npcs = settlement.npcs.filter(n => n.alive !== false && !n.isChild);
  if (npcs.length === 0) return;

  const monarchId = settlement.council[0];
  const monarch = npcs.find(n => n.id === monarchId);

  // If monarch is dead or gone, pick new one
  if (!monarch) {
    const sorted = [...npcs].sort((a, b) => b.genome.assertiveness - a.genome.assertiveness);
    settlement.council = [sorted[0].id];
    settlement.events.push({
      tick,
      type: 'succession',
      text: `${sorted[0].name} has claimed the throne of ${settlement.name}.`,
    });
    recordEvent(settlement.chronicle, tick, 'succession',
      [{ id: sorted[0].id, name: sorted[0].name, role: 'monarch' }],
      `${sorted[0].name} claimed the throne after the previous ruler's departure.`,
      { changesLeadership: true, affectsAll: true, affectedCount: npcs.length }
    );
    return;
  }

  // Monarch sets tax rate based on their own sentiment
  const oldTaxRate = settlement.taxRate;
  settlement.taxRate = Math.round((0.275 + monarch.opinions.taxSentiment * 0.225) * 100) / 100;
  settlement.taxRate = Math.max(0.05, Math.min(0.50, settlement.taxRate));

  // Coup check: if average satisfaction is very low and an assertive challenger exists
  const avgSat = npcs.reduce((s, n) => s + n.opinions.satisfaction, 0) / npcs.length;
  if (avgSat < -0.4) {
    const challengers = npcs.filter(n => 
      n.id !== monarchId && 
      n.genome.assertiveness > 0.7 && 
      n.opinions.satisfaction < -0.3
    );
    if (challengers.length > 0 && rng.random() < 0.15) {
      const challenger = challengers.sort((a, b) => b.genome.assertiveness - a.genome.assertiveness)[0];
      settlement.council = [challenger.id];
      settlement.events.push({
        tick,
        type: 'coup',
        text: `COUP: ${challenger.name} has overthrown ${monarch.name} as ruler of ${settlement.name}!`,
      });
      recordEvent(settlement.chronicle, tick, 'coup',
        [{ id: challenger.id, name: challenger.name, role: 'usurper' },
         { id: monarch.id, name: monarch.name, role: 'deposed' }],
        `${challenger.name} overthrew ${monarch.name} in a coup. The people's anger had reached a breaking point.`,
        { changesLeadership: true, affectsAll: true, affectedCount: npcs.length, crisisLevel: 2 }
      );
      for (const npc of npcs) {
        formMemory(npc, 'coup', settlement.name, tick, 
          npc.opinions.satisfaction < 0 ? 0.3 : -0.5, tick);
      }
    }
  }

  if (settlement.taxRate !== oldTaxRate) {
    const raised = settlement.taxRate > oldTaxRate;
    const oldPct = Math.round(oldTaxRate * 100);
    const newPct = Math.round(settlement.taxRate * 100);

    settlement.events.push({
      tick,
      type: 'decree',
      text: `Royal decree: Tax rate ${raised ? 'raised' : 'lowered'} from ${oldPct}% to ${newPct}%.`,
    });

    for (const npc of npcs) {
      const valence = raised ? -0.5 * npc.genome.fairnessSens : 0.3 * npc.genome.fairnessSens;
      formMemory(npc, raised ? 'tax_raised' : 'tax_lowered', 'monarch', settlement.taxRate, valence, tick);
    }
  }
}

/**
 * Treasury check — per settlement.
 */
function tickTreasuryCheck(settlement, tick) {
  const livingNpcs = settlement.npcs.filter(n => n.alive !== false && !n.isChild);

  if (settlement.treasury < 5) {
    if (tick % 15 === 0) {
      for (const npc of livingNpcs) {
        formMemory(npc, 'crisis', 'treasury', settlement.treasury, -0.7, tick);
      }
    }
    settlement.events.push({
      tick,
      type: 'crisis',
      text: `TREASURY CRISIS: Only ${Math.floor(settlement.treasury)}g remaining!`,
    });
    if (settlement.chronicle) {
      recordEvent(settlement.chronicle, tick, 'crisis',
        [{ id: -1, name: settlement.name, role: 'settlement' }],
        `Treasury crisis! Only ${Math.floor(settlement.treasury)}g. Guards may go unpaid.`,
        { affectsAll: true, affectedCount: livingNpcs.length, crisisLevel: 3 }
      );
    }
  } else if (settlement.treasury > 100) {
    for (const npc of livingNpcs) {
      formMemory(npc, 'surplus', 'treasury', settlement.treasury, 0.3, tick);
    }
    settlement.events.push({
      tick,
      type: 'surplus',
      text: `Treasury surplus: ${Math.floor(settlement.treasury)}g stored.`,
    });
    if (settlement.chronicle) {
      recordEvent(settlement.chronicle, tick, 'surplus',
        [{ id: -1, name: settlement.name, role: 'settlement' }],
        `Surplus! Treasury holds ${Math.floor(settlement.treasury)}g.`,
        { affectsAll: true }
      );
    }
  }
}

function detectFactions(settlement) {
  const npcs = settlement.npcs.filter(n => n.alive !== false && !n.isChild);
  const antiTax = npcs.filter(n => n.opinions.taxSentiment < -0.1);
  const proTax = npcs.filter(n => n.opinions.taxSentiment > 0.1);
  const unaligned = npcs.filter(n => Math.abs(n.opinions.taxSentiment) <= 0.1);

  const factions = [];
  if (antiTax.length >= 2) {
    const avg = antiTax.reduce((s, n) => s + n.opinions.taxSentiment, 0) / antiTax.length;
    factions.push({
      name: 'The Tillers', emoji: '🌾', desc: 'anti-tax, producer-heavy',
      members: antiTax, avgSentiment: avg,
    });
  }
  if (proTax.length >= 2) {
    const avg = proTax.reduce((s, n) => s + n.opinions.taxSentiment, 0) / proTax.length;
    factions.push({
      name: 'The Shields', emoji: '🛡️', desc: 'pro-tax, guard/consumer-heavy',
      members: proTax, avgSentiment: avg,
    });
  }

  return { factions, unaligned };
}

function giniCoefficient(npcs) {
  const vals = npcs.map(n => n.gold).sort((a, b) => a - b);
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

module.exports = { tickElection, tickTreasuryCheck, detectFactions, giniCoefficient };
