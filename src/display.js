'use strict';

const { getMoodLabel, getOverallMood } = require('./npc');
const { detectFactions, giniCoefficient } = require('./politics');
const { formatChronicle } = require('./chronicle');
const { COMMODITIES } = require('./market');
const { getLeaderTitle, getLeaderNames, getLivingAdults, getSettlementSatisfaction } = require('./settlement');

function formatStatus(world, settlementId) {
  const settlement = settlementId 
    ? world.settlements.find(s => s.id === settlementId)
    : world.settlements[0];
  if (!settlement) return 'Settlement not found.';
  return formatSettlementStatus(settlement, world.tick);
}

function formatSettlementStatus(settlement, tick) {
  const leaderTitle = getLeaderTitle(settlement);
  const leaderNames = getLeaderNames(settlement);
  const livingNpcs = settlement.npcs.filter(n => n.alive !== false);
  const adults = getLivingAdults(settlement);
  const mood = getOverallMood(adults.length > 0 ? adults : livingNpcs);
  const pct = Math.round(settlement.taxRate * 100);
  const govLabel = settlement.government === 'monarchy' ? '👑 Monarchy' : '🏛️ Council';

  const prices = COMMODITIES
    .filter(c => settlement.market.lastClearingPrices[c] !== null)
    .map(c => `${c}:${settlement.market.lastClearingPrices[c].toFixed(1)}g`)
    .join('  ');

  return [
    `══════════════ ${settlement.name.toUpperCase()} ══════════════`,
    `  Day ${tick} | ${govLabel} | Treasury: ${Math.floor(settlement.treasury)}g | Tax: ${pct}%`,
    `  ${leaderTitle}: ${leaderNames}`,
    `  Pop: ${livingNpcs.length} (${adults.length} adults) | Mood: ${mood}`,
    `  Market: ${prices || 'no trades yet'}`,
    `═══════════════════════════════════════`,
  ].join('\n');
}

function formatRecentEvents(world, count = 10, settlementId) {
  const settlement = settlementId
    ? world.settlements.find(s => s.id === settlementId)
    : world.settlements[0];
  if (!settlement) return 'Settlement not found.';
  const recent = settlement.history.slice(-count);
  if (recent.length === 0) return 'No events yet.';
  return recent.map(e => `  Day ${e.tick}: ${e.text}`).join('\n');
}

function formatPeople(world, settlementId) {
  const settlement = settlementId
    ? world.settlements.find(s => s.id === settlementId)
    : world.settlements[0];
  if (!settlement) return 'Settlement not found.';

  const lines = [`═══ ${settlement.name.toUpperCase()} RESIDENTS ═══`, ''];
  lines.push('Name            Job        Gold   Food  Mood       Tax Opinion  Memories');
  lines.push('─'.repeat(78));
  for (const npc of settlement.npcs.filter(n => n.alive !== false)) {
    if (npc.isChild) {
      lines.push(`${npc.name.padEnd(15)} child      —      —    —          —           —`);
      continue;
    }
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
  // Search across all settlements
  let npc = null;
  let settlement = null;
  for (const s of world.settlements) {
    npc = s.npcs.find(n => n.name.toLowerCase() === name.toLowerCase());
    if (npc) { settlement = s; break; }
  }
  if (!npc) return `No one named "${name}" found in any settlement.`;

  const g = npc.genome;
  const inv = COMMODITIES.map(c => `${c}: ${npc.inventory[c]}`).join(', ');
  const beliefs = COMMODITIES.map(c => {
    const b = npc.priceBeliefs[c];
    return `${c}: ${b.low.toFixed(1)}-${b.high.toFixed(1)}g`;
  }).join(', ');

  const lines = [
    `═══ ${npc.name} the ${npc.job.charAt(0).toUpperCase() + npc.job.slice(1)} ═══`,
    `Settlement: ${settlement.name} | Position: (${npc.position.x}, ${npc.position.y}) | Gold: ${npc.gold.toFixed(1)}`,
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
      const other = settlement.npcs.find(n => n.id === parseInt(id));
      return `  ${other ? other.name : '?'}: trust ${r.trust.toFixed(2)}, affinity ${r.affinity.toFixed(2)}`;
    });
  
  if (rels.length > 0) {
    lines.push('');
    lines.push('Relationships:');
    lines.push(...rels);
  }

  return lines.join('\n');
}

