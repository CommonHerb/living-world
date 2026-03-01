'use strict';

const { RNG } = require('./rng');
const { createSettlement } = require('./settlement');
const { tickEconomy } = require('./economy');
const { tickOpinions } = require('./opinions');
const { tickGossip } = require('./gossip');
const { tickMemoryDecay } = require('./memory');
const { tickElection, tickTreasuryCheck, detectFactions } = require('./politics');
const { tickFamily } = require('./family');
const { tickCrime, tickMilitiaVote } = require('./crime');
const { tickReligion } = require('./religion');
const { tickMigration } = require('./migration');
const { tickTrade } = require('./trade');
const { tickSocial } = require('./social');
const { tickSeasons, tickRandomEvents } = require('./seasons');
const { tickNewspaper } = require('./newspaper');

function createWorld(seed) {
  const rng = new RNG(seed);

  // Create settlements
  const cudderland = createSettlement({
    id: 'cudderland',
    name: 'Cudderland',
    location: { x: 20, y: 20 },
    seed: seed,
    populationCount: 25,
    government: 'council',
    startingTreasury: 150,
    startingGranary: 80,
  });

  const thornwall = createSettlement({
    id: 'thornwall',
    name: 'Thornwall',
    location: { x: 80, y: 60 },
    seed: seed ^ 0xDEADBEEF, // different seed for different personalities
    populationCount: 15,
    government: 'monarchy',
    startingTreasury: 100,
    startingGranary: 50,
  });

  return {
    seed,
    tick: 0,
    settlements: [cudderland, thornwall],
    events: [],     // world-level events (migration, trade)
    history: [],    // world-level history
    rng,
  };
}

/**
 * Get a settlement by id or name.
 */
function getSettlement(world, idOrName) {
  return world.settlements.find(s => 
    s.id === idOrName || s.name.toLowerCase() === idOrName.toLowerCase()
  );
}

/**
 * Get the "active" settlement (first one / default).
 */
function getDefaultSettlement(world) {
  return world.settlements[0];
}

function tickWorld(world) {
  world.tick++;
  world.events = [];
  world.tickRng = new RNG(world.seed ^ (world.tick * 2654435761));

  // Tick each settlement independently
  for (const settlement of world.settlements) {
    settlement.events = [];
    settlement.tick = world.tick;
    settlement.tickRng = new RNG(settlement.seed ^ (world.tick * 2654435761));

    // Phase 0: Seasons & Environment
    tickSeasons(settlement, world.tick);

    // Phase 0b: Random Events (external shocks)
    tickRandomEvents(settlement, world.tick);

    // Phase 1: Production & Consumption
    tickEconomy(settlement, world.tick);

    // Phase 2: Opinion Update
    tickOpinions(settlement, world.tick);

    // Phase 3: Gossip
    tickGossip(settlement, world.tick);

    // Phase 4: Memory Decay
    tickMemoryDecay(settlement);

    // Phase 5: Elections / Succession
    if (world.tick % 30 === 0) {
      tickElection(settlement, world.tick);
    }

    // Phase 6: Treasury Check
    tickTreasuryCheck(settlement, world.tick);

    // Phase 7: Family
    tickFamily(settlement, world.tick);

    // Phase 8: Social (speech bubbles, interactions, clustering, mood)
    tickSocial(settlement, world.tick);

    // Phase 9: Crime & Conflict
    tickCrime(settlement);

    // Phase 10: Militia vote (every 30 ticks)
    if (world.tick % 30 === 0) {
      tickMilitiaVote(settlement);
    }

    // Phase 11: Religion
    tickReligion(settlement, world.tick);

    // Phase 12: Newspaper
    tickNewspaper(settlement, world);

    // Phase 13: Faction assignment
    if (world.tick % 5 === 0) {
      const { factions, unaligned } = detectFactions(settlement);
      for (const f of factions) {
        for (const npc of f.members) {
          npc.faction = f.name;
        }
      }
      for (const npc of unaligned) {
        npc.faction = 'unaligned';
      }
    }

    // Archive settlement events
    for (const evt of settlement.events) {
      settlement.history.push(evt);
    }
    if (settlement.history.length > 2000) {
      settlement.history = settlement.history.slice(-2000);
    }
  }

  // Phase 8: Inter-settlement systems
  tickMigration(world);
  tickTrade(world);

  // Archive world events
  for (const evt of world.events) {
    world.history.push(evt);
  }
  if (world.history.length > 1000) {
    world.history = world.history.slice(-1000);
  }

  // Collect all events for return
  const allEvents = [...world.events];
  for (const s of world.settlements) {
    allEvents.push(...s.events);
  }

  return allEvents;
}

module.exports = { createWorld, tickWorld, getSettlement, getDefaultSettlement };
