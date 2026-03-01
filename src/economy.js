'use strict';

const { formMemory } = require('./memory');
const { recordEvent } = require('./chronicle');
const { COMMODITIES, COMMODITY_INFO, generateOrders, clearMarket, updateBeliefs, handleBankruptcy } = require('./market');

/**
 * Phase 3: Multi-commodity production → market → consumption
 * 
 * Now operates per-settlement. Each settlement has its own independent economy.
 */

function tickEconomy(settlement, tick) {
  const rng = settlement.tickRng;
  let hungerCount = 0;
  const hungryNPCs = [];

  const activeNpcs = settlement.npcs.filter(n => n.alive !== false && !n.isChild);

  // === 0. SUBSISTENCE ===
  for (const npc of activeNpcs) {
    npc.gold += 0.5;
  }

  // === 1. PRODUCTION ===
  for (const npc of activeNpcs) {
    switch (npc.job) {
      case 'farmer': {
        const produced = rng.int(3, 6);
        npc.inventory.grain += produced;
        break;
      }
      case 'miller': {
        const grainAvail = npc.inventory.grain;
        const batchesFromGrain = Math.floor(grainAvail / 2);
        const batches = Math.min(batchesFromGrain, 2);
        if (batches > 0) {
          npc.inventory.grain -= batches * 2;
          npc.inventory.flour += batches * 3;
        }
        break;
      }
      case 'woodcutter': {
        const produced = rng.int(1, 3);
        npc.inventory.wood += produced;
        break;
      }
      case 'miner': {
        const produced = rng.int(1, 3);
        npc.inventory.stone += produced;
        break;
      }
      case 'smith': {
        const batches = Math.min(npc.inventory.wood, npc.inventory.stone, 2);
        if (batches > 0) {
          npc.inventory.wood -= batches;
          npc.inventory.stone -= batches;
          npc.inventory.tools += batches;
        }
        break;
      }
      case 'guard': {
        const stipend = Math.min(2, Math.max(1, Math.floor(settlement.treasury * 0.03)));
        if (settlement.treasury >= stipend) {
          settlement.treasury -= stipend;
          npc.gold += stipend;
        }
        break;
      }
    }
  }

  // === 2. MARKET (BazaarBot) ===
  // generateOrders/clearMarket/updateBeliefs now work on settlement
  const { bids, asks } = generateOrders(settlement);
  const tradeResults = clearMarket(settlement, bids, asks);
  updateBeliefs(settlement, tradeResults, tradeResults.failures);

  const totalTrades = tradeResults.results.length;
  const totalTax = tradeResults.results.reduce((s, t) => s + t.tax, 0);

  // === 3. CONSUMPTION ===
  for (const npc of activeNpcs) {
    const foodNeeded = npc.genome.metabolism;
    let foodEaten = 0;

    if (npc.inventory.flour > 0) {
      const fromFlour = Math.min(npc.inventory.flour, foodNeeded);
      npc.inventory.flour -= fromFlour;
      foodEaten += fromFlour;
    }
    if (foodEaten < foodNeeded && npc.inventory.grain > 0) {
      const fromGrain = Math.min(npc.inventory.grain, foodNeeded - foodEaten);
      npc.inventory.grain -= fromGrain;
      foodEaten += fromGrain;
    }

    if (foodEaten >= foodNeeded) {
      npc.opinions.satisfaction = Math.min(1, npc.opinions.satisfaction + 0.03);
      if (tick % 10 === 0) {
        formMemory(npc, 'good_trade', 'self', foodEaten, 0.3, tick);
      }
    } else {
      formMemory(npc, 'food_shortage', 'self', npc.gold, -0.5, tick);
      hungerCount++;
      hungryNPCs.push(npc);
      npc.opinions.satisfaction = Math.max(-1, npc.opinions.satisfaction - 0.05);
    }
  }

  // === 3b. JOB SWITCHING ===
  for (const npc of hungryNPCs) {
    if (npc.job !== 'farmer' && npc.job !== 'guard') {
      const switchChance = 0.08 + npc.genome.riskTolerance * 0.07;
      if (rng.random() < switchChance) {
        const oldJob = npc.job;
        npc.job = 'farmer';
        const ideal = { grain: 4, flour: 2, wood: 1, stone: 0, tools: 1 };
        for (const c of COMMODITIES) {
          npc.idealInventory[c] = ideal[c] || 0;
        }
        settlement.events.push({
          tick,
          type: 'job_switch',
          text: `${npc.name} switched from ${oldJob} to farmer out of hunger.`,
        });
        if (settlement.chronicle) {
          recordEvent(settlement.chronicle, tick, 'job_switch',
            [{ id: npc.id, name: npc.name, role: oldJob }],
            `${npc.name} abandoned ${oldJob} work to become a farmer, driven by hunger.`,
            { affectedCount: 1 }
          );
        }
      }
    }
  }

  // === 3c. GOOD HARVEST ===
  if (rng.random() < 0.10) {
    const farmers = activeNpcs.filter(n => n.job === 'farmer');
    const bonus = rng.int(2, 4);
    for (const f of farmers) {
      f.inventory.grain += bonus;
    }
    settlement.events.push({
      tick,
      type: 'good_harvest',
      text: `Good harvest! Farmers each gained ${bonus} extra grain.`,
    });
    if (settlement.chronicle) {
      recordEvent(settlement.chronicle, tick, 'good_harvest',
        [{ id: -1, name: settlement.name, role: 'settlement' }],
        `Favorable weather brought a bountiful harvest. Each farmer gained ${bonus} extra grain.`,
        { affectsAll: false, affectedCount: farmers.length }
      );
    }
  }

  // === 4. EMERGENCY RELIEF ===
  if (hungerCount > activeNpcs.length * 0.3 && settlement.treasury > 5) {
    const relief = Math.min(Math.floor(settlement.treasury * 0.3), hungerCount * 2);
    settlement.treasury -= relief;
    const perNPC = Math.max(1, Math.floor(relief / hungerCount));
    for (const npc of hungryNPCs) {
      npc.inventory.grain += perNPC;
      formMemory(npc, 'relief', 'treasury', perNPC, 0.5, tick);
    }
    if (settlement.chronicle) {
      recordEvent(settlement.chronicle, tick, 'relief',
        [{ id: -1, name: 'Treasury', role: 'institution' }],
        `Emergency relief: ${relief} gold spent feeding ${hungerCount} hungry residents.`,
        { affectsAll: false, affectedCount: hungerCount }
      );
    }
  }

  // === 5. BANKRUPTCY CHECK ===
  const bankruptcies = handleBankruptcy(settlement);
  for (const b of bankruptcies) {
    settlement.events.push({
      tick,
      type: 'bankruptcy',
      text: `${b.npc.name} went bankrupt as ${b.oldJob}, became ${b.newJob}.`,
    });
    formMemory(b.npc, 'bankruptcy', 'self', 0, -0.9, tick);
    if (settlement.chronicle) {
      recordEvent(settlement.chronicle, tick, 'bankruptcy',
        [{ id: b.npc.id, name: b.npc.name, role: b.oldJob }],
        `${b.npc.name} went bankrupt as ${b.oldJob} and switched to ${b.newJob}.`,
        { affectedCount: 1 }
      );
    }
  }

  // === EVENTS ===
  if (hungerCount > 0) {
    settlement.events.push({
      tick,
      type: 'hunger',
      text: `${hungerCount} NPC${hungerCount > 1 ? 's' : ''} went hungry.`,
    });
    if (settlement.chronicle) {
      recordEvent(settlement.chronicle, tick, 'hunger',
        hungryNPCs.slice(0, 5).map(n => ({ id: n.id, name: n.name, role: n.job })),
        `${hungerCount} residents went hungry. Treasury: ${Math.floor(settlement.treasury)}.`,
        { affectedCount: hungerCount }
      );
    }
  }

  const priceStr = COMMODITIES
    .filter(c => settlement.market.lastClearingPrices[c] !== null)
    .map(c => `${c}:${settlement.market.lastClearingPrices[c].toFixed(1)}g`)
    .join(' ');

  settlement.events.push({
    tick,
    type: 'economy',
    text: `Market: ${totalTrades} trades, ${totalTax.toFixed(1)}g taxed. Treasury: ${Math.floor(settlement.treasury)}g. Prices: ${priceStr || 'no trades'}`,
  });
}

module.exports = { tickEconomy };
