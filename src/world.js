'use strict';

const { RNG } = require('./rng');
const { createNPC } = require('./npc');
const { tickEconomy } = require('./economy');
const { tickOpinions } = require('./opinions');
const { tickGossip } = require('./gossip');
const { tickMemoryDecay } = require('./memory');
const { tickElection, tickGranaryCheck } = require('./politics');

function createWorld(seed) {
  const rng = new RNG(seed);
  const npcs = [];
  for (let i = 0; i < 25; i++) {
    npcs.push(createNPC(rng, i));
  }

  return {
    seed,
    tick: 0,
    granary: 80,
    taxRate: 0.20,
    council: [npcs[1].id, npcs[npcs.length - 1].id, npcs[13].id], // Initial council
    npcs,
    events: [], // Current tick events
    history: [], // All events
    rng,
  };
}

function tickWorld(world) {
  world.tick++;
  world.events = [];

  // Derive tick-specific RNG for determinism
  world.tickRng = new RNG(world.seed ^ (world.tick * 2654435761));

  // Phase 1: Production
  tickEconomy(world);

  // Phase 2: Consumption (handled in economy)

  // Phase 3: Opinion Update
  tickOpinions(world);

  // Phase 4: Gossip
  tickGossip(world);

  // Phase 5: Memory Decay
  tickMemoryDecay(world);

  // Phase 6: Elections (every 30 ticks)
  if (world.tick % 30 === 0) {
    tickElection(world);
  }

  // Phase 7: Granary Check
  tickGranaryCheck(world);

  // Archive events
  for (const evt of world.events) {
    world.history.push(evt);
  }

  // Keep history manageable (last 200 events)
  if (world.history.length > 200) {
    world.history = world.history.slice(-200);
  }

  return world.events;
}

module.exports = { createWorld, tickWorld };
