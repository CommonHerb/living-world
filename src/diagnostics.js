'use strict';

const { giniCoefficient, detectFactions } = require('./politics');
const { queryChronicle } = require('./chronicle');

/**
 * Edge-of-Chaos Diagnostics for living-world.
 * Measures simulation vitality across 6 dimensions + combined vitality score.
 */

// ─── 1. Wealth Distribution ───

function analyzeWealth(world) {
  const golds = world.npcs.map(n => n.gold).sort((a, b) => a - b);
  const n = golds.length;
  const gini = giniCoefficient(world.npcs);
  const mean = golds.reduce((a, b) => a + b, 0) / n;

  // Check for power-law (Pareto) shape:
  // In a power-law distribution, log(rank) vs log(value) is roughly linear.
  // We measure the R² of that fit. High R² = power law. Low R² = not.
  const positiveGolds = golds.filter(g => g > 0).sort((a, b) => b - a); // descending
  let powerLawR2 = 0;
  let distribution = 'degenerate';

  if (positiveGolds.length >= 3) {
    const logRank = positiveGolds.map((_, i) => Math.log(i + 1));
    const logVal = positiveGolds.map(g => Math.log(g));

    // Linear regression of logVal on logRank
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

    if (ssXX > 0 && ssYY > 0) {
      powerLawR2 = (ssXY * ssXY) / (ssXX * ssYY);
    }

    // Coefficient of variation to distinguish normal vs power-law
    const std = Math.sqrt(golds.reduce((a, g) => a + (g - mean) ** 2, 0) / n);
    const cv = mean > 0 ? std / mean : 0;

    if (powerLawR2 > 0.85 && cv > 0.8) distribution = 'power-law';
    else if (cv < 0.3) distribution = 'normal';
    else distribution = 'mixed';
  }

  // Score: power-law with moderate gini = edge of chaos (best)
  // gini 0.3-0.6 is the sweet spot
  let score;
  if (distribution === 'power-law') {
    score = gini >= 0.2 && gini <= 0.7 ? 90 : 60;
  } else if (distribution === 'normal') {
    score = 30; // too ordered
  } else if (distribution === 'degenerate') {
    score = 10;
  } else {
    score = 50 + (gini > 0.2 ? 20 : 0);
  }

  return { gini, powerLawR2, distribution, mean, score };
}

// ─── 2. Election Margins ───

function analyzeElections(world) {
  const electionEvents = world.history.filter(e => e.type === 'election_detail');
  if (electionEvents.length === 0) {
    return { avgMargin: null, marginTrend: 'no data', competitiveness: 'unknown', score: 50 };
  }

  const margins = [];
  for (const evt of electionEvents) {
    // Parse "Votes: Name: 8, Name: 7, Name: 5, ..."
    const matches = evt.text.match(/:\s*(\d+)/g);
    if (matches && matches.length >= 2) {
      const counts = matches.map(m => parseInt(m.replace(':', '').trim())).sort((a, b) => b - a);
      const total = counts.reduce((a, b) => a + b, 0);
      if (total > 0) {
        const margin = (counts[0] - counts[1]) / total;
        margins.push(margin);
      }
    }
  }

  if (margins.length === 0) return { avgMargin: null, marginTrend: 'no data', competitiveness: 'unknown', score: 50 };

  const avgMargin = margins.reduce((a, b) => a + b, 0) / margins.length;
  const recent = margins.slice(-3);
  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;

  let competitiveness, score;
  if (avgMargin < 0.1) { competitiveness = 'razor-thin'; score = 85; }
  else if (avgMargin < 0.25) { competitiveness = 'competitive'; score = 90; }
  else if (avgMargin < 0.4) { competitiveness = 'moderate'; score = 65; }
  else if (avgMargin < 0.6) { competitiveness = 'lopsided'; score = 40; }
  else { competitiveness = 'landslide'; score = 20; }

  const marginTrend = margins.length >= 2
    ? (recentAvg < avgMargin - 0.05 ? 'tightening' : recentAvg > avgMargin + 0.05 ? 'widening' : 'stable')
    : 'insufficient data';

  return { avgMargin, marginTrend, competitiveness, score, electionCount: margins.length };
}

// ─── 3. Opinion Diversity ───

function analyzeOpinions(world) {
  const npcs = world.npcs;
  const n = npcs.length;

  const taxes = npcs.map(n => n.opinions.taxSentiment);
  const approval = npcs.map(n => n.opinions.leaderApproval);
  const satisfaction = npcs.map(n => n.opinions.satisfaction);

  const stdDev = (arr) => {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return Math.sqrt(arr.reduce((a, v) => a + (v - mean) ** 2, 0) / arr.length);
  };

  const taxStd = stdDev(taxes);
  const approvalStd = stdDev(approval);
  const satStd = stdDev(satisfaction);
  const avgStd = (taxStd + approvalStd + satStd) / 3;

  // Sweet spot: std between 0.15 and 0.45 (on a -1 to 1 scale)
  let score, diagnosis;
  if (avgStd < 0.05) { score = 10; diagnosis = 'convergence — everyone thinks the same'; }
  else if (avgStd < 0.15) { score = 40; diagnosis = 'low diversity — mild disagreement only'; }
  else if (avgStd < 0.45) { score = 90; diagnosis = 'structured disagreement — healthy'; }
  else if (avgStd < 0.65) { score = 60; diagnosis = 'high diversity — approaching noise'; }
  else { score = 25; diagnosis = 'random noise — no coherent structure'; }

  return { taxStd, approvalStd, satStd, avgStd, diagnosis, score };
}

