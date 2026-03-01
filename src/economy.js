'use strict';

const { formMemory } = require('./npc');

function tickEconomy(world) {
  const rng = world.tickRng;
  let totalProduced = 0;
  let totalTaxed = 0;
  let hungerCount = 0;

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
        const produced = 3; // 1.5x conversion
        const tax = Math.floor(produced * world.taxRate);
        world.granary += tax;
        npc.wealth += (produced - tax);
        totalProduced += produced;
        totalTaxed += tax;
      }
      // else: nothing to mill
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
      formMemory(npc, 'food_shortage', -0.8, npc.wealth, world.tick);
      npc.opinions.satisfaction = Math.max(-1, npc.opinions.satisfaction - 0.2);
      npc.opinions.leaderApproval = Math.max(-1, npc.opinions.leaderApproval - 0.1);
      hungerCount++;
    } else if (npc.wealth < npc.genome.metabolism * 2) {
      npc.opinions.satisfaction = Math.max(-1, npc.opinions.satisfaction - 0.05);
    }
  }

  if (hungerCount > 0) {
    world.events.push({
      tick: world.tick,
      type: 'hunger',
      text: `${hungerCount} NPC${hungerCount > 1 ? 's' : ''} went hungry.`,
    });
  }

  world.events.push({
    tick: world.tick,
    type: 'economy',
    text: `Economy: ${totalProduced} food produced, ${totalTaxed} taxed. Granary: ${world.granary}.`,
  });
}

module.exports = { tickEconomy };
