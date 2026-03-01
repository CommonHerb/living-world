'use strict';

const { RNG } = require('./rng');
const { createNPC } = require('./npc');
const { tickEconomy } = require('./economy');
const { tickOpinions } = require('./opinions');
const { tickGossip } = require('./gossip');
const { tickMemoryDecay } = require('./memory');
const { tickElection, tickGranaryCheck } = require('./politics');
const { createChronicle, recordEvent } = require('./chronicle');

function createWorld(seed) {
  const rng = new RNG(seed);
  const npcs = [];
  for (let i = 0; i < 25; i++) {
    npcs.push(createNPC(rng, i));
  }

  const chronicle = createChronicle();

  // Record founding event
  recordEvent(chronicle, 0, 'founding',
    [{ id: -1, name: 'Millhaven', role: 'settlement' }],
    'The settlement of Millhaven was founded. 25 souls begin a new life.',
    { isFirst: true, affectsAll: true, affectedCount: 25 }
  );

  return {
    seed,
    tick: 0,
    granary: 80,
    taxRate: 0.20,
    council: [npcs[1].id, npcs[npcs.length - 1].id, npcs[13].id],
    npcs,
    events: [],
    history: [],
    chronicle,
    rng,
  };
}

function tickWorld(world) {
  world.tick++;
  world.events = [];
  world.tickRng = new RNG(world.seed ^ (world.tick * 2654435761));

  // Phase 1: Production & Consumption
  tickEconomy(world);

  // Phase 2: Opinion Update (memory-driven)
  tickOpinions(world);

  // Phase 3: Gossip (memory transmission)
  tickGossip(world);

  // Phase 4: Memory Decay
  tickMemoryDecay(world);

  // Phase 5: Elections (every 30 ticks)
  if (world.tick % 30 === 0) {
    tickElection(world);
  }

  // Phase 6: Granary Check
  tickGranaryCheck(world);

  // Archive events
  for (const evt of world.events) {
    world.history.push(evt);
  }
  if (world.history.length > 200) {
    world.history = world.history.slice(-200);
  }

  return world.events;
}

module.exports = { createWorld, tickWorld };
