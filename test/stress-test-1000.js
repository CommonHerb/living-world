'use strict';

const { createWorld, tickWorld } = require('../src/world');
const { detectFactions, giniCoefficient } = require('../src/politics');
const { formatChronicle } = require('../src/chronicle');

const seed = 48271;
const TICKS = 1000;

console.log(`\n═══ STRESS TEST: ${TICKS} TICKS, SEED ${seed} ═══\n`);

const world = createWorld(seed);

// Tracking arrays
const granaryHistory = [];
const taxHistory = [];
const giniHistory = [];
const avgWealthHistory = [];
const avgSatHistory = [];
const avgTaxSentHistory = [];
const factionSizes = [];  // [{tick, tillers, shields, unaligned}]
const electionResults = [];
const crisisTicks = [];
const surplusTicks = [];
const gossipCounts = [];  // per tick
let totalGossip = 0;
const hungerTicks = [];

// Benchmark
const startTime = process.hrtime.bigint();

for (let i = 0; i < TICKS; i++) {
  const events = tickWorld(world);
  
  // Track per-tick data
  granaryHistory.push(world.granary);
  taxHistory.push(world.taxRate);
  giniHistory.push(giniCoefficient(world.npcs));
  avgWealthHistory.push(world.npcs.reduce((s, n) => s + n.wealth, 0) / world.npcs.length);
  avgSatHistory.push(world.npcs.reduce((s, n) => s + n.opinions.satisfaction, 0) / world.npcs.length);
  avgTaxSentHistory.push(world.npcs.reduce((s, n) => s + n.opinions.taxSentiment, 0) / world.npcs.length);
  
  let tickGossip = 0;
  for (const e of events) {
    if (e.type === 'gossip') tickGossip++;
    if (e.type === 'crisis') crisisTicks.push(world.tick);
    if (e.type === 'surplus') surplusTicks.push(world.tick);
    if (e.type === 'hunger') hungerTicks.push(world.tick);
    if (e.type === 'election') electionResults.push({ tick: world.tick, text: e.text });
    if (e.type === 'election_detail') electionResults[electionResults.length - 1].detail = e.text;
  }
  totalGossip += tickGossip;
  gossipCounts.push(tickGossip);
  
  // Faction tracking every 30 ticks
  if (world.tick % 30 === 0) {
    const { factions, unaligned } = detectFactions(world);
    const tillers = factions.find(f => f.name === 'The Tillers');
    const shields = factions.find(f => f.name === 'The Shields');
    factionSizes.push({
      tick: world.tick,
      tillers: tillers ? tillers.members.length : 0,
      shields: shields ? shields.members.length : 0,
      unaligned: unaligned.length,
    });
  }
}

const endTime = process.hrtime.bigint();
const elapsedMs = Number(endTime - startTime) / 1e6;

// ═══ OUTPUT ═══

console.log(`\n═══ BENCHMARK ═══`);
console.log(`${TICKS} ticks in ${elapsedMs.toFixed(1)}ms`);
console.log(`${(elapsedMs / TICKS).toFixed(3)}ms per tick`);
console.log(`${(TICKS / (elapsedMs / 1000)).toFixed(0)} ticks/sec`);

console.log(`\n═══ EVERY ELECTION RESULT ═══`);
for (const e of electionResults) {
  console.log(`  ${e.text}`);
  if (e.detail) console.log(`    ${e.detail}`);
}

console.log(`\n═══ TAX RATE OVER TIME ═══`);
// Sample every 50 ticks
for (let i = 0; i < TICKS; i += 50) {
  const pct = Math.round(taxHistory[i] * 100);
  const bar = '█'.repeat(pct);
  console.log(`  Tick ${String(i+1).padStart(4)}: ${String(pct).padStart(2)}% ${bar}`);
}

console.log(`\n═══ GRANARY OVER TIME ═══`);
for (let i = 0; i < TICKS; i += 50) {
  const g = granaryHistory[i];
  const bar = g > 0 ? '█'.repeat(Math.min(60, Math.floor(g / 2))) : '!';
  console.log(`  Tick ${String(i+1).padStart(4)}: ${String(g).padStart(5)} ${bar}`);
}

console.log(`\n═══ GINI COEFFICIENT OVER TIME ═══`);
for (let i = 0; i < TICKS; i += 50) {
  const g = giniHistory[i];
  console.log(`  Tick ${String(i+1).padStart(4)}: ${g.toFixed(3)}`);
}

console.log(`\n═══ FACTION EVOLUTION ═══`);
for (const f of factionSizes) {
  const tBar = '🌾'.repeat(f.tillers);
  const sBar = '🛡️'.repeat(f.shields);
  console.log(`  Tick ${String(f.tick).padStart(4)}: Tillers=${f.tillers} ${tBar}  Shields=${f.shields} ${sBar}  Unaligned=${f.unaligned}`);
}

console.log(`\n═══ CRISIS / SURPLUS / HUNGER ═══`);
console.log(`Crisis ticks (granary < 10): ${crisisTicks.length} occurrences`);
if (crisisTicks.length > 0) {
  // Group into ranges
  let ranges = [];
  let start = crisisTicks[0], end = crisisTicks[0];
  for (let i = 1; i < crisisTicks.length; i++) {
    if (crisisTicks[i] - end <= 2) { end = crisisTicks[i]; }
    else { ranges.push([start, end]); start = crisisTicks[i]; end = crisisTicks[i]; }
  }
  ranges.push([start, end]);
  console.log(`  Crisis periods: ${ranges.map(r => r[0] === r[1] ? `tick ${r[0]}` : `ticks ${r[0]}-${r[1]}`).join(', ')}`);
}
console.log(`Surplus ticks (granary > 100): ${surplusTicks.length} occurrences`);
console.log(`Hunger events: ${hungerTicks.length} occurrences`);

