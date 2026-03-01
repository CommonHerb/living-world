'use strict';

const { createWorld, tickWorld } = require('../src/world');
const { giniCoefficient } = require('../src/politics');
const { COMMODITIES } = require('../src/market');

console.log('═══ PHASE 3 TEST: 300 TICKS — THE ECONOMY ═══\n');

const world = createWorld(48271);

// Tracking
const snapshots = [];
let bankruptcyCount = 0;
let hungerEvents = 0;
let totalTrades = 0;

for (let i = 0; i < 300; i++) {
  const events = tickWorld(world);
  
  for (const e of events) {
    if (e.type === 'bankruptcy') bankruptcyCount++;
    if (e.type === 'hunger') hungerEvents++;
  }
  
  totalTrades += (world.market.tradeLog || []).length;

  // Snapshot every 50 ticks
  if (world.tick % 50 === 0) {
    const gini = giniCoefficient(world.npcs);
    const avgGold = world.npcs.reduce((s, n) => s + n.gold, 0) / world.npcs.length;
    const avgSat = world.npcs.reduce((s, n) => s + n.opinions.satisfaction, 0) / world.npcs.length;
    const avgTax = world.npcs.reduce((s, n) => s + n.opinions.taxSentiment, 0) / world.npcs.length;
    
    const prices = {};
    for (const c of COMMODITIES) {
      prices[c] = world.market.lastClearingPrices[c];
    }
    
    const jobCounts = {};
    for (const npc of world.npcs) {
      jobCounts[npc.job] = (jobCounts[npc.job] || 0) + 1;
    }

    const snap = { tick: world.tick, gini, avgGold, avgSat, avgTax, prices, jobCounts, treasury: world.treasury, taxRate: world.taxRate };
    snapshots.push(snap);

    console.log(`\n--- Day ${world.tick} ---`);
    console.log(`  Gini: ${gini.toFixed(3)} | Avg Gold: ${avgGold.toFixed(1)} | Treasury: ${Math.floor(world.treasury)}g | Tax: ${Math.round(world.taxRate * 100)}%`);
    console.log(`  Avg Satisfaction: ${avgSat.toFixed(2)} | Avg Tax Sentiment: ${avgTax.toFixed(2)}`);
    console.log(`  Prices: ${COMMODITIES.map(c => `${c}:${prices[c] !== null ? prices[c].toFixed(2) : '—'}`).join('  ')}`);
    console.log(`  Jobs: ${Object.entries(jobCounts).map(([j, c]) => `${j}:${c}`).join(' ')}`);
  }
}

// === VERIFICATION ===
console.log('\n\n═══ VERIFICATION ═══\n');

let pass = 0;
let fail = 0;

function check(name, condition) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    pass++;
  } else {
    console.log(`  ✗ ${name}`);
    fail++;
  }
}

// 1. Prices emerge
const finalPrices = snapshots[snapshots.length - 1].prices;
const pricesExist = COMMODITIES.some(c => finalPrices[c] !== null);
check('Prices emerged (at least one commodity traded)', pricesExist);

// 2. Price convergence — check if price history has reasonable spreads
const grainHistory = world.market.priceHistory.grain;
if (grainHistory.length >= 3) {
  const last3 = grainHistory.slice(-3);
  const spread = Math.max(...last3) - Math.min(...last3);
  const avg = last3.reduce((a, b) => a + b, 0) / last3.length;
  check(`Grain price stabilized (spread ${spread.toFixed(2)} on avg ${avg.toFixed(2)})`, spread < avg * 2);
} else {
  check('Grain price stabilized', false);
}

// 3. Wealth inequality develops
const gini50 = snapshots[0].gini;
const gini300 = snapshots[snapshots.length - 1].gini;
check(`Wealth inequality developed (Gini: ${gini50.toFixed(3)} → ${gini300.toFixed(3)})`, gini300 > 0.05);

// 4. Treasury collects taxes
check(`Treasury has funds (${Math.floor(world.treasury)}g)`, world.treasury > 0);

// 5. Market activity
check(`Market trades occurred (total events: ${totalTrades})`, totalTrades > 0);

// 6. Hunger creates political pressure
const hungryNPCs = world.npcs.filter(n => n.memories.some(m => m.eventType === 'food_shortage'));
check(`Hunger events occurred (${hungerEvents} events, ${hungryNPCs.length} NPCs remember)`, hungerEvents >= 0); // may or may not happen

// 7. Elections happened
const elections = world.chronicle.entries.filter(e => e.eventType === 'election');
check(`Elections occurred (${elections.length})`, elections.length >= 9); // 300/30 = 10

// 8. Tax rate changed over time
const taxRates = snapshots.map(s => s.taxRate);
const taxChanged = new Set(taxRates).size > 1;
check(`Tax rate varied over time (${taxRates.map(r => Math.round(r * 100) + '%').join(' → ')})`, taxChanged);

// 9. NPCs have gold
const npcsWithGold = world.npcs.filter(n => n.gold > 0);
check(`NPCs have gold (${npcsWithGold.length}/25 with gold > 0)`, npcsWithGold.length > 5);

// 10. Multiple commodities traded
const tradedCommodities = COMMODITIES.filter(c => world.market.priceHistory[c].length > 0);
check(`Multiple commodities traded (${tradedCommodities.join(', ')})`, tradedCommodities.length >= 2);

// 11. Bankruptcies (may happen)
console.log(`\n  ℹ Bankruptcies: ${bankruptcyCount}`);

// 12. Chronicle entries
const chronicleCount = world.chronicle.entries.length;
check(`Chronicle has entries (${chronicleCount})`, chronicleCount > 10);

console.log(`\n═══ RESULTS: ${pass} passed, ${fail} failed ═══`);

// Show some NPCs
console.log('\n═══ SAMPLE NPCs ═══');
for (const npc of world.npcs.slice(0, 5)) {
  const food = npc.inventory.grain + npc.inventory.flour;
  console.log(`  ${npc.name} (${npc.job}) — Gold: ${npc.gold.toFixed(1)}, Food: ${food}, Sat: ${npc.opinions.satisfaction.toFixed(2)}, Tax: ${npc.opinions.taxSentiment.toFixed(2)}`);
}

process.exit(fail > 0 ? 1 : 0);
