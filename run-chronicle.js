'use strict';
const { createWorld, tickWorld } = require('./src/world');
const { queryChronicle } = require('./src/chronicle');

const world = createWorld(48271);
const TICKS = 2000;

// Snapshot state at key intervals
const snapshots = {};
const snapshotTicks = [100, 300, 700, 1200, 2000];

for (let i = 0; i < TICKS; i++) {
  tickWorld(world);
  
  if (snapshotTicks.includes(world.tick)) {
    snapshots[world.tick] = {
      settlements: world.settlements.map(s => ({
        name: s.name,
        population: s.npcs ? s.npcs.filter(n => n.alive !== false).length : 0,
        government: s.government,
        leader: s.leader ? { name: s.leader.name, id: s.leader.id } : null,
        treasury: s.treasury,
        granary: s.granary,
        taxRate: s.taxRate,
        season: s.season,
        npcs: s.npcs ? s.npcs.filter(n => n.alive !== false).map(n => ({
          name: n.name,
          age: n.age,
          wealth: n.wealth,
          occupation: n.occupation,
          faction: n.faction,
          religion: n.religion,
          beliefs: n.beliefs,
          mood: n.mood,
          traits: n.traits,
          spouse: n.spouse ? n.spouse.name || n.spouse : null,
        })) : [],
        religions: s.religions || [],
        factions: s.factions || [],
        militiaActive: s.militiaActive,
        laws: s.laws,
      })),
    };
  }
}

// Dump all chronicle entries for each settlement
const output = {
  seed: 48271,
  totalTicks: TICKS,
  snapshots,
  chronicles: {},
  worldHistory: world.history,
};

for (const s of world.settlements) {
  if (s.chronicle) {
    output.chronicles[s.name] = s.chronicle.entries;
  }
  // Also grab settlement history
  output[s.name + '_history'] = s.history;
}

// Write as JSON
const fs = require('fs');
fs.writeFileSync('chronicle-output.json', JSON.stringify(output, null, 2));
console.log('Done. Ticks:', world.tick);
console.log('Cudderland chronicle entries:', output.chronicles['Cudderland'] ? output.chronicles['Cudderland'].length : 0);
console.log('Thornwall chronicle entries:', output.chronicles['Thornwall'] ? output.chronicles['Thornwall'].length : 0);
console.log('World history entries:', world.history.length);

// Also dump a summary of high-significance events
for (const s of world.settlements) {
  if (s.chronicle) {
    const big = queryChronicle(s.chronicle, { minSignificance: 60 });
    console.log(`\n=== ${s.name} Major Events (significance >= 60): ${big.length} ===`);
    for (const e of big.slice(0, 200)) {
      console.log(`  T${e.tick} [${e.significance}] ${e.eventType}: ${e.outcome}`);
    }
  }
}
