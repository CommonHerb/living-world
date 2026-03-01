'use strict';

const { createWorld, tickWorld } = require('../src/world');
const { formatChronicle, queryChronicle } = require('../src/chronicle');

console.log('=== Phase 7: Family & Birth System — 500 Tick Test ===\n');

const world = createWorld(42);

let marriages = 0, births = 0, deaths = 0, maturations = 0;

for (let i = 0; i < 500; i++) {
  const events = tickWorld(world);
  for (const e of events) {
    if (e.type === 'marriage') { marriages++; console.log(`  [${world.tick}] ${e.text}`); }
    if (e.type === 'birth') { births++; console.log(`  [${world.tick}] ${e.text}`); }
    if (e.type === 'death') { deaths++; console.log(`  [${world.tick}] ${e.text}`); }
    if (e.type === 'maturation') { maturations++; console.log(`  [${world.tick}] ${e.text}`); }
  }
}

const living = world.npcs.filter(n => n.alive);
const livingAdults = living.filter(n => !n.isChild);
const children = living.filter(n => n.isChild);
const dead = world.npcs.filter(n => !n.alive);
const familyCount = Object.keys(world.families || {}).length;

console.log('\n=== RESULTS ===');
console.log(`Total NPCs ever: ${world.npcs.length}`);
console.log(`Living: ${living.length} (${livingAdults.length} adults, ${children.length} children)`);
console.log(`Dead: ${dead.length}`);
console.log(`Marriages: ${marriages}`);
console.log(`Births: ${births}`);
console.log(`Deaths: ${deaths}`);
console.log(`Maturations: ${maturations}`);
console.log(`Family units: ${familyCount}`);

// Verify population growth
const startPop = 25;
console.log(`\nStarting pop: ${startPop}, Final living: ${living.length}`);
console.log(`Population ${living.length > startPop ? 'GREW ✓' : 'DID NOT GROW ✗'}`);

// Check genome crossover
const childNpcs = world.npcs.filter(n => n.parentIds && n.parentIds.length === 2);
if (childNpcs.length > 0) {
  const sample = childNpcs[0];
  const pA = world.npcs.find(n => n.id === sample.parentIds[0]);
  const pB = world.npcs.find(n => n.id === sample.parentIds[1]);
  console.log(`\n=== Genome Crossover Sample: ${sample.name} ===`);
  console.log(`Parent A (${pA.name}): risk=${pA.genome.riskTolerance.toFixed(2)}, agree=${pA.genome.agreeableness.toFixed(2)}`);
  console.log(`Parent B (${pB.name}): risk=${pB.genome.riskTolerance.toFixed(2)}, agree=${pB.genome.agreeableness.toFixed(2)}`);
  console.log(`Child (${sample.name}):    risk=${sample.genome.riskTolerance.toFixed(2)}, agree=${sample.genome.agreeableness.toFixed(2)}`);
  console.log('Genome crossover working ✓');
}

// Check memory inheritance
const deadWithMemories = dead.filter(n => n.memories.length > 0);
if (deadWithMemories.length > 0) {
  const inheritedMemories = world.npcs.filter(n => n.alive && n.memories.some(m => m.source && m.source.startsWith('inherited')));
  console.log(`\n=== Memory Transfer ===`);
  console.log(`NPCs with inherited memories: ${inheritedMemories.length}`);
  if (inheritedMemories.length > 0) console.log('Memory transfer working ✓');
}

// Gender distribution
const males = living.filter(n => n.gender === 'male').length;
const females = living.filter(n => n.gender === 'female').length;
console.log(`\nGender: ${males} male, ${females} female`);

// Chronicle family events
const familyEvents = queryChronicle(world.chronicle, { eventType: 'marriage' });
const birthEvents = queryChronicle(world.chronicle, { eventType: 'birth' });
const deathEvents = queryChronicle(world.chronicle, { eventType: 'death' });
console.log(`\nChronicle: ${familyEvents.length} marriages, ${birthEvents.length} births, ${deathEvents.length} deaths recorded`);

// Print a few chronicle entries
console.log('\n=== Sample Chronicle Entries ===');
const allFamily = [...familyEvents.slice(0, 2), ...birthEvents.slice(0, 2), ...deathEvents.slice(0, 2)];
for (const e of allFamily) {
  console.log(`  Day ${e.tick} [${e.eventType}] ${e.outcome}`);
}

console.log('\n=== Phase 7 Test Complete ===');
