'use strict';

function tickMemoryDecay(world) {
  for (const npc of world.npcs) {
    for (let i = npc.memories.length - 1; i >= 0; i--) {
      npc.memories[i].intensity *= 0.97; // ~23-tick half-life
      if (npc.memories[i].intensity < 0.05) {
        npc.memories.splice(i, 1);
      }
    }
  }
}

module.exports = { tickMemoryDecay };
