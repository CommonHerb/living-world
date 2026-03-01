'use strict';

const { formMemory } = require('./memory');
const { recordEvent } = require('./chronicle');
const { COMMODITIES, COMMODITY_INFO, generateOrders, clearMarket, updateBeliefs, handleBankruptcy } = require('./market');

/**
 * Phase 3: Multi-commodity production → market → consumption
 * 
 * Flow each tick:
 * 1. PRODUCE: NPCs generate goods into inventory based on job
 * 2. MARKET: BazaarBot double auction clears trades
 * 3. CONSUME: NPCs eat food (grain or flour). Hunger if they can't.
 * 4. GUARDS: Paid from treasury, buy food on market like everyone else
 * 5. BANKRUPTCY: Broke NPCs switch jobs
 */

function tickEconomy(world) {
  const rng = world.tickRng;
  let hungerCount = 0;
  const hungryNPCs = [];

  // === 0. SUBSISTENCE ===
  // Small base income prevents total liquidity collapse
  for (const npc of world.npcs) {
    npc.gold += 0.5;  // foraging, odd jobs, barter equivalent
  }

  // === 1. PRODUCTION ===
  for (const npc of world.npcs) {
    switch (npc.job) {
      case 'farmer': {
        const produced = rng.int(3, 6);
        npc.inventory.grain += produced;
        break;
      }
      case 'miller': {
        // Convert grain → flour (2 grain → 3 flour)
        const grainAvail = npc.inventory.grain;
        const batchesFromGrain = Math.floor(grainAvail / 2);
        const batches = Math.min(batchesFromGrain, 2); // max 2 batches/tick
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
        // Convert wood + stone → tools (1 wood + 1 stone → 1 tool)
        const batches = Math.min(npc.inventory.wood, npc.inventory.stone, 2);
        if (batches > 0) {
          npc.inventory.wood -= batches;
          npc.inventory.stone -= batches;
          npc.inventory.tools += batches;
        }
        break;
      }
      case 'guard': {
        // Guards produce nothing tradeable — paid from treasury
        const stipend = Math.min(2, Math.max(1, Math.floor(world.treasury * 0.03)));
        if (world.treasury >= stipend) {
          world.treasury -= stipend;
          npc.gold += stipend;
        }
        break;
      }
    }
  }

  // === 2. MARKET (BazaarBot) ===
  const { bids, asks } = generateOrders(world);
  const tradeResults = clearMarket(world, bids, asks);
  updateBeliefs(world, tradeResults, tradeResults.failures);

  const totalTrades = tradeResults.results.length;
  const totalTax = tradeResults.results.reduce((s, t) => s + t.tax, 0);

  // === 3. CONSUMPTION ===
  for (const npc of world.npcs) {
    const foodNeeded = npc.genome.metabolism;
    let foodEaten = 0;

    // Prefer flour (higher value), then grain
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
      // Well fed — slow satisfaction recovery
      npc.opinions.satisfaction = Math.min(1, npc.opinions.satisfaction + 0.03);
      // Occasional positive memory from being well-fed
      if (world.tick % 10 === 0) {
        formMemory(npc, 'good_trade', 'self', foodEaten, 0.3, world.tick);
      }
    } else {
      // HUNGRY — can't eat enough
      formMemory(npc, 'food_shortage', 'self', npc.gold, -0.5, world.tick);
      hungerCount++;
      hungryNPCs.push(npc);
      npc.opinions.satisfaction = Math.max(-1, npc.opinions.satisfaction - 0.05);
    }
  }

  // === 3b. JOB SWITCHING (rational self-interest) ===
  // Hungry non-farmers may switch to farming
  for (const npc of hungryNPCs) {
    if (npc.job !== 'farmer' && npc.job !== 'guard') {
      // Higher chance if very hungry (low satisfaction) and risk-tolerant
      const switchChance = 0.08 + npc.genome.riskTolerance * 0.07;
      if (rng.random() < switchChance) {
        const oldJob = npc.job;
        npc.job = 'farmer';
        const ideal = { grain: 4, flour: 2, wood: 1, stone: 0, tools: 1 };
        for (const c of COMMODITIES) {
          npc.idealInventory[c] = ideal[c] || 0;
        }
        world.events.push({
          tick: world.tick,
          type: 'job_switch',
          text: `${npc.name} switched from ${oldJob} to farmer out of hunger.`,
        });
        if (world.chronicle) {
          recordEvent(world.chronicle, world.tick, 'job_switch',
            [{ id: npc.id, name: npc.name, role: oldJob }],
            `${npc.name} abandoned ${oldJob} work to become a farmer, driven by hunger.`,
            { affectedCount: 1 }
          );
        }
      }
    }
  }

  // === 3c. GOOD HARVEST (random weather event) ===
  // ~10% chance per tick of a good harvest boosting all farmer output
  if (rng.random() < 0.10) {
    const farmers = world.npcs.filter(n => n.job === 'farmer');
    const bonus = rng.int(2, 4);
    for (const f of farmers) {
      f.inventory.grain += bonus;
    }
    world.events.push({
      tick: world.tick,
      type: 'good_harvest',
      text: `Good harvest! Farmers each gained ${bonus} extra grain.`,
    });
    if (world.chronicle) {
      recordEvent(world.chronicle, world.tick, 'good_harvest',
        [{ id: -1, name: 'Millhaven', role: 'settlement' }],
        `Favorable weather brought a bountiful harvest. Each farmer gained ${bonus} extra grain.`,
        { affectsAll: false, affectedCount: farmers.length }
      );
    }
  }

  // === 4. EMERGENCY RELIEF ===
  // If many hungry and treasury has funds, buy grain and distribute
  if (hungerCount > world.npcs.length * 0.3 && world.treasury > 5) {
    const relief = Math.min(Math.floor(world.treasury * 0.3), hungerCount * 2);
    world.treasury -= relief;
    // Distribute as grain to hungry NPCs
    const perNPC = Math.max(1, Math.floor(relief / hungerCount));
    for (const npc of hungryNPCs) {
      npc.inventory.grain += perNPC;
      formMemory(npc, 'relief', 'treasury', perNPC, 0.5, world.tick);
    }
    if (world.chronicle) {
      recordEvent(world.chronicle, world.tick, 'relief',
        [{ id: -1, name: 'Treasury', role: 'institution' }],
        `Emergency relief: ${relief} gold spent feeding ${hungerCount} hungry residents.`,
        { affectsAll: false, affectedCount: hungerCount }
      );
    }
  }

  // === 5. BANKRUPTCY CHECK ===
  const bankruptcies = handleBankruptcy(world);
  for (const b of bankruptcies) {
    world.events.push({
      tick: world.tick,
      type: 'bankruptcy',
      text: `${b.npc.name} went bankrupt as ${b.oldJob}, became ${b.newJob}.`,
    });
    formMemory(b.npc, 'bankruptcy', 'self', 0, -0.9, world.tick);
    if (world.chronicle) {
      recordEvent(world.chronicle, world.tick, 'bankruptcy',
        [{ id: b.npc.id, name: b.npc.name, role: b.oldJob }],
        `${b.npc.name} went bankrupt as ${b.oldJob} and switched to ${b.newJob}.`,
        { affectedCount: 1 }
      );
    }
  }

  // === EVENTS ===
  if (hungerCount > 0) {
    world.events.push({
      tick: world.tick,
      type: 'hunger',
      text: `${hungerCount} NPC${hungerCount > 1 ? 's' : ''} went hungry.`,
    });
    if (world.chronicle) {
      recordEvent(world.chronicle, world.tick, 'hunger',
        hungryNPCs.slice(0, 5).map(n => ({ id: n.id, name: n.name, role: n.job })),
        `${hungerCount} residents went hungry. Treasury: ${Math.floor(world.treasury)}.`,
        { affectedCount: hungerCount }
      );
    }
  }

  // Market summary event
  const priceStr = COMMODITIES
    .filter(c => world.market.lastClearingPrices[c] !== null)
    .map(c => `${c}:${world.market.lastClearingPrices[c].toFixed(1)}g`)
    .join(' ');

  world.events.push({
    tick: world.tick,
    type: 'economy',
    text: `Market: ${totalTrades} trades, ${totalTax.toFixed(1)}g taxed. Treasury: ${Math.floor(world.treasury)}g. Prices: ${priceStr || 'no trades'}`,
  });
}

module.exports = { tickEconomy };
