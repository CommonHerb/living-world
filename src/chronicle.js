'use strict';

/**
 * The Chronicle: Append-only event log.
 * Every significant event gets an entry with:
 *   tick, eventType, actors[], outcome, significance (0-255)
 */

const SIGNIFICANCE_BASE = {
  founding: 250,
  election: 80,
  crisis: 120,
  hunger: 40,
  tax_change: 60,
  surplus: 30,
  gossip: 5,
  economy: 5,
  memory_formed: 3,
  bankruptcy: 70,
  relief: 60,
  price_spike: 50,
  market_crash: 100,
  gossip_distortion: 25,
};

const SIGNIFICANCE_THRESHOLD = 20;

function createChronicle() {
  return {
    entries: [],
    nextId: 1,
  };
}

function computeSignificance(eventType, params) {
  let base = SIGNIFICANCE_BASE[eventType] || 20;

  // Modifiers
  if (params.affectsAll) base += 30;
  if (params.isFirst) base += 80;
  if (params.changesLeadership) base += 50;
  if (params.affectedCount > 5) base += 20;
  if (params.crisisLevel) base += params.crisisLevel * 20;

  return Math.min(255, Math.max(0, base));
}

function recordEvent(chronicle, tick, eventType, actors, outcome, params = {}) {
  const significance = computeSignificance(eventType, params);
  if (significance < SIGNIFICANCE_THRESHOLD) return null;

  const entry = {
    id: chronicle.nextId++,
    tick,
    eventType,
    actors: actors || [],     // array of { id, name, role }
    outcome: outcome || '',   // human-readable outcome string
    significance,
  };

  chronicle.entries.push(entry);
  return entry;
}

/**
 * Get chronicle entries, optionally filtered.
 */
function queryChronicle(chronicle, filters = {}) {
  let results = chronicle.entries;

  if (filters.eventType) {
    results = results.filter(e => e.eventType === filters.eventType);
  }
  if (filters.minSignificance) {
    results = results.filter(e => e.significance >= filters.minSignificance);
  }
  if (filters.tickRange) {
    results = results.filter(e => e.tick >= filters.tickRange[0] && e.tick <= filters.tickRange[1]);
  }
  if (filters.actorId !== undefined) {
    results = results.filter(e => e.actors.some(a => a.id === filters.actorId));
  }
  if (filters.limit) {
    results = results.slice(-filters.limit);
  }

  return results;
}

/**
 * Format chronicle for display — the "newspaper"
 */
function formatChronicle(chronicle, count = 20) {
  const entries = chronicle.entries.slice(-count);
  if (entries.length === 0) return 'The Chronicle is empty. History has yet to be written.';

  const lines = ['═══ THE CHRONICLE OF MILLHAVEN ═══', ''];

  for (const entry of entries) {
    const stars = entry.significance >= 100 ? '★★★' :
                  entry.significance >= 60 ? '★★' : '★';
    const actorStr = entry.actors.length > 0
      ? entry.actors.map(a => a.name).join(', ')
      : 'the settlement';
    lines.push(`  Day ${entry.tick} [${stars}] ${entry.eventType.toUpperCase()}`);
    lines.push(`    Actors: ${actorStr}`);
    lines.push(`    ${entry.outcome}`);
    lines.push('');
  }

  lines.push(`Total entries: ${chronicle.entries.length}`);
  return lines.join('\n');
}

module.exports = {
  createChronicle, recordEvent, queryChronicle, formatChronicle,
  computeSignificance, SIGNIFICANCE_THRESHOLD,
};
