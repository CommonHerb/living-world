'use strict';

const { getMoodLabel, getOverallMood } = require('./npc');
const { detectFactions, giniCoefficient } = require('./politics');
const { formatChronicle } = require('./chronicle');
const { COMMODITIES } = require('./market');

function formatStatus(world) {
  const councilNames = world.council
    .map(id => world.npcs.find(n => n.id === id))
    .map(n => `${n.name} (${n.job[0].toUpperCase()})`)
    .join(', ');

  const mood = getOverallMood(world.npcs);
  const pct = Math.round(world.taxRate * 100);

  // Market prices
  const prices = COMMODITIES
    .filter(c => world.market.lastClearingPrices[c] !== null)
    .map(c => `${c}:${world.market.lastClearingPrices[c].toFixed(1)}g`)
    .join('  ');

  return [
    `══════════════ MILLHAVEN ══════════════`,
    `  Day ${world.tick} | Treasury: ${Math.floor(world.treasury)}g | Tax: ${pct}%`,
    `  Council: ${councilNames}`,
    `  Pop: ${world.npcs.length} | Mood: ${mood}`,
    `  Market: ${prices || 'no trades yet'}`,
    `═══════════════════════════════════════`,
  ].join('\n');
}

function formatRecentEvents(world, count = 10) {
  const recent = world.history.slice(-count);
  if (recent.length === 0) return 'No events yet.';
  return recent.map(e => `  Day ${e.tick}: ${e.text}`).join('\n');
}

function formatPeople(world) {
  const lines = ['Name            Job        Gold   Food  Mood       Tax Opinion  Memories'];
  lines.push('─'.repeat(78));
  for (const npc of world.npcs) {
    const name = npc.name.padEnd(15);
    const job = npc.job.padEnd(10);
    const gold = npc.gold.toFixed(0).padStart(5);
    const food = (npc.inventory.grain + npc.inventory.flour).toFixed(0).padStart(4);
    const mood = getMoodLabel(npc.opinions.satisfaction).padEnd(10);
    const tax = npc.opinions.taxSentiment > 0.2 ? 'Pro-tax' :
                npc.opinions.taxSentiment < -0.2 ? 'Anti-tax' : 'Moderate';
    const memCount = `${npc.memories.length}/12`;
    lines.push(`${name} ${job} ${gold}  ${food}  ${mood} ${tax.padEnd(10)} ${memCount}`);
  }
  return lines.join('\n');
}