console.log(`\n═══ GOSSIP ANALYSIS ═══`);
console.log(`Total gossip events: ${totalGossip}`);
console.log(`Avg gossip/tick: ${(totalGossip / TICKS).toFixed(2)}`);
// Check for gossip-driven misinformation
const allMemories = [];
for (const npc of world.npcs) {
  for (const mem of npc.memories) {
    allMemories.push({ npcName: npc.name, ...mem });
  }
}
const lowFidMemories = allMemories.filter(m => m.fidelity < 0.5);
console.log(`Current low-fidelity memories (<0.5): ${lowFidMemories.length} / ${allMemories.length}`);
// Check value drift — compare memories of same event type
const taxRaisedMems = allMemories.filter(m => m.eventType === 'tax_raised');
if (taxRaisedMems.length > 1) {
  const values = taxRaisedMems.map(m => m.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  console.log(`"tax_raised" memory value range: ${min.toFixed(3)} - ${max.toFixed(3)} (spread: ${(max-min).toFixed(3)})`);
}
const crisisMems = allMemories.filter(m => m.eventType === 'crisis');
if (crisisMems.length > 1) {
  const values = crisisMems.map(m => m.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  console.log(`"crisis" memory value range: ${min.toFixed(3)} - ${max.toFixed(3)} (spread: ${(max-min).toFixed(3)})`);
}

console.log(`\n═══ OPINION CONVERGENCE CHECK ═══`);
const taxSents = world.npcs.map(n => n.opinions.taxSentiment);
const satSents = world.npcs.map(n => n.opinions.satisfaction);
const leaderSents = world.npcs.map(n => n.opinions.leaderApproval);
const stdDev = arr => {
  const mean = arr.reduce((a,b) => a+b, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length);
};
console.log(`Tax sentiment:     mean=${(taxSents.reduce((a,b)=>a+b,0)/25).toFixed(3)} stddev=${stdDev(taxSents).toFixed(3)} range=[${Math.min(...taxSents).toFixed(3)}, ${Math.max(...taxSents).toFixed(3)}]`);
console.log(`Satisfaction:      mean=${(satSents.reduce((a,b)=>a+b,0)/25).toFixed(3)} stddev=${stdDev(satSents).toFixed(3)} range=[${Math.min(...satSents).toFixed(3)}, ${Math.max(...satSents).toFixed(3)}]`);
console.log(`Leader approval:   mean=${(leaderSents.reduce((a,b)=>a+b,0)/25).toFixed(3)} stddev=${stdDev(leaderSents).toFixed(3)} range=[${Math.min(...leaderSents).toFixed(3)}, ${Math.max(...leaderSents).toFixed(3)}]`);

console.log(`\n═══ WEALTH DISTRIBUTION (FINAL) ═══`);
const sorted = [...world.npcs].sort((a,b) => b.wealth - a.wealth);
for (const npc of sorted) {
  const bar = npc.wealth > 0 ? '█'.repeat(Math.min(40, Math.floor(npc.wealth / 2))) : '☠';
  console.log(`  ${npc.name.padEnd(15)} ${npc.job.padEnd(7)} ${String(npc.wealth).padStart(5)} ${bar}`);
}
console.log(`  Gini: ${giniCoefficient(world.npcs).toFixed(3)}`);

console.log(`\n═══ FULL CHRONICLE ═══`);
console.log(formatChronicle(world.chronicle, 999));

console.log(`\n═══ SAMPLE NPC DEEP DIVES (3 NPCs) ═══`);
for (const npc of [world.npcs[0], world.npcs[12], world.npcs[24]]) {
  console.log(`\n--- ${npc.name} (${npc.job}) ---`);
  console.log(`  Wealth: ${npc.wealth} | Satisfaction: ${npc.opinions.satisfaction.toFixed(3)}`);
  console.log(`  Tax sentiment: ${npc.opinions.taxSentiment.toFixed(3)} | Leader approval: ${npc.opinions.leaderApproval.toFixed(3)}`);
  console.log(`  Genome: stub=${npc.genome.stubbornness.toFixed(2)} agree=${npc.genome.agreeableness.toFixed(2)} assert=${npc.genome.assertiveness.toFixed(2)} cred=${npc.genome.credulity.toFixed(2)}`);
  console.log(`  Memories (${npc.memories.length}/12):`);
  for (const mem of npc.memories) {
    console.log(`    Day ${mem.tick}: ${mem.eventType} [${mem.subject}] val=${mem.valence.toFixed(2)} fid=${mem.fidelity.toFixed(3)} data=${typeof mem.value === 'number' ? mem.value.toFixed(2) : mem.value}`);
  }
  const relEntries = Object.entries(npc.relationships).filter(([_,r]) => Math.abs(r.trust) > 0.05);
  if (relEntries.length > 0) {
    console.log(`  Notable relationships:`);
    for (const [id, r] of relEntries.slice(0, 5)) {
      const other = world.npcs.find(n => n.id === parseInt(id));
      console.log(`    ${other ? other.name : '?'}: trust=${r.trust.toFixed(2)} affinity=${r.affinity.toFixed(2)}`);
    }
  }
}

// Determinism check
console.log(`\n═══ DETERMINISM CHECK ═══`);
const world2 = createWorld(seed);
for (let i = 0; i < TICKS; i++) tickWorld(world2);
const deterministic = world.tick === world2.tick && world.granary === world2.granary && 
  world.taxRate === world2.taxRate && world.npcs.every((n,i) => n.wealth === world2.npcs[i].wealth);
console.log(`Deterministic: ${deterministic ? '✅ YES' : '❌ NO'}`);

console.log(`\n═══ END STRESS TEST ═══`);
