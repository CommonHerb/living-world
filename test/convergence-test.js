'use strict';

const { createWorld, tickWorld } = require('../src/world');
const { detectFactions, giniCoefficient } = require('../src/politics');
const { getSeason, getYear } = require('../src/seasons');

const TICKS = 1000;
const SEEDS = [48271, 99991, 31337];

console.log(`\n═══ CONVERGENCE TEST: ${TICKS} TICKS × ${SEEDS.length} SEEDS ═══\n`);

const results = [];

for (const seed of SEEDS) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  SEED: ${seed}`);
  console.log(`${'═'.repeat(60)}\n`);

  const world = createWorld(seed);
  const startTime = process.hrtime.bigint();

  // Tracking
  const eventLog = [];
  const mythsFormed = [];
  const beliefsFormed = [];
  const deathLog = [];
  const factionSnapshots = [];
  let totalHunger = 0;
  let totalMigrations = 0;
  let lastPop = {};

  for (let i = 0; i < TICKS; i++) {
    const events = tickWorld(world);

    for (const e of events) {
      if (e.type === 'myth') mythsFormed.push({ tick: world.tick, text: e.text });
      if (e.type === 'belief') beliefsFormed.push({ tick: world.tick, text: e.text });
      if (e.type === 'death' || e.type === 'winter_death') deathLog.push({ tick: world.tick, text: e.text });
      if (e.type === 'hunger') totalHunger++;
      if (e.type === 'migration') totalMigrations++;
      if (e.type?.startsWith('random_') || e.type === 'drought' || e.type === 'harsh_winter' ||
          e.type === 'bountiful_year' || e.type === 'season_change' || e.type === 'coup' ||
          e.type === 'schism' || e.type === 'belief_faded') {
        eventLog.push({ tick: world.tick, type: e.type, text: e.text });
      }
    }

    // Faction snapshots every 100 ticks
    if (world.tick % 100 === 0) {
      for (const s of world.settlements) {
        const { factions, unaligned } = detectFactions(s);
        factionSnapshots.push({
          tick: world.tick,
          settlement: s.name,
          factions: factions.map(f => `${f.emoji} ${f.name}(${f.members.length})`).join(', '),
          unaligned: unaligned.length,
        });
      }
    }
  }

  const elapsed = Number(process.hrtime.bigint() - startTime) / 1e6;

  // === SUMMARY ===
  console.log(`⏱️  ${elapsed.toFixed(0)}ms (${(TICKS / (elapsed / 1000)).toFixed(0)} ticks/sec)\n`);

  // Population
  for (const s of world.settlements) {
    const alive = s.npcs.filter(n => n.alive !== false);
    const adults = alive.filter(n => !n.isChild);
    const children = alive.filter(n => n.isChild);
    console.log(`📍 ${s.name}: ${adults.length} adults, ${children.length} children, ${s.deaths?.length || 0} deaths`);
    console.log(`   Season: ${s.season || '?'} | Year: ${(s.year || 0) + 1} | Treasury: ${Math.floor(s.treasury)}g`);
    console.log(`   Tax: ${Math.round(s.taxRate * 100)}% | Granary: ${Math.floor(s.granary || 0)}`);
    
    // Wealth distribution
    const golds = adults.map(n => n.gold).sort((a, b) => b - a);
    const gini = giniCoefficient(adults);
    console.log(`   Gini: ${gini.toFixed(3)} | Richest: ${golds[0]?.toFixed(1)}g | Poorest: ${golds[golds.length - 1]?.toFixed(1)}g | Median: ${golds[Math.floor(golds.length / 2)]?.toFixed(1)}g`);
  }

  console.log(`\n🌍 DRAMATIC EVENTS (${eventLog.length}):`);
  for (const e of eventLog.slice(0, 30)) {
    console.log(`   [${e.tick}] ${e.text}`);
  }
  if (eventLog.length > 30) console.log(`   ... and ${eventLog.length - 30} more`);

  console.log(`\n📖 MYTHS (${mythsFormed.length}):`);
  for (const m of mythsFormed) {
    console.log(`   [${m.tick}] ${m.text}`);
  }

  console.log(`\n⭐ BELIEFS (${beliefsFormed.length}):`);
  for (const b of beliefsFormed) {
    console.log(`   [${b.tick}] ${b.text}`);
  }

  console.log(`\n💀 DEATHS (${deathLog.length}):`);
  for (const d of deathLog.slice(0, 15)) {
    console.log(`   [${d.tick}] ${d.text}`);
  }
  if (deathLog.length > 15) console.log(`   ... and ${deathLog.length - 15} more`);

  console.log(`\n🏛️ FACTIONS:`);
  for (const f of factionSnapshots) {
    console.log(`   [${f.tick}] ${f.settlement}: ${f.factions || 'none'} (+${f.unaligned} unaligned)`);
  }

  console.log(`\n📊 STATS: ${totalHunger} hunger events, ${totalMigrations} migrations`);

  // Memory analysis
  let totalMems = 0, boringMems = 0, dramaticMems = 0;
  for (const s of world.settlements) {
    for (const npc of s.npcs.filter(n => n.alive !== false && !n.isChild)) {
      for (const m of npc.memories) {
        totalMems++;
        if (['surplus', 'good_trade', 'election'].includes(m.eventType)) boringMems++;
        if (['drought', 'harsh_winter', 'plague', 'flood', 'fire', 'raid', 'prophet', 'coup', 'winter_death', 'food_shortage', 'bankruptcy'].includes(m.eventType)) dramaticMems++;
      }
    }
  }
  console.log(`   Memories: ${totalMems} total, ${boringMems} boring (${(boringMems/totalMems*100).toFixed(0)}%), ${dramaticMems} dramatic (${(dramaticMems/totalMems*100).toFixed(0)}%)`);

  // Religion summary
  for (const s of world.settlements) {
    if (s.religion) {
      console.log(`   ${s.name} religion: ${s.religion.myths.length} myths, ${s.religion.beliefs.length} beliefs, ${s.religion.rituals.length} rituals, ${s.religion.schisms.length} schisms`);
    }
  }

  results.push({
    seed,
    events: eventLog.length,
    myths: mythsFormed.length,
    beliefs: beliefsFormed.length,
    deaths: deathLog.length,
    hunger: totalHunger,
    migrations: totalMigrations,
    dramaticMemoryPct: (dramaticMems / totalMems * 100).toFixed(0),
    settlements: world.settlements.map(s => ({
      name: s.name,
      pop: s.npcs.filter(n => n.alive !== false && !n.isChild).length,
      treasury: Math.floor(s.treasury),
      gini: giniCoefficient(s.npcs.filter(n => n.alive !== false && !n.isChild)).toFixed(3),
      myths: s.religion?.myths.length || 0,
      schisms: s.religion?.schisms.length || 0,
      factions: detectFactions(s).factions.length,
    })),
  });
}

// === CROSS-SEED COMPARISON ===
console.log(`\n${'═'.repeat(60)}`);
console.log(`  CROSS-SEED COMPARISON`);
console.log(`${'═'.repeat(60)}\n`);

console.log('Metric'.padEnd(25) + SEEDS.map(s => String(s).padStart(12)).join(''));
console.log('─'.repeat(25 + SEEDS.length * 12));

const metrics = [
  ['Events', r => r.events],
  ['Myths', r => r.myths],
  ['Beliefs', r => r.beliefs],
  ['Deaths', r => r.deaths],
  ['Hunger Events', r => r.hunger],
  ['Migrations', r => r.migrations],
  ['Dramatic Mem %', r => r.dramaticMemoryPct + '%'],
];

for (const [label, fn] of metrics) {
  console.log(label.padEnd(25) + results.map(r => String(fn(r)).padStart(12)).join(''));
}

for (const s of results[0].settlements) {
  const sName = s.name;
  console.log('');
  console.log(`  ${sName}:`);
  console.log('    Population'.padEnd(25) + results.map(r => String(r.settlements.find(x => x.name === sName)?.pop || '?').padStart(12)).join(''));
  console.log('    Treasury'.padEnd(25) + results.map(r => String(r.settlements.find(x => x.name === sName)?.treasury || '?').padStart(12)).join(''));
  console.log('    Gini'.padEnd(25) + results.map(r => String(r.settlements.find(x => x.name === sName)?.gini || '?').padStart(12)).join(''));
  console.log('    Myths'.padEnd(25) + results.map(r => String(r.settlements.find(x => x.name === sName)?.myths || '?').padStart(12)).join(''));
  console.log('    Schisms'.padEnd(25) + results.map(r => String(r.settlements.find(x => x.name === sName)?.schisms || '?').padStart(12)).join(''));
  console.log('    Factions'.padEnd(25) + results.map(r => String(r.settlements.find(x => x.name === sName)?.factions || '?').padStart(12)).join(''));
}

// Divergence check
const allEvents = results.map(r => r.events);
const allDeaths = results.map(r => r.deaths);
const allMyths = results.map(r => r.myths);
const range = arr => Math.max(...arr) - Math.min(...arr);

console.log(`\n📊 DIVERGENCE:`);
console.log(`   Event count range: ${range(allEvents)} (${Math.min(...allEvents)}-${Math.max(...allEvents)})`);
console.log(`   Death count range: ${range(allDeaths)} (${Math.min(...allDeaths)}-${Math.max(...allDeaths)})`);
console.log(`   Myth count range: ${range(allMyths)} (${Math.min(...allMyths)}-${Math.max(...allMyths)})`);

const similar = range(allEvents) < 5 && range(allDeaths) < 3 && range(allMyths) < 2;
if (similar) {
  console.log(`\n   ⚠️ WARNING: Seeds are producing very similar outcomes. Convergence problem may persist.`);
} else {
  console.log(`\n   ✅ Seeds produce meaningfully different outcomes!`);
}

console.log(`\n═══ END CONVERGENCE TEST ═══`);
