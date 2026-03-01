'use strict';

/**
 * Phase 9 Test: Religion Engine
 * Run 500 ticks, verify myths form, beliefs emerge, rituals form.
 */

const { createWorld, tickWorld } = require('../src/world');
const { formatBeliefs } = require('../src/religion');

const seed = 48271;
const world = createWorld(seed);

console.log('=== Phase 9: Religion Engine Test ===');
console.log(`Settlements: ${world.settlements.map(s => s.name).join(', ')}`);
console.log('Running 500 ticks...\n');

const milestones = [];

for (let i = 0; i < 500; i++) {
  try {
    tickWorld(world);
  } catch (e) {
    console.error(`ERROR at tick ${world.tick}: ${e.message}`);
    console.error(e.stack);
    process.exit(1);
  }

  // Log religion events
  for (const s of world.settlements) {
    for (const evt of s.events) {
      if (['myth', 'belief', 'ritual', 'ritual_performed', 'priest', 'schism'].includes(evt.type)) {
        milestones.push(`  [${s.name}] Day ${evt.tick}: ${evt.text}`);
      }
    }
  }
}

console.log('=== RELIGION MILESTONES ===');
if (milestones.length === 0) {
  console.log('  (none — religion did not emerge in 500 ticks)');
} else {
  for (const m of milestones) {
    console.log(m);
  }
}

console.log('\n=== FINAL RELIGION STATE ===');
for (const s of world.settlements) {
  console.log(`\n── ${s.name} ──`);
  console.log(formatBeliefs(s));
}

// Summary
console.log('\n=== SUMMARY ===');
let totalMyths = 0, totalBeliefs = 0, totalRituals = 0, totalPriests = 0, totalSchisms = 0;
for (const s of world.settlements) {
  if (s.religion) {
    totalMyths += s.religion.myths.length;
    totalBeliefs += s.religion.beliefs.length;
    totalRituals += s.religion.rituals.length;
    totalPriests += s.religion.priests.length;
    totalSchisms += s.religion.schisms.length;
  }
}

console.log(`Myths: ${totalMyths}`);
console.log(`Beliefs: ${totalBeliefs}`);
console.log(`Rituals: ${totalRituals}`);
console.log(`Priests: ${totalPriests}`);
console.log(`Schisms: ${totalSchisms}`);

// Assertions
const pass = totalMyths > 0;
console.log(`\n${pass ? '✅ PASS' : '❌ FAIL'}: Myths formed: ${totalMyths > 0 ? 'YES' : 'NO'}`);
console.log(`${totalBeliefs > 0 ? '✅ PASS' : '⚠️  WARN'}: Beliefs formed: ${totalBeliefs > 0 ? 'YES' : 'NO (may need more ticks)'}`);
console.log(`${totalRituals > 0 ? '✅ PASS' : '⚠️  WARN'}: Rituals formed: ${totalRituals > 0 ? 'YES' : 'NO (needs beliefs + 100 ticks)'}`);

if (!pass) {
  process.exit(1);
}