function formatLook(world, name) {
  const npc = world.npcs.find(n => n.name.toLowerCase() === name.toLowerCase());
  if (!npc) return `No one named "${name}" found.`;

  const g = npc.genome;
  const inv = COMMODITIES.map(c => `${c}: ${npc.inventory[c]}`).join(', ');
  const beliefs = COMMODITIES.map(c => {
    const b = npc.priceBeliefs[c];
    return `${c}: ${b.low.toFixed(1)}-${b.high.toFixed(1)}g`;
  }).join(', ');

  const lines = [
    `═══ ${npc.name} the ${npc.job.charAt(0).toUpperCase() + npc.job.slice(1)} ═══`,
    `Position: (${npc.position.x}, ${npc.position.y}) | Gold: ${npc.gold.toFixed(1)}`,
    `Mood: ${getMoodLabel(npc.opinions.satisfaction)} | Emotional State: ${npc.emotionalState.toFixed(2)}`,
    '',
    'Inventory:',
    `  ${inv}`,
    '',
    'Price Beliefs:',
    `  ${beliefs}`,
    '',
    'Genome:',
    `  Vision: ${g.vision} | Metabolism: ${g.metabolism}`,
    `  Agreeableness: ${g.agreeableness.toFixed(2)} | Assertiveness: ${g.assertiveness.toFixed(2)}`,
    `  Fairness Sens: ${g.fairnessSens.toFixed(2)} | Stubbornness: ${g.stubbornness.toFixed(2)}`,
    `  Credulity: ${g.credulity.toFixed(2)} | Risk Tolerance: ${g.riskTolerance.toFixed(2)}`,
    '',
    'Opinions:',
    `  Tax Sentiment: ${npc.opinions.taxSentiment.toFixed(2)} (${npc.opinions.taxSentiment > 0 ? 'pro-tax' : 'anti-tax'})`,
    `  Leader Approval: ${npc.opinions.leaderApproval.toFixed(2)}`,
    `  Satisfaction: ${npc.opinions.satisfaction.toFixed(2)}`,
    '',
    `Memories (${npc.memories.length}/12):`,
  ];

  if (npc.memories.length === 0) {
    lines.push('  (none)');
  } else {
    for (const mem of npc.memories) {
      const fid = mem.fidelity.toFixed(2);
      const val = mem.valence >= 0 ? `+${mem.valence.toFixed(2)}` : mem.valence.toFixed(2);
      const dataStr = typeof mem.value === 'number' ? mem.value.toFixed(1) : String(mem.value);
      lines.push(`  Day ${mem.tick}: ${mem.eventType} [${mem.subject || '?'}] val:${val} fid:${fid} data:${dataStr}`);
    }
  }

  const rels = Object.entries(npc.relationships)
    .filter(([_, r]) => Math.abs(r.trust) > 0.15 || Math.abs(r.affinity) > 0.15)
    .map(([id, r]) => {
      const other = world.npcs.find(n => n.id === parseInt(id));
      return `  ${other ? other.name : '?'}: trust ${r.trust.toFixed(2)}, affinity ${r.affinity.toFixed(2)}`;
    });
  
  if (rels.length > 0) {
    lines.push('');
    lines.push('Relationships:');
    lines.push(...rels);
  }

  return lines.join('\n');
}

function formatMarket(world) {
  const lines = ['═══ MILLHAVEN MARKET ═══', ''];
  
  lines.push('Commodity    Price     Volume   Trend');
  lines.push('─'.repeat(45));
  
  for (const c of COMMODITIES) {
    const price = world.market.lastClearingPrices[c];
    const vol = world.market.lastTradeVolume[c];
    const history = world.market.priceHistory[c];
    
    let trend = '  —';
    if (history.length >= 2) {
      const prev = history[history.length - 2];
      const curr = history[history.length - 1];
      if (curr > prev * 1.05) trend = '  ↑';
      else if (curr < prev * 0.95) trend = '  ↓';
      else trend = '  →';
    }
    
    const priceStr = price !== null ? `${price.toFixed(2)}g` : 'no trades';
    lines.push(`${c.padEnd(12)} ${priceStr.padStart(8)}  ${String(vol).padStart(6)}   ${trend}`);
  }
  
  lines.push('');
  lines.push('Recent Trades:');
  if (world.market.tradeLog.length === 0) {
    lines.push('  (none)');
  } else {
    for (const t of world.market.tradeLog.slice(-10)) {
      lines.push(`  ${t.buyer.name} bought ${t.quantity} ${t.commodity} from ${t.seller.name} @ ${t.price.toFixed(2)}g`);
    }
  }
  
  return lines.join('\n');
}

function formatMap(world) {
  const grid = Array.from({ length: 10 }, () => Array(10).fill('.'));
  for (let i = 0; i < 10; i++) {
    grid[0][i] = '🌾'; grid[9][i] = '🌾';
    grid[i][0] = '🌾'; grid[i][9] = '🌾';
  }
  grid[4][4] = '🏛️';
  grid[3][3] = '🏠'; grid[3][5] = '🏠';
  grid[4][3] = '🏠'; grid[4][5] = '🏠';
  grid[5][4] = '🏠';

  for (const npc of world.npcs) {
    const { x, y } = npc.position;
    if (x >= 0 && x < 10 && y >= 0 && y < 10) {
      grid[y][x] = npc.id === 0 ? 'P' : npc.name[0];
    }
  }

  const lines = ['  0 1 2 3 4 5 6 7 8 9'];
  for (let y = 0; y < 10; y++) {
    lines.push(`${y} ${grid[y].join(' ')}`);
  }
  lines.push('');
  lines.push('🌾 = Farm  🏠 = Home  🏛️ = Town Hall');
  lines.push('Letters = NPCs (first initial)  P = Player');
  return lines.join('\n');
}

