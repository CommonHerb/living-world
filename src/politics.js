'use strict';

const { formMemory } = require('./memory');
const { recordEvent } = require('./chronicle');

function tickElection(world) {
  const rng = world.tickRng;
  const npcs = world.npcs;

  let candidates = npcs.filter(n => n.genome.assertiveness > 0.6);
  if (candidates.length < 3) {
    const pool = npcs.filter(n => !candidates.includes(n));
    rng.shuffle(pool);
    while (candidates.length < 3 && pool.length > 0) {
      candidates.push(pool.pop());
    }
  }

  const votes = new Map();
  for (const c of candidates) votes.set(c.id, 0);
  const incumbentSet = new Set(world.council);

  for (const voter of npcs) {
    let bestCandidate = candidates[0];
    let bestDist = Math.abs(voter.opinions.taxSentiment - candidates[0].opinions.taxSentiment);

    for (let i = 1; i < candidates.length; i++) {
      const d = Math.abs(voter.opinions.taxSentiment - candidates[i].opinions.taxSentiment);
      const incumbentBonus = (incumbentSet.has(candidates[i].id) && voter.genome.stubbornness > 0.7) ? 0.2 : 0;
      if (d - incumbentBonus < bestDist) {
        bestDist = d - incumbentBonus;
        bestCandidate = candidates[i];
      }
    }
    votes.set(bestCandidate.id, (votes.get(bestCandidate.id) || 0) + 1);
  }

  const sorted = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  const oldCouncil = [...world.council];
  world.council = sorted.slice(0, 3).map(([id]) => id);
  const councilNPCs = world.council.map(id => npcs.find(n => n.id === id));

  const oldTaxRate = world.taxRate;
  const avgSentiment = councilNPCs.reduce((s, n) => s + n.opinions.taxSentiment, 0) / councilNPCs.length;
  world.taxRate = Math.round((0.275 + avgSentiment * 0.225) * 100) / 100;
  world.taxRate = Math.max(0.05, Math.min(0.50, world.taxRate));

  const councilNames = councilNPCs.map(n => `${n.name} (${n.job[0].toUpperCase()})`).join(', ');
  const oldPct = Math.round(oldTaxRate * 100);
  const newPct = Math.round(world.taxRate * 100);

  const changesLeadership = !oldCouncil.every(id => world.council.includes(id));

  world.events.push({
    tick: world.tick,
    type: 'election',
    text: `ELECTION: ${councilNames} elected. Tax rate: ${oldPct}% → ${newPct}%.`,
  });

  world.events.push({
    tick: world.tick,
    type: 'election_detail',
    text: `Votes: ${sorted.map(([id, v]) => `${npcs.find(n => n.id === id).name}: ${v}`).join(', ')}`,
  });

  if (world.chronicle) {
    recordEvent(world.chronicle, world.tick, 'election',
      councilNPCs.map(n => ({ id: n.id, name: n.name, role: 'council' })),
      `${councilNames} elected to council. Tax: ${oldPct}% → ${newPct}%.`,
      { changesLeadership, affectsAll: true, affectedCount: npcs.length }
    );
  }

  if (world.taxRate !== oldTaxRate) {
    const raised = world.taxRate > oldTaxRate;
    const tag = raised ? 'tax_raised' : 'tax_lowered';

    if (world.chronicle) {
      recordEvent(world.chronicle, world.tick, 'tax_change',
        councilNPCs.map(n => ({ id: n.id, name: n.name, role: 'council' })),
        `Tax rate ${raised ? 'raised' : 'lowered'} from ${oldPct}% to ${newPct}%.`,
        { affectsAll: true, affectedCount: npcs.length }
      );
    }

    for (const npc of npcs) {
      const valence = raised ? -0.5 * npc.genome.fairnessSens : 0.3 * npc.genome.fairnessSens;
      formMemory(npc, tag, 'council', world.taxRate, valence, world.tick);
    }
  }

  for (const npc of npcs) {
    const winnersIncludeMe = world.council.includes(npc.id);
    const valence = winnersIncludeMe ? 0.3 : 0.1;
    formMemory(npc, 'election', 'council', world.tick, valence, world.tick);
  }
}

/**
 * Treasury check — replaces granary check.
 * Low treasury = crisis (can't pay guards, no emergency relief).
 * High treasury = surplus.
 */
function tickTreasuryCheck(world) {
  if (world.treasury < 5) {
    if (world.tick % 5 === 0) {
      for (const npc of world.npcs) {
        formMemory(npc, 'crisis', 'treasury', world.treasury, -0.7, world.tick);
      }
    }
    world.events.push({
      tick: world.tick,
      type: 'crisis',
      text: `TREASURY CRISIS: Only ${Math.floor(world.treasury)}g remaining!`,
    });

    if (world.chronicle) {
      recordEvent(world.chronicle, world.tick, 'crisis',
        [{ id: -1, name: 'Millhaven', role: 'settlement' }],
        `Treasury crisis! Only ${Math.floor(world.treasury)}g. Guards may go unpaid.`,
        { affectsAll: true, affectedCount: world.npcs.length, crisisLevel: 3 }
      );
    }
  } else if (world.treasury > 100) {
    for (const npc of world.npcs) {
      formMemory(npc, 'surplus', 'treasury', world.treasury, 0.3, world.tick);
    }
    world.events.push({
      tick: world.tick,
      type: 'surplus',
      text: `Treasury surplus: ${Math.floor(world.treasury)}g stored.`,
    });

    if (world.chronicle) {
      recordEvent(world.chronicle, world.tick, 'surplus',
        [{ id: -1, name: 'Millhaven', role: 'settlement' }],
        `Surplus! Treasury holds ${Math.floor(world.treasury)}g.`,
        { affectsAll: true }
      );
    }
  }
}

function detectFactions(world) {
  const npcs = world.npcs;
  const antiTax = npcs.filter(n => n.opinions.taxSentiment < -0.2);
  const proTax = npcs.filter(n => n.opinions.taxSentiment > 0.2);
  const unaligned = npcs.filter(n => Math.abs(n.opinions.taxSentiment) <= 0.2);

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
