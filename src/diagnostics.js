'use strict';

const { giniCoefficient, detectFactions } = require('./politics');
const { queryChronicle } = require('./chronicle');

/**
 * Edge-of-Chaos Diagnostics — now per-settlement.
 */

function analyzeWealth(settlement) {
  const npcs = settlement.npcs.filter(n => n.alive !== false && !n.isChild);
  const golds = npcs.map(n => n.gold).sort((a, b) => a - b);
  const n = golds.length;
  if (n === 0) return { gini: 0, powerLawR2: 0, distribution: 'empty', mean: 0, score: 10 };
  
  const gini = giniCoefficient(npcs);
  const mean = golds.reduce((a, b) => a + b, 0) / n;

  const positiveGolds = golds.filter(g => g > 0).sort((a, b) => b - a);
  let powerLawR2 = 0;
  let distribution = 'degenerate';

  if (positiveGolds.length >= 3) {
    const logRank = positiveGolds.map((_, i) => Math.log(i + 1));
    const logVal = positiveGolds.map(g => Math.log(g));
    const nP = logRank.length;
    const sumX = logRank.reduce((a, b) => a + b, 0);
    const sumY = logVal.reduce((a, b) => a + b, 0);
    const sumXY = logRank.reduce((a, x, i) => a + x * logVal[i], 0);
    const sumX2 = logRank.reduce((a, x) => a + x * x, 0);
    const meanX = sumX / nP;
    const meanY = sumY / nP;
    const ssXY = sumXY - nP * meanX * meanY;
    const ssXX = sumX2 - nP * meanX * meanX;
    const ssYY = logVal.reduce((a, y) => a + (y - meanY) ** 2, 0);
    if (ssXX > 0 && ssYY > 0) powerLawR2 = (ssXY * ssXY) / (ssXX * ssYY);

    const std = Math.sqrt(golds.reduce((a, g) => a + (g - mean) ** 2, 0) / n);
    const cv = mean > 0 ? std / mean : 0;
    if (powerLawR2 > 0.85 && cv > 0.8) distribution = 'power-law';
    else if (cv < 0.3) distribution = 'normal';
    else distribution = 'mixed';
  }

  let score;
  if (distribution === 'power-law') score = gini >= 0.2 && gini <= 0.7 ? 90 : 60;
  else if (distribution === 'normal') score = 30;
  else if (distribution === 'degenerate') score = 10;
  else score = 50 + (gini > 0.2 ? 20 : 0);

  return { gini, powerLawR2, distribution, mean, score };
}

function analyzeElections(settlement) {
  const electionEvents = settlement.electionHistory || settlement.history.filter(e => e.type === 'election_detail');
  if (electionEvents.length === 0) return { avgMargin: null, competitiveness: 'unknown', score: 50 };

  const margins = [];
  for (const evt of electionEvents) {
    const matches = evt.text.match(/:\s*(\d+)/g);
    if (matches && matches.length >= 2) {
      const counts = matches.map(m => parseInt(m.replace(':', '').trim())).sort((a, b) => b - a);
      const total = counts.reduce((a, b) => a + b, 0);
      if (total > 0) margins.push((counts[0] - counts[1]) / total);
    }
  }

  if (margins.length === 0) return { avgMargin: null, competitiveness: 'unknown', score: 50 };
  const avgMargin = margins.reduce((a, b) => a + b, 0) / margins.length;

  let competitiveness, score;
  if (avgMargin < 0.1) { competitiveness = 'razor-thin'; score = 85; }
  else if (avgMargin < 0.25) { competitiveness = 'competitive'; score = 90; }
  else if (avgMargin < 0.4) { competitiveness = 'moderate'; score = 65; }
  else if (avgMargin < 0.6) { competitiveness = 'lopsided'; score = 40; }
  else { competitiveness = 'landslide'; score = 20; }

  return { avgMargin, competitiveness, score, electionCount: margins.length };
}