// ─── 4. Faction Stability ───

function analyzeFactions(world) {
  const { factions, unaligned } = detectFactions(world);
  const n = world.npcs.length;

  if (factions.length === 0) {
    return { factionCount: 0, alignedRatio: 0, diagnosis: 'no factions — amorphous', score: 30 };
  }

  const aligned = factions.reduce((s, f) => s + f.members.length, 0);
  const alignedRatio = aligned / n;

  // We can't track switches without historical faction data, so we use
  // the current distribution as a proxy: healthy = 2+ factions, neither dominant
  const sizes = factions.map(f => f.members.length);
  const largest = Math.max(...sizes);
  const dominance = largest / aligned;

  let score, diagnosis;
  if (factions.length === 1) {
    score = 35;
    diagnosis = 'single faction — one-party state';
  } else if (dominance > 0.8) {
    score = 40;
    diagnosis = 'one dominant faction — weak opposition';
  } else if (dominance > 0.6) {
    score = 70;
    diagnosis = 'major/minor split — functional opposition';
  } else {
    score = 90;
    diagnosis = 'balanced factions — competitive';
  }

  // Bonus for unaligned (swing voters add dynamism)
  if (unaligned.length >= 3 && unaligned.length <= n * 0.5) score = Math.min(100, score + 10);

  return {
    factionCount: factions.length,
    factions: factions.map(f => ({ name: f.name, size: f.members.length, avgSentiment: f.avgSentiment })),
    unaligned: unaligned.length,
    alignedRatio,
    dominance,
    diagnosis,
    score,
  };
}

// ─── 5. Memory Diversity ───

function analyzeMemories(world) {
  const npcs = world.npcs;
  const n = npcs.length;

  // Collect all memory type distributions per NPC
  const allTypes = new Set();
  const npcTypeSets = npcs.map(npc => {
    const types = {};
    for (const m of npc.memories) {
      types[m.eventType] = (types[m.eventType] || 0) + 1;
      allTypes.add(m.eventType);
    }
    return types;
  });

  if (allTypes.size === 0) {
    return { uniqueTypes: 0, avgMemCount: 0, jaccardAvg: 0, diagnosis: 'no memories', score: 10 };
  }

  const avgMemCount = npcs.reduce((s, npc) => s + npc.memories.length, 0) / n;

  // Jaccard dissimilarity between all pairs of NPCs' memory TYPE sets
  let jaccardSum = 0;
  let pairs = 0;
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

  // Also check valence diversity — are memories emotionally varied?
  const allValences = npcs.flatMap(npc => npc.memories.map(m => m.valence));
  const valenceStd = allValences.length > 1
    ? Math.sqrt(allValences.reduce((a, v) => a + (v - allValences.reduce((s, x) => s + x, 0) / allValences.length) ** 2, 0) / allValences.length)
    : 0;

  // Score: moderate Jaccard dissimilarity = healthy (0.2-0.6)
  let score, diagnosis;
  if (jaccardAvg < 0.05) { score = 20; diagnosis = 'homogeneous — everyone remembers the same things'; }
  else if (jaccardAvg < 0.2) { score = 50; diagnosis = 'slightly varied memories'; }
  else if (jaccardAvg < 0.6) { score = 85; diagnosis = 'diverse memory ecology — healthy'; }
  else { score = 50; diagnosis = 'very fragmented — little shared experience'; }

  return { uniqueTypes: allTypes.size, avgMemCount, jaccardAvg, valenceStd, diagnosis, score };
}

// ─── 6. Chronicle Event Diversity ───

function analyzeChronicle(world) {
  const entries = world.chronicle ? world.chronicle.entries : [];
  if (entries.length === 0) {
    return { totalEntries: 0, uniqueTypes: 0, diagnosis: 'empty chronicle', score: 10 };
  }

  const allTypes = new Set(entries.map(e => e.eventType));

  // Recent vs old diversity
  const half = Math.floor(entries.length / 2);
  const oldTypes = new Set(entries.slice(0, half).map(e => e.eventType));
  const newTypes = new Set(entries.slice(half).map(e => e.eventType));

  let trend, score;
  if (entries.length < 4) {
    trend = 'too early';
    score = 50;
  } else if (newTypes.size >= oldTypes.size) {
    trend = 'stable or growing';
    score = 85;
  } else if (newTypes.size >= oldTypes.size - 1) {
    trend = 'slightly declining';
    score = 65;
  } else {
    trend = 'declining — stagnation risk';
    score = 35;
  }

  return {
    totalEntries: entries.length,
    uniqueTypes: allTypes.size,
    typeList: [...allTypes],
    oldDiversity: oldTypes.size,
    newDiversity: newTypes.size,
    trend,
    score,
  };
}

