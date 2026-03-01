'use strict';

const { formMemory } = require('./memory');
const { recordEvent } = require('./chronicle');

function tickEconomy(world) {
  const rng = world.tickRng;
  let totalProduced = 0;
  let totalTaxed = 0;
  let hungerCount = 0;
  const hungryNPCs = [];

  for (const npc of world.npcs) {
    // === PRODUCTION ===
    if (npc.job === 'farmer') {
      const produced = rng.int(2, 4);
      const tax = Math.floor(produced * world.taxRate);
      world.granary += tax;
      npc.wealth += (produced - tax);
      totalProduced += produced;
      totalTaxed += tax;
    } else if (npc.job === 'miller') {
      if (world.granary >= 2) {
        world.granary -= 2;
        const produced = 3;
        const tax = Math.floor(produced * world.taxRate);
        world.granary += tax;
        npc.wealth += (produced - tax);
        totalProduced += produced;
        totalTaxed += tax;
      }
    } else if (npc.job === 'guard') {
      const stipend = Math.min(2, Math.max(1, Math.floor(world.granary * 0.03)));
      if (world.granary >= stipend) {
        world.granary -= stipend;
        npc.wealth += stipend;
      }
    }

    // === CONSUMPTION ===
    npc.wealth -= npc.genome.metabolism;
    if (npc.wealth < 0) {
      npc.wealth = 0;
      formMemory(npc, 'food_shortage', 'self', npc.wealth, -0.8, world.tick);
      hungerCount++;
      hungryNPCs.push(npc);
    } else if (npc.wealth > 5 && npc.wealth < 10) {
      // Mild scarcity — no memory but slight unease
    }
  }

  // Emergency relief: if granary is 0 and many hungry, nature provides a small boost
  // (foraging, wild game, etc. — prevents permanent death spiral)
  if (world.granary <= 0 && hungerCount > world.npcs.length * 0.3) {
    world.granary += Math.floor(world.npcs.length * 0.5);
  }

  if (hungerCount > 0) {
    world.events.push({
      tick: world.tick,
      type: 'hunger',
      text: `${hungerCount} NPC${hungerCount > 1 ? 's' : ''} went hungry.`,
    });

    if (world.chronicle) {
      recordEvent(world.chronicle, world.tick, 'hunger',
        hungryNPCs.slice(0, 5).map(n => ({ id: n.id, name: n.name, role: n.job })),
        `${hungerCount} residents went hungry. Granary: ${world.granary}.`,
        { affectedCount: hungerCount }
      );
    }
  }

  world.events.push({
    tick: world.tick,
    type: 'economy',
    text: `Economy: ${totalProduced} food produced, ${totalTaxed} taxed. Granary: ${world.granary}.`,
  });
}

module.exports = { tickEconomy };