function analyzeOpinions(settlement) {
  const npcs = settlement.npcs.filter(n => n.alive !== false && !n.isChild);
  const stdDev = (arr) => {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return Math.sqrt(arr.reduce((a, v) => a + (v - mean) ** 2, 0) / arr.length);
  };
  if (npcs.length < 2) return { avgStd: 0, diagnosis: 'too few NPCs', score: 10 };

  const taxStd = stdDev(npcs.map(n => n.opinions.taxSentiment));
  const approvalStd = stdDev(npcs.map(n => n.opinions.leaderApproval));
  const satStd = stdDev(npcs.map(n => n.opinions.satisfaction));
  const avgStd = (taxStd + approvalStd + satStd) / 3;

  let score, diagnosis;
  if (avgStd < 0.05) { score = 10; diagnosis = 'convergence'; }
  else if (avgStd < 0.15) { score = 40; diagnosis = 'low diversity'; }
  else if (avgStd < 0.45) { score = 90; diagnosis = 'healthy disagreement'; }
  else if (avgStd < 0.65) { score = 60; diagnosis = 'high diversity'; }
  else { score = 25; diagnosis = 'noise'; }

  return { taxStd, approvalStd, satStd, avgStd, diagnosis, score };
}

function analyzeFactions(settlement) {
  const { factions, unaligned } = detectFactions(settlement);
  const npcs = settlement.npcs.filter(n => n.alive !== false && !n.isChild);
  const n = npcs.length;

  if (factions.length === 0) return { factionCount: 0, diagnosis: 'no factions', score: 30 };

  const aligned = factions.reduce((s, f) => s + f.members.length, 0);
  const sizes = factions.map(f => f.members.length);
  const dominance = Math.max(...sizes) / aligned;

  let score, diagnosis;
  if (factions.length === 1) { score = 35; diagnosis = 'single faction'; }
  else if (dominance > 0.8) { score = 40; diagnosis = 'one dominant'; }
  else if (dominance > 0.6) { score = 70; diagnosis = 'major/minor split'; }
  else { score = 90; diagnosis = 'balanced'; }

  if (unaligned.length >= 3 && unaligned.length <= n * 0.5) score = Math.min(100, score + 10);

  return {
    factionCount: factions.length,
    factions: factions.map(f => ({ name: f.name, size: f.members.length, avgSentiment: f.avgSentiment })),
    unaligned: unaligned.length,
    dominance,
    diagnosis,
    score,
  };
}

function analyzeMemories(settlement) {
  const npcs = settlement.npcs.filter(n => n.alive !== false && !n.isChild);
  const n = npcs.length;
  if (n === 0) return { uniqueTypes: 0, avgMemCount: 0, jaccardAvg: 0, diagnosis: 'empty', score: 10 };

  const allTypes = new Set();
  for (const npc of npcs) {
    for (const m of npc.memories) allTypes.add(m.eventType);
  }
  if (allTypes.size === 0) return { uniqueTypes: 0, avgMemCount: 0, jaccardAvg: 0, diagnosis: 'no memories', score: 10 };

  const avgMemCount = npcs.reduce((s, npc) => s + npc.memories.length, 0) / n;

  let jaccardSum = 0, pairs = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const setA = new Set(npcs[i].memories.map(m => m.eventType));
      const setB = new Set(npcs[j].memories.map(m => m.eventType));
      const union = new Set([...setA, ...setB]);
      const intersection = new Set([...setA].filter(x => setB.has(x)));
      const jaccard = union.size > 0 ? 1 - intersection.size / union.size : 0;
      jaccardSum += jaccard;
      pairs++;
    }
  }
  const jaccardAvg = pairs > 0 ? jaccardSum / pairs : 0;

  let score, diagnosis;
  if (jaccardAvg < 0.05) { score = 20; diagnosis = 'homogeneous'; }
  else if (jaccardAvg < 0.2) { score = 50; diagnosis = 'slightly varied'; }
  else if (jaccardAvg < 0.6) { score = 85; diagnosis = 'diverse — healthy'; }
  else { score = 50; diagnosis = 'fragmented'; }

  return { uniqueTypes: allTypes.size, avgMemCount, jaccardAvg, diagnosis, score };
}