// ─── 7. Vitality Score ───

function computeVitality(scores) {
  // Weighted combination
  const weights = {
    wealth: 0.15,
    elections: 0.20,
    opinions: 0.20,
    factions: 0.15,
    memories: 0.15,
    chronicle: 0.15,
  };

  let total = 0;
  let totalWeight = 0;
  for (const [key, weight] of Object.entries(weights)) {
    if (scores[key] !== undefined) {
      total += scores[key] * weight;
      totalWeight += weight;
    }
  }

  const vitality = totalWeight > 0 ? Math.round(total / totalWeight) : 0;

  let status;
  if (vitality >= 75) status = '🟢 ALIVE';
  else if (vitality >= 50) status = '🟡 TEPID';
  else if (vitality >= 30) status = '🟠 STAGNATING';
  else status = '🔴 DEAD/CHAOTIC';

  return { vitality, status };
}

// ─── Format for Display ───

function formatDiagnostics(world) {
  const wealth = analyzeWealth(world);
  const elections = analyzeElections(world);
  const opinions = analyzeOpinions(world);
  const factions = analyzeFactions(world);
  const memories = analyzeMemories(world);
  const chronicle = analyzeChronicle(world);

  const scores = {
    wealth: wealth.score,
    elections: elections.score,
    opinions: opinions.score,
    factions: factions.score,
    memories: memories.score,
    chronicle: chronicle.score,
  };

  const { vitality, status } = computeVitality(scores);

  const lines = [
    '═══ EDGE-OF-CHAOS DIAGNOSTICS ═══',
    `  Day ${world.tick} | Vitality: ${vitality}/100 ${status}`,
    '',
    '─── Wealth Distribution ───',
    `  Gini coefficient: ${wealth.gini.toFixed(3)}`,
    `  Distribution: ${wealth.distribution} (power-law R²: ${wealth.powerLawR2.toFixed(3)})`,
    `  Mean gold: ${wealth.mean.toFixed(1)}`,
    `  Score: ${wealth.score}/100`,
    '',
    '─── Election Margins ───',
    elections.avgMargin !== null
      ? `  Avg margin: ${(elections.avgMargin * 100).toFixed(1)}% (${elections.competitiveness})`
      : '  No elections yet',
    elections.marginTrend !== 'no data' ? `  Trend: ${elections.marginTrend}` : '',
    elections.electionCount ? `  Elections tracked: ${elections.electionCount}` : '',
    `  Score: ${elections.score}/100`,
    '',
    '─── Opinion Diversity ───',
    `  Tax σ: ${opinions.taxStd.toFixed(3)} | Approval σ: ${opinions.approvalStd.toFixed(3)} | Satisfaction σ: ${opinions.satStd.toFixed(3)}`,
    `  Avg σ: ${opinions.avgStd.toFixed(3)} → ${opinions.diagnosis}`,
    `  Score: ${opinions.score}/100`,
    '',
    '─── Faction Analysis ───',
    `  Factions: ${factions.factionCount}`,
    ...(factions.factions || []).map(f => `    ${f.name}: ${f.size} members (avg sentiment: ${f.avgSentiment.toFixed(2)})`),
    factions.unaligned !== undefined ? `  Unaligned: ${factions.unaligned}` : '',
    `  ${factions.diagnosis}`,
    `  Score: ${factions.score}/100`,
    '',
    '─── Memory Diversity ───',
    `  Unique memory types: ${memories.uniqueTypes} | Avg memories/NPC: ${memories.avgMemCount.toFixed(1)}`,
    `  Jaccard dissimilarity: ${memories.jaccardAvg.toFixed(3)}`,
    `  ${memories.diagnosis}`,
    `  Score: ${memories.score}/100`,
    '',
    '─── Chronicle Diversity ───',
    `  Total entries: ${chronicle.totalEntries} | Unique types: ${chronicle.uniqueTypes}`,
    chronicle.oldDiversity !== undefined ? `  Old half types: ${chronicle.oldDiversity} | New half types: ${chronicle.newDiversity}` : '',
    `  Trend: ${chronicle.trend}`,
    `  Score: ${chronicle.score}/100`,
    '',
    '═══════════════════════════════════',
    `  VITALITY: ${vitality}/100 ${status}`,
    '═══════════════════════════════════',
  ].filter(l => l !== '');

  return lines.join('\n');
}

module.exports = {
  analyzeWealth, analyzeElections, analyzeOpinions,
  analyzeFactions, analyzeMemories, analyzeChronicle,
  computeVitality, formatDiagnostics,
};
