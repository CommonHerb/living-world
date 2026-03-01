'use strict';
const { createWorld, tickWorld } = require('../src/world');

const world = createWorld(48271);

// Run 500 ticks
for (let i = 0; i < 500; i++) {
  tickWorld(world);
}

// Check results
const s = world.settlements[0];
const npcs = s.npcs.filter(n => n.alive !== false);

console.log(`\n=== INTEGRATION TEST (500 ticks) ===`);
console.log(`Tick: ${world.tick}`);
console.log(`Settlement: ${s.name}, NPCs alive: ${npcs.length}, total: ${s.npcs.length}`);

// Ages
const ages = npcs.map(n => n.age).filter(a => a !== undefined && !isNaN(a));
console.log(`\nAGES: ${ages.length}/${npcs.length} have valid ages`);
if (ages.length > 0) console.log(`  Range: ${Math.min(...ages)} - ${Math.max(...ages)}`);
const nanAges = npcs.filter(n => n.age === undefined || isNaN(n.age));
if (nanAges.length > 0) console.log(`  NaN ages: ${nanAges.length} ❌`);
else console.log(`  No NaN ages ✅`);

// Elections
const elections = s.history.filter(e => e.type === 'election');
console.log(`\nELECTIONS: ${elections.length}`);
if (elections.length > 0) console.log(`  ✅ Elections firing`);
else console.log(`  ❌ No elections`);

// Factions
const factions = new Set(npcs.map(n => n.faction).filter(Boolean));
console.log(`\nFACTIONS: ${[...factions].join(', ') || 'none'}`);
if (factions.size > 0) console.log(`  ✅ Factions assigned`);
else console.log(`  ❌ No factions`);

// Marriages
const marriages = s.history.filter(e => e.type === 'marriage');
const births = s.history.filter(e => e.type === 'birth');
const deaths = s.history.filter(e => e.type === 'death');
console.log(`\nFAMILY: ${marriages.length} marriages, ${births.length} births, ${deaths.length} deaths`);
if (marriages.length > 0) console.log(`  ✅ Marriages`);
else console.log(`  ❌ No marriages`);
if (births.length > 0) console.log(`  ✅ Births`);
else console.log(`  ❌ No births`);
if (deaths.length > 0) console.log(`  ✅ Deaths`);
else console.log(`  ❌ No deaths`);

// Families
if (s.families) {
  console.log(`  Families created: ${Object.keys(s.families).length}`);
}

// Memory types
const allMems = npcs.flatMap(n => n.memories);
const memTypes = new Set(allMems.map(m => m.eventType));
const undefinedTypes = allMems.filter(m => !m.eventType);
console.log(`\nMEMORIES: ${allMems.length} total, ${memTypes.size} types: ${[...memTypes].join(', ')}`);
if (undefinedTypes.length > 0) console.log(`  ❌ ${undefinedTypes.length} with undefined type`);
else console.log(`  ✅ All memories have types`);

// Gossip fidelity
const gossipMems = allMems.filter(m => m.fidelity < 0.7 && m.fidelity > 0);
console.log(`\nGOSSIP: ${gossipMems.length} memories with reduced fidelity`);
if (gossipMems.length > 0) console.log(`  ✅ Fidelity degradation working`);
else console.log(`  ❌ No fidelity degradation`);

// Religion
if (s.religion) {
  console.log(`\nRELIGION: ${s.religion.myths.length} myths, ${s.religion.beliefs.length} beliefs, ${s.religion.rituals.length} rituals`);
  if (s.religion.myths.length > 0) console.log(`  ✅ Myths forming`);
} else {
  console.log(`\nRELIGION: not initialized ❌`);
}

// Gender
const genders = new Set(npcs.map(n => n.gender).filter(Boolean));
console.log(`\nGENDERS: ${[...genders].join(', ')}`);

console.log('\n=== END ===');