function formatFactions(world) {
  const { factions, unaligned } = detectFactions(world);
  if (factions.length === 0) return 'No clear factions have formed yet.';

  const lines = [];
  for (const f of factions) {
    lines.push(`${f.emoji} "${f.name}" (${f.members.length} NPCs) — ${f.desc}`);
    lines.push(`   Key members: ${f.members.slice(0, 4).map(n => n.name).join(', ')}`);
    lines.push(`   Avg tax sentiment: ${f.avgSentiment.toFixed(2)}`);
    lines.push('');
  }
  lines.push(`Unaligned: ${unaligned.length} NPCs`);
  return lines.join('\n');
}

function formatStats(world) {
  const gini = giniCoefficient(world.npcs);
  const avgGold = world.npcs.reduce((s, n) => s + n.gold, 0) / world.npcs.length;
  const avgSat = world.npcs.reduce((s, n) => s + n.opinions.satisfaction, 0) / world.npcs.length;
  const avgTax = world.npcs.reduce((s, n) => s + n.opinions.taxSentiment, 0) / world.npcs.length;
  const avgApproval = world.npcs.reduce((s, n) => s + n.opinions.leaderApproval, 0) / world.npcs.length;
  const totalMemories = world.npcs.reduce((s, n) => s + n.memories.length, 0);
  const avgFidelity = world.npcs.reduce((s, n) => {
    if (n.memories.length === 0) return s;
    return s + n.memories.reduce((ms, m) => ms + m.fidelity, 0) / n.memories.length;
  }, 0) / world.npcs.length;

  // Job distribution
  const jobCounts = {};
  for (const npc of world.npcs) {
    jobCounts[npc.job] = (jobCounts[npc.job] || 0) + 1;
  }
  const jobStr = Object.entries(jobCounts).map(([j, c]) => `${j}: ${c}`).join(', ');

  return [
    `═══ STATISTICS — Day ${world.tick} ═══`,
    `Gini Coefficient: ${gini.toFixed(3)}`,
    `Average Gold: ${avgGold.toFixed(1)}`,
    `Average Satisfaction: ${avgSat.toFixed(2)}`,
    `Average Tax Sentiment: ${avgTax.toFixed(2)}`,
    `Average Leader Approval: ${avgApproval.toFixed(2)}`,
    `Treasury: ${Math.floor(world.treasury)}g`,
    `Tax Rate: ${Math.round(world.taxRate * 100)}%`,
    `Jobs: ${jobStr}`,
    `Total Memories: ${totalMemories} across ${world.npcs.length} NPCs`,
    `Average Memory Fidelity: ${avgFidelity.toFixed(3)}`,
    `Chronicle Entries: ${world.chronicle ? world.chronicle.entries.length : 0}`,
  ].join('\n');
}

function formatHelp() {
  return [
    'Commands:',
    '  tick, t          Advance 1 tick',
    '  tick <n>         Advance n ticks',
    '  run              Auto-advance (1/sec) until stop',
    '  stop             Pause auto-advance',
    '  status, s        Settlement overview',
    '  look, l          Look around Millhaven',
    '  look <name>      Detailed view of one NPC',
    '  talk <name>      Talk to an NPC',
    '  news             Latest 5 Chronicle entries (narrative)',
    '  news all         Full newspaper',
    '  market, m        Market prices and recent trades',
    '  map              ASCII map with NPC positions',
    '  people, p        List all NPCs',
    '  factions         Show political clusters',
    '  stats            Simulation statistics',
    '  history          Timeline of elections & major events',
    '  chronicle        Raw Chronicle entries',
    '  seed             Show current seed',
    '  help             This message',
    '  quit             Exit',
  ].join('\n');
}

module.exports = {
  formatStatus, formatRecentEvents, formatPeople, formatLook,
  formatMap, formatFactions, formatStats, formatHelp, formatMarket,
  formatChronicleDisplay: formatChronicle,
};