function formatMarket(world, settlementId) {
  const settlement = settlementId
    ? world.settlements.find(s => s.id === settlementId)
    : world.settlements[0];
  if (!settlement) return 'Settlement not found.';

  const lines = [`═══ ${settlement.name.toUpperCase()} MARKET ═══`, ''];
  
  lines.push('Commodity    Price     Volume   Trend');
  lines.push('─'.repeat(45));
  
  for (const c of COMMODITIES) {
    const price = settlement.market.lastClearingPrices[c];
    const vol = settlement.market.lastTradeVolume[c];
    const history = settlement.market.priceHistory[c];
    
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
  if (settlement.market.tradeLog.length === 0) {
    lines.push('  (none)');
  } else {
    for (const t of settlement.market.tradeLog.slice(-10)) {
      lines.push(`  ${t.buyer.name} bought ${t.quantity} ${t.commodity} from ${t.seller.name} @ ${t.price.toFixed(2)}g`);
    }
  }
  
  return lines.join('\n');
}

function formatMap(world, settlementId) {
  const settlement = settlementId
    ? world.settlements.find(s => s.id === settlementId)
    : world.settlements[0];
  if (!settlement) return 'Settlement not found.';

  const grid = Array.from({ length: 10 }, () => Array(10).fill('.'));
  for (let i = 0; i < 10; i++) {
    grid[0][i] = '🌾'; grid[9][i] = '🌾';
    grid[i][0] = '🌾'; grid[i][9] = '🌾';
  }
  grid[4][4] = '🏛️';
  grid[3][3] = '🏠'; grid[3][5] = '🏠';
  grid[4][3] = '🏠'; grid[4][5] = '🏠';
  grid[5][4] = '🏠';

  for (const npc of settlement.npcs.filter(n => n.alive !== false)) {
    const { x, y } = npc.position;
    if (x >= 0 && x < 10 && y >= 0 && y < 10) {
      grid[y][x] = npc.name[0];
    }
  }

  const lines = [`═══ ${settlement.name.toUpperCase()} MAP ═══`, '', '  0 1 2 3 4 5 6 7 8 9'];
  for (let y = 0; y < 10; y++) {
    lines.push(`${y} ${grid[y].join(' ')}`);
  }
  lines.push('');
  lines.push('🌾 = Farm  🏠 = Home  🏛️ = Town Hall');
  lines.push('Letters = NPCs (first initial)');
  return lines.join('\n');
}

function formatFactions(world, settlementId) {
  const settlement = settlementId
    ? world.settlements.find(s => s.id === settlementId)
    : world.settlements[0];
  if (!settlement) return 'Settlement not found.';

  const { factions, unaligned } = detectFactions(settlement);
  if (factions.length === 0) return `No clear factions have formed in ${settlement.name}.`;

  const lines = [`═══ ${settlement.name.toUpperCase()} FACTIONS ═══`, ''];
  for (const f of factions) {
    lines.push(`${f.emoji} "${f.name}" (${f.members.length} NPCs) — ${f.desc}`);
    lines.push(`   Key members: ${f.members.slice(0, 4).map(n => n.name).join(', ')}`);
    lines.push(`   Avg tax sentiment: ${f.avgSentiment.toFixed(2)}`);
    lines.push('');
  }
  lines.push(`Unaligned: ${unaligned.length} NPCs`);
  return lines.join('\n');
}

function formatStats(world, settlementId) {
  const settlement = settlementId
    ? world.settlements.find(s => s.id === settlementId)
    : world.settlements[0];
  if (!settlement) return 'Settlement not found.';

  const npcs = settlement.npcs.filter(n => n.alive !== false && !n.isChild);
  const gini = giniCoefficient(npcs);
  const avgGold = npcs.reduce((s, n) => s + n.gold, 0) / npcs.length;
  const avgSat = npcs.reduce((s, n) => s + n.opinions.satisfaction, 0) / npcs.length;
  const avgTax = npcs.reduce((s, n) => s + n.opinions.taxSentiment, 0) / npcs.length;
  const avgApproval = npcs.reduce((s, n) => s + n.opinions.leaderApproval, 0) / npcs.length;
  const totalMemories = npcs.reduce((s, n) => s + n.memories.length, 0);
  const avgFidelity = npcs.reduce((s, n) => {
    if (n.memories.length === 0) return s;
    return s + n.memories.reduce((ms, m) => ms + m.fidelity, 0) / n.memories.length;
  }, 0) / npcs.length;

  const jobCounts = {};
  for (const npc of npcs) {
    jobCounts[npc.job] = (jobCounts[npc.job] || 0) + 1;
  }
  const jobStr = Object.entries(jobCounts).map(([j, c]) => `${j}: ${c}`).join(', ');

  return [
    `═══ ${settlement.name.toUpperCase()} STATISTICS — Day ${world.tick} ═══`,
    `Government: ${settlement.government === 'monarchy' ? '👑 Monarchy' : '🏛️ Council'}`,
    `Gini Coefficient: ${gini.toFixed(3)}`,
    `Average Gold: ${avgGold.toFixed(1)}`,
    `Average Satisfaction: ${avgSat.toFixed(2)}`,
    `Average Tax Sentiment: ${avgTax.toFixed(2)}`,
    `Average Leader Approval: ${avgApproval.toFixed(2)}`,
    `Treasury: ${Math.floor(settlement.treasury)}g`,
    `Tax Rate: ${Math.round(settlement.taxRate * 100)}%`,
    `Jobs: ${jobStr}`,
    `Total Memories: ${totalMemories} across ${npcs.length} NPCs`,
    `Average Memory Fidelity: ${avgFidelity.toFixed(3)}`,
    `Chronicle Entries: ${settlement.chronicle ? settlement.chronicle.entries.length : 0}`,
  ].join('\n');
}

/**
 * NEW: settlements command — overview of all settlements.
 */
function formatSettlements(world) {
  const lines = [
    `═══════════════ THE WORLD — Day ${world.tick} ═══════════════`,
    '',
  ];

  for (const s of world.settlements) {
    const adults = getLivingAdults(s);
    const living = s.npcs.filter(n => n.alive !== false);
    const govLabel = s.government === 'monarchy' ? '👑' : '🏛️';
    const mood = getOverallMood(adults.length > 0 ? adults : living);
    const leaderNames = getLeaderNames(s);
    const pct = Math.round(s.taxRate * 100);

    const prices = COMMODITIES
      .filter(c => s.market.lastClearingPrices[c] !== null)
      .map(c => `${c}:${s.market.lastClearingPrices[c].toFixed(1)}g`)
      .join(' ');

    lines.push(`${govLabel} ${s.name} (${s.location.x}, ${s.location.y})`);
    lines.push(`  Pop: ${living.length} (${adults.length} adults) | Mood: ${mood}`);
    lines.push(`  ${getLeaderTitle(s)}: ${leaderNames}`);
    lines.push(`  Treasury: ${Math.floor(s.treasury)}g | Tax: ${pct}%`);
    lines.push(`  Market: ${prices || 'no trades'}`);

    // Show relationships with other settlements
    for (const other of world.settlements) {
      if (other.id === s.id) continue;
      const rel = s.relationships[other.id];
      if (rel) {
        const trustLabel = rel.trust > 0.5 ? 'Allied' : rel.trust > 0.2 ? 'Friendly' : rel.trust > -0.2 ? 'Neutral' : 'Hostile';
        lines.push(`  → ${other.name}: ${trustLabel} (trade vol: ${rel.tradeVolume || 0})`);
      } else {
        lines.push(`  → ${other.name}: No contact`);
      }
    }
    lines.push('');
  }

  // World-level events
  const worldEvents = world.history.slice(-5);
  if (worldEvents.length > 0) {
    lines.push('Recent World Events:');
    for (const e of worldEvents) {
      lines.push(`  Day ${e.tick}: ${e.text}`);
    }
  }

  lines.push('═══════════════════════════════════════════════');
  return lines.join('\n');
}

function formatHelp() {
  return [
    'Commands:',
    '  tick, t          Advance 1 tick',
    '  tick <n>         Advance n ticks',
    '  run              Auto-advance (1/sec) until stop',
    '  stop             Pause auto-advance',
    '  status, s        Settlement overview (default: first settlement)',
    '  settlements      Overview of ALL settlements, leaders, trade',
    '  goto <name>      Switch active settlement',
    '  look, l          Look around settlement',
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
    '  diag             Edge-of-chaos diagnostics & vitality score',
    '  law list         Show active laws',
    '  law load <file>  Enact a .herb.json law',
    '  law repeal <n>   Repeal a law by name',
    '  law tick         Run HERB VM fixpoint iteration',
    '  law status       HERB VM container status',
    '  seed             Show current seed',
    '  help             This message',
    '  quit             Exit',
  ].join('\n');
}

module.exports = {
  formatStatus, formatRecentEvents, formatPeople, formatLook,
  formatMap, formatFactions, formatStats, formatHelp, formatMarket,
  formatChronicleDisplay: formatChronicle,
  formatSettlements, formatSettlementStatus,
};
