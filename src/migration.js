'use strict';

const { formMemory } = require('./memory');
const { recordEvent } = require('./chronicle');
const { initNPCMarketData } = require('./market');
const { getSettlementSatisfaction, getLivingAdults } = require('./settlement');

/**
 * Migration — NPCs move between settlements based on satisfaction.
 * 
 * Rules:
 * - Only unhappy NPCs consider leaving (satisfaction < -0.2)
 * - They compare their settlement's avg satisfaction to others
 * - Risk-tolerant NPCs migrate more readily
 * - NPCs carry their gold and some inventory
 * - Minimum 5 adults must remain (settlement doesn't die)
 */

const MIGRATION_CHECK_INTERVAL = 10;  // check every N ticks
const MIN_POPULATION = 5;             // settlement can't go below this
const SATISFACTION_THRESHOLD = -0.2;   // must be unhappy to consider leaving
const BASE_MIGRATE_CHANCE = 0.15;      // base probability per unhappy NPC

function tickMigration(world) {
  if (world.tick % MIGRATION_CHECK_INTERVAL !== 0) return;
  if (world.settlements.length < 2) return;

  const rng = world.tickRng;
  const migrations = [];

  // Compute settlement attractiveness
  const attractiveness = new Map();
  for (const s of world.settlements) {
    const avgSat = getSettlementSatisfaction(s);
    const adults = getLivingAdults(s);
    const avgGold = adults.length > 0 
      ? adults.reduce((sum, n) => sum + n.gold, 0) / adults.length 
      : 0;
    // Attractiveness = satisfaction + economic prosperity signal
    attractiveness.set(s.id, avgSat * 0.6 + Math.min(1, avgGold / 50) * 0.4);
  }

  for (const settlement of world.settlements) {
    const adults = getLivingAdults(settlement);
    if (adults.length <= MIN_POPULATION) continue;

    const myAttractiveness = attractiveness.get(settlement.id);

    for (const npc of adults) {
      if (npc.opinions.satisfaction > SATISFACTION_THRESHOLD) continue;

      // Find most attractive other settlement
      let bestTarget = null;
      let bestScore = myAttractiveness;

      for (const other of world.settlements) {
        if (other.id === settlement.id) continue;
        const score = attractiveness.get(other.id);
        if (score > bestScore) {
          bestScore = score;
          bestTarget = other;
        }
      }

      if (!bestTarget) continue;

      // Migration probability: base * risk tolerance * dissatisfaction magnitude
      const dissatisfaction = Math.abs(npc.opinions.satisfaction);
      const chance = BASE_MIGRATE_CHANCE * npc.genome.riskTolerance * dissatisfaction;

      if (rng.random() < chance) {
        // Check population floor again (might have changed during iteration)
        const currentAdults = getLivingAdults(settlement);
        if (currentAdults.length <= MIN_POPULATION) continue;

        migrations.push({
          npc,
          from: settlement,
          to: bestTarget,
        });
      }
    }
  }

  // Execute migrations
  for (const m of migrations) {
    migrateNPC(m.npc, m.from, m.to, world);
  }
}

function migrateNPC(npc, fromSettlement, toSettlement, world) {
  // Remove from source
  const idx = fromSettlement.npcs.indexOf(npc);
  if (idx === -1) return;
  fromSettlement.npcs.splice(idx, 1);

  // Remove from council if applicable
  const councilIdx = fromSettlement.council.indexOf(npc.id);
  if (councilIdx !== -1) {
    fromSettlement.council.splice(councilIdx, 1);
  }

  // Add to target
  npc.settlementId = toSettlement.id;
  // Reassign position to new settlement's area
  const rng = world.tickRng;
  npc.position = { x: rng.int(2, 7), y: rng.int(2, 7) };
  toSettlement.npcs.push(npc);

  // Re-init market beliefs to adapt to new market (partial — keep some beliefs)
  // Just widen beliefs to be more uncertain in new market
  for (const c of Object.keys(npc.priceBeliefs)) {
    const b = npc.priceBeliefs[c];
    const spread = b.high - b.low;
    b.low -= spread * 0.3;
    b.high += spread * 0.3;
    b.low = Math.max(0.01, b.low);
  }

  // Migration memory
  formMemory(npc, 'migration', fromSettlement.name, 0, -0.3, world.tick);

  // Slight satisfaction boost from hope of new start
  npc.opinions.satisfaction = Math.min(0.1, npc.opinions.satisfaction + 0.3);

  // Events
  const eventText = `${npc.name} migrated from ${fromSettlement.name} to ${toSettlement.name}.`;
  
  fromSettlement.events.push({
    tick: world.tick,
    type: 'emigration',
    text: eventText,
  });
  toSettlement.events.push({
    tick: world.tick,
    type: 'immigration',
    text: eventText,
  });

  // Chronicle in both
  recordEvent(fromSettlement.chronicle, world.tick, 'emigration',
    [{ id: npc.id, name: npc.name, role: npc.job }],
    `${npc.name} the ${npc.job} left ${fromSettlement.name} for ${toSettlement.name}, seeking a better life.`,
    { affectedCount: 1 }
  );
  recordEvent(toSettlement.chronicle, world.tick, 'immigration',
    [{ id: npc.id, name: npc.name, role: npc.job }],
    `${npc.name} the ${npc.job} arrived from ${fromSettlement.name}, hoping for a fresh start.`,
    { affectedCount: 1 }
  );

  // World-level event
  world.events.push({
    tick: world.tick,
    type: 'migration',
    text: eventText,
  });
}

module.exports = { tickMigration, MIGRATION_CHECK_INTERVAL };