function analyzeChronicle(settlement) {
  const entries = settlement.chronicle ? settlement.chronicle.entries : [];
  if (entries.length === 0) return { totalEntries: 0, uniqueTypes: 0, diagnosis: 'empty', score: 10 };

  const allTypes = new Set(entries.map(e => e.eventType));
  const half = Math.floor(entries.length / 2);
  const oldTypes = new Set(entries.slice(0, half).map(e => e.eventType));
  const newTypes = new Set(entries.slice(half).map(e => e.eventType));

  let trend, score;
  if (entries.length < 4) { trend = 'too early'; score = 50; }
  else if (newTypes.size >= oldTypes.size) { trend = 'stable/growing'; score = 85; }
  else if (newTypes.size >= oldTypes.size - 1) { trend = 'slightly declining'; score = 65; }
  else { trend = 'declining'; score = 35; }

  return { totalEntries: entries.length, uniqueTypes: allTypes.size, trend, score };
}

function computeVitality(scores) {
  const weights = { wealth: 0.15, elections: 0.20, opinions: 0.20, factions: 0.15, memories: 0.15, chronicle: 0.15 };
  let total = 0, totalWeight = 0;
  for (const [key, weight] of Object.entries(weights)) {
    if (scores[key] !== undefined) { total += scores[key] * weight; totalWeight += weight; }
  }
  const vitality = totalWeight > 0 ? Math.round(total / totalWeight) : 0;
  let status;
  if (vitality >= 75) status = '🟢 ALIVE';
  else if (vitality >= 50) status = '🟡 TEPID';
  else if (vitality >= 30) status = '🟠 STAGNATING';
  else status = '🔴 DEAD/CHAOTIC';
  return { vitality, status };
}

function formatDiagnostics(world, settlementId) {
  // Support being called with a settlement directly or a world object
  let settlement;
  if (world.settlements) {
    settlement = settlementId
      ? world.settlements.find(s => s.id === settlementId)
      : world.settlements[0];
  } else if (world.npcs) {
    settlement = world; // called with settlement directly
  }
  if (!settlement) return 'Settlement not found.';

  const wealth = analyzeWealth(settlement);
  const elections = analyzeElections(settlement);
  const opinions = analyzeOpinions(settlement);
  const factions = analyzeFactions(settlement);
  const memories = analyzeMemories(settlement);
  const chronicle = analyzeChronicle(settlement);

  const scores = {
    wealth: wealth.score, elections: elections.score, opinions: opinions.score,
    factions: factions.score, memories: memories.score, chronicle: chronicle.score,
  };
  const { vitality, status } = computeVitality(scores);

  const lines = [
    `═══ ${settlement.name.toUpperCase()} DIAGNOSTICS ═══`,
    `  Day ${world.tick} | Vitality: ${vitality}/100 ${status}`,
    '',
    `  Wealth: Gini ${wealth.gini.toFixed(3)} | ${wealth.distribution} | Score: ${wealth.score}`,
    `  Elections: ${elections.competitiveness || 'N/A'} | Score: ${elections.score}`,
    `  Opinions: σ ${opinions.avgStd?.toFixed(3) || 'N/A'} → ${opinions.diagnosis} | Score: ${opinions.score}`,
    `  Factions: ${factions.factionCount} | ${factions.diagnosis} | Score: ${factions.score}`,
    `  Memories: ${memories.diagnosis} | Score: ${memories.score}`,
    `  Chronicle: ${chronicle.trend} (${chronicle.totalEntries} entries) | Score: ${chronicle.score}`,
    '',
    `  VITALITY: ${vitality}/100 ${status}`,
  ];

  return lines.join('\n');
}

module.exports = {
  analyzeWealth, analyzeElections, analyzeOpinions,
  analyzeFactions, analyzeMemories, analyzeChronicle,
  computeVitality, formatDiagnostics,
};
