'use strict';

const { getMoodLabel, getOverallMood } = require('./npc');
const { detectFactions, giniCoefficient } = require('./politics');

function formatStatus(world) {
  const councilNames = world.council
    .map(id => world.npcs.find(n => n.id === id))
    .map(n => `${n.name} (${n.job[0].toUpperCase()})`)
    .join(', ');

  const mood = getOverallMood(world.npcs);
  const pct = Math.round(world.taxRate * 100);

  return [
    `══════════════ MILLHAVEN ══════════════`,
    `  Day ${world.tick} | Granary: ${world.granary} food | Tax: ${pct}%`,
    `  Council: ${councilNames}`,
    `  Pop: ${world.npcs.length} | Mood: ${mood}`,
    `═══════════════════════════════════════`,
  ].join('\n');
}

function formatRecentEvents(world, count = 10) {
  const recent = world.history.slice(-count);
  if (recent.length === 0) return 'No events yet.';
  return recent.map(e => `  Day ${e.tick}: ${e.text}`).join('\n');
}

function formatPeople(world) {
  const lines = ['Name            Job      Wealth  Mood       Tax Opinion'];
  lines.push('─'.repeat(60));
  for (const npc of world.npcs) {
    const name = npc.name.padEnd(15);
    const job = npc.job.padEnd(8);
    const wealth = String(npc.wealth).padStart(6);
    const mood = getMoodLabel(npc.opinions.satisfaction).padEnd(10);
    const tax = npc.opinions.taxSentiment > 0.2 ? 'Pro-tax' :
                npc.opinions.taxSentiment < -0.2 ? 'Anti-tax' : 'Moderate';
    lines.push(`${name} ${job} ${wealth}  ${mood} ${tax}`);
  }
  return lines.join('\n');
}

function formatLook(world, name) {
  const npc = world.npcs.find(n => n.name.toLowerCase() === name.toLowerCase());
  if (!npc) return `No one named "${name}" found.`;

  const g = npc.genome;
  const lines = [
    `═══ ${npc.name} the ${npc.job.charAt(0).toUpperCase() + npc.job.slice(1)} ═══`,
    `Position: (${npc.position.x}, ${npc.position.y}) | Wealth: ${npc.wealth} food`,
    `Mood: ${getMoodLabel(npc.opinions.satisfaction)} | Emotional State: ${npc.emotionalState.toFixed(2)}`,
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
    `Memories (${npc.memories.length}/5):`,
  ];

  if (npc.memories.length === 0) {
    lines.push('  (none)');
  } else {
    for (const mem of npc.memories) {
      lines.push(`  Day ${mem.tick}: ${mem.tag} (val: ${mem.valence.toFixed(2)}, int: ${mem.intensity.toFixed(2)}, data: ${typeof mem.data === 'number' ? mem.data.toFixed(2) : mem.data})`);
    }
  }

  // Relationships with trust > 0.15
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

function formatMap(world) {
  const grid = Array.from({ length: 10 }, () => Array(10).fill('.'));

  // Farm edges
  for (let i = 0; i < 10; i++) {
    grid[0][i] = '🌾'; grid[9][i] = '🌾';
    grid[i][0] = '🌾'; grid[i][9] = '🌾';
  }

  // Granary center
  grid[4][4] = '🏛️';

  // Some homes
  grid[3][3] = '🏠'; grid[3][5] = '🏠';
  grid[4][3] = '🏠'; grid[4][5] = '🏠';
  grid[5][4] = '🏠';

  // NPCs
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
  lines.push('🌾 = Farm  🏠 = Home  🏛️ = Granary');
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
  const avgWealth = world.npcs.reduce((s, n) => s + n.wealth, 0) / world.npcs.length;
  const avgSat = world.npcs.reduce((s, n) => s + n.opinions.satisfaction, 0) / world.npcs.length;
  const avgTax = world.npcs.reduce((s, n) => s + n.opinions.taxSentiment, 0) / world.npcs.length;
  const avgApproval = world.npcs.reduce((s, n) => s + n.opinions.leaderApproval, 0) / world.npcs.length;

  return [
    `═══ STATISTICS — Day ${world.tick} ═══`,
    `Gini Coefficient: ${gini.toFixed(3)}`,
    `Average Wealth: ${avgWealth.toFixed(1)} food`,
    `Average Satisfaction: ${avgSat.toFixed(2)}`,
    `Average Tax Sentiment: ${avgTax.toFixed(2)}`,
    `Average Leader Approval: ${avgApproval.toFixed(2)}`,
    `Granary: ${world.granary} food`,
    `Tax Rate: ${Math.round(world.taxRate * 100)}%`,
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
    '  map              ASCII map with NPC positions',
    '  people, p        List all NPCs',
    '  look <name>      Detailed view of one NPC',
    '  factions         Show political clusters',
    '  stats            Simulation statistics',
    '  history          Last 20 events',
    '  seed             Show current seed',
    '  help             This message',
    '  quit             Exit',
  ].join('\n');
}

module.exports = {
  formatStatus, formatRecentEvents, formatPeople, formatLook,
  formatMap, formatFactions, formatStats, formatHelp,
};
