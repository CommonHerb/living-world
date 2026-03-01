'use strict';

/**
 * Phase 9: Emergent Religion Engine
 * 
 * Religion emerges from the gossip/memory system:
 * 1. Dramatic Chronicle events enter gossip → distort over ~50 ticks → become "myths"
 * 2. When 60%+ NPCs share the same myth variant → "belief"
 * 3. Beliefs persisting 100+ ticks → rituals (recurring Chronicle events)
 * 4. NPCs who spread beliefs fastest → "priests" (social influence bonus)
 * 5. Two incompatible beliefs both at 40%+ → schism
 * 6. Beliefs generate sacred law pressure on opinions
 * 7. `beliefs` command shows everything
 * 
 * Takes a settlement object (has .npcs, .chronicle, .tick, .events, .religion).
 */

const { recordEvent, queryChronicle } = require('./chronicle');

// ── Data Structures ──

function createReligionState() {
  return {
    myths: [],
    beliefs: [],
    rituals: [],
    priests: [],     // NPC ids
    schisms: [],
    nextMythId: 1,
  };
}

// ── Helpers ──

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function getLiving(settlement) {
  return settlement.npcs.filter(n => n.alive !== false && !n.isChild);
}

function seededRandom(settlement) {
  // Use settlement's tickRng if available, else Math.random
  return settlement.tickRng ? settlement.tickRng.random() : Math.random();
}

function seededPick(arr, settlement) {
  return arr[Math.floor(seededRandom(settlement) * arr.length)];
}

// ── Myth Detection ──

function detectMyths(settlement, tick) {
  const religion = settlement.religion;
  const living = getLiving(settlement);
  if (living.length === 0 || !settlement.chronicle) return;

  // Group old significant events by type+era (50-tick buckets) to avoid myth spam
  const oldEvents = queryChronicle(settlement.chronicle, {
    minSignificance: 60,
  }).filter(e => (tick - e.tick) >= 50);

  // Deduplicate: only process one event per eventType per 50-tick era
  const seen = new Set();
  const deduped = [];
  for (const event of oldEvents) {
    const era = Math.floor(event.tick / 50);
    const key = `${event.eventType}:${era}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(event);
  }

  for (const event of deduped) {
    // Skip if we already have a myth for this event type + era
    const eventEra = Math.floor(event.tick / 50);
    if (religion.myths.some(m => 
      m.sourceEventType === event.eventType && 
      Math.floor(m.sourceTick / 50) === eventEra
    )) continue;

    // Cap: max 3 myths per event type to prevent spam
    const mythsOfType = religion.myths.filter(m => m.sourceEventType === event.eventType);
    if (mythsOfType.length >= 3) continue;

    // Find NPCs with ANY memories of this event type (not just exact tick match)
    // This is broader — myths are about event TYPES, not specific instances
    const memoriesOfEvent = [];
    const seenNpcs = new Set();
    for (const npc of living) {
      for (const mem of npc.memories) {
        if (mem.eventType === event.eventType && !seenNpcs.has(npc.id)) {
          memoriesOfEvent.push({ npcId: npc.id, memory: mem });
          seenNpcs.add(npc.id);
        }
      }
    }

    if (memoriesOfEvent.length < 3) continue;

    const avgFidelity = memoriesOfEvent.reduce((s, m) => s + m.memory.fidelity, 0) / memoriesOfEvent.length;
    const avgValue = memoriesOfEvent.reduce((s, m) => s + m.memory.value, 0) / memoriesOfEvent.length;
    const avgValence = memoriesOfEvent.reduce((s, m) => s + m.memory.valence, 0) / memoriesOfEvent.length;

    const mythNarrative = generateMythNarrative(event, avgFidelity, settlement);
    const moral = deriveMoral(event.eventType, avgValence, settlement);

    const mythName = generateMythName(event.eventType, avgFidelity, avgValence, settlement);

    const myth = {
      id: religion.nextMythId++,
      name: mythName,
      sourceEventId: event.id,
      sourceEventType: event.eventType,
      sourceTick: event.tick,
      formedTick: tick,
      narrative: mythNarrative,
      originalOutcome: event.outcome,
      distortedValue: avgValue,
      distortedValence: avgValence,
      avgFidelity,
      holders: memoriesOfEvent.map(m => m.npcId),
      moral,
      behaviorEffect: deriveBehaviorEffect(event.eventType, avgValence),
    };

    religion.myths.push(myth);

    recordEvent(settlement.chronicle, tick, 'myth_formed', [],
      `A myth has formed: "${mythName}" — ${mythNarrative}`,
      { affectsAll: true, affectedCount: memoriesOfEvent.length }
    );

    settlement.events.push({
      tick,
      type: 'myth',
      text: `MYTH FORMED: "${mythName}" — ${mythNarrative}`,
    });
  }
}

// ── Myth Name Generation ──

function generateMythName(eventType, fidelity, valence, settlement) {
  const dramatic = fidelity < 0.3;
  const dark = valence < -0.2;

  const nameTemplates = {
    crisis: dark
      ? ['The Great Hunger', 'The Starving Days', 'The Empty Granary', 'The Long Fast', 'The Wasting']
      : ['The Trial of Want', 'The Lean Season', 'The Testing', 'The Scarcity'],
    election: [
      'The Choosing', 'The Voice of Many', 'The Great Assembly', 'The Day of Names',
      'The Reckoning of Hands',
    ],
    tax_change: dark
      ? ['The Heavy Burden', 'The Tithe of Sorrows', 'The Crushing Levy', 'The Tax of Tears']
      : ['The Fair Portion', 'The Common Offering', 'The Shared Load', 'The Tithe'],
    founding: [
      'The First Planting', 'The Arrival', 'The Claiming', 'The Setting of Stones',
      'The Dream of the Founders',
    ],
    death: dramatic
      ? ['The Great Passing', 'The Shadow\'s Harvest', 'The Final Silence', 'The Lost Light']
      : ['The Departure', 'The Crossing Over', 'The Last Breath', 'The Ancestor\'s Call'],
    marriage: [
      'The Binding', 'The Union of Souls', 'The Joining', 'The Vow Beneath Stars',
    ],
    surplus: [
      'The Golden Plenty', 'The Overflowing Stores', 'The Blessed Harvest',
      'The Season of Abundance', 'The Fat Days',
    ],
    bankruptcy: [
      'The Ruin', 'The Fall of Fortune', 'The Emptying', 'The Curse of Greed',
      'The Day the Gold Died',
    ],
  };

  const pool = nameTemplates[eventType] || [
    'The Strange Happening', 'The Omen', 'The Sign', 'The Turning',
  ];

  return seededPick(pool, settlement);
}

// ── Myth Narrative Templates ──

function generateMythNarrative(event, fidelity, settlement) {
  const dramatic = fidelity < 0.3;

  const templates = {
    crisis: [
      'The Great Hunger came because the people grew too proud',
      'The spirits punished the settlement with famine for its greed',
      'A darkness fell upon the land when the treasury was empty',
      'The ancestors sent a warning through starvation',
    ],
    election: [
      'The council was chosen by the river spirit itself',
      'A great leader arose to save the people from chaos',
      'The old ways demanded new voices speak for the settlement',
      'The spirits guided the hands of those who voted',
    ],
    tax_change: [
      'The burden was placed upon the people by forces unseen',
      'The wise ones demanded sacrifice for the common good',
      'Greed nearly destroyed what the founders built',
      'The spirits of the land required their tribute',
    ],
    founding: [
      'In the beginning, the river called the first people to this place',
      'The founders were guided by spirits to the sacred ground',
      'Before time was counted, the ancestors planted roots here',
      'The land itself chose who would live upon it',
    ],
    death: [
      'The spirits called a great soul home to the river',
      'A light went out, and the darkness grew',
      'The ancestors welcomed one of their own back',
      'A sacrifice was made so others could endure',
    ],
    marriage: [
      'Two souls were bound by the will of the old spirits',
      'The ancestors blessed a union that would shape the future',
      'Love conquered what politics could not',
    ],
    surplus: [
      'The land rewarded the faithful with abundance',
      'The spirits smiled upon the settlement and filled its stores',
      'Prosperity came to those who honored the old ways',
    ],
    bankruptcy: [
      'Ruin came to those who forgot the spirits',
      'The greedy were struck down by the ancestors\' justice',
      'A curse fell upon those who hoarded while others starved',
    ],
  };

  const pool = templates[event.eventType] || [
    'The spirits shaped events that mortals cannot understand',
    'Something beyond human control changed the course of history',
    'The ancestors moved in ways the living could not see',
  ];

  const idx = dramatic
    ? Math.min(pool.length - 1, Math.floor(seededRandom(settlement) * pool.length * 0.5) + Math.floor(pool.length * 0.5))
    : Math.floor(seededRandom(settlement) * pool.length);

  return pool[idx];
}

function deriveMoral(eventType, valence, settlement) {
  if (valence < -0.3) {
    const morals = ['hubris_punished', 'greed_cursed', 'outsiders_dangerous', 'tradition_neglected'];
    return seededPick(morals, settlement);
  }
  if (valence > 0.3) {
    const morals = ['unity_saves', 'leaders_necessary', 'tradition_sacred', 'generosity_rewarded'];
    return seededPick(morals, settlement);
  }
  return 'balance_required';
}

function deriveBehaviorEffect(eventType, valence) {
  const effects = {};
  if (eventType === 'crisis' || eventType === 'bankruptcy') {
    effects.taxSentiment = valence < 0 ? 0.1 : -0.05;
    effects.satisfaction = -0.05;
  } else if (eventType === 'election') {
    effects.leaderApproval = 0.05;
  } else if (eventType === 'surplus') {
    effects.satisfaction = 0.03;
    effects.taxSentiment = 0.05;
  } else if (eventType === 'tax_change') {
    effects.taxSentiment = valence < 0 ? -0.1 : 0.05;
  }
  return effects;
}

// ── Belief Detection ──

function refreshHolders(myth, living) {
  myth.holders = [];
  for (const npc of living) {
    // Broad match: any memory of this event type counts as "holding" the myth
    // This represents cultural awareness — they've heard SOME version of the story
    if (npc.memories.some(m => m.eventType === myth.sourceEventType)) {
      myth.holders.push(npc.id);
    }
  }
}

function detectBeliefs(settlement, tick) {
  const religion = settlement.religion;
  const living = getLiving(settlement);
  if (living.length === 0) return;
  const threshold = Math.floor(living.length * 0.6);

  for (const myth of religion.myths) {
    if (religion.beliefs.some(b => b.mythId === myth.id)) continue;

    // Holders are refreshed in the main tick, just check count
    if (myth.holders.length >= threshold) {
      const belief = {
        mythId: myth.id,
        formedTick: tick,
        narrative: myth.narrative,
        moral: myth.moral,
        behaviorEffect: myth.behaviorEffect,
        adoptionRate: myth.holders.length / living.length,
      };

      religion.beliefs.push(belief);

      recordEvent(settlement.chronicle, tick, 'belief_formed', [],
        `A belief has taken hold: "${myth.narrative}" (${Math.round(belief.adoptionRate * 100)}% adoption)`,
        { affectsAll: true, affectedCount: myth.holders.length }
      );

      settlement.events.push({
        tick,
        type: 'belief',
        text: `BELIEF FORMED: "${myth.narrative}" — Moral: ${myth.moral} (${Math.round(belief.adoptionRate * 100)}% adoption)`,
      });
    }
  }
}

// ── Belief Effects ──

function applyBeliefEffects(settlement) {
  const religion = settlement.religion;
  if (!religion || religion.beliefs.length === 0) return;
  const living = getLiving(settlement);

  for (const belief of religion.beliefs) {
    const myth = religion.myths.find(m => m.id === belief.mythId);
    if (!myth || !myth.behaviorEffect) continue;

    const effect = myth.behaviorEffect;
    for (const npc of living) {
      if (!myth.holders.includes(npc.id)) continue;
      if (effect.taxSentiment)
        npc.opinions.taxSentiment = clamp(npc.opinions.taxSentiment + effect.taxSentiment * 0.01, -1, 1);
      if (effect.leaderApproval)
        npc.opinions.leaderApproval = clamp(npc.opinions.leaderApproval + effect.leaderApproval * 0.01, -1, 1);
      if (effect.satisfaction)
        npc.opinions.satisfaction = clamp(npc.opinions.satisfaction + effect.satisfaction * 0.01, -1, 1);
    }
  }
}

// ── Rituals ──

function detectRituals(settlement, tick) {
  const religion = settlement.religion;

  for (const belief of religion.beliefs) {
    if (religion.rituals.some(r => r.beliefMythId === belief.mythId)) continue;

    const age = tick - belief.formedTick;
    if (age < 100) continue;

    const myth = religion.myths.find(m => m.id === belief.mythId);
    if (!myth) continue;
    const living = getLiving(settlement);
    if (myth.holders.length < living.length * 0.4) continue;

    const ritualName = generateRitualName(myth, settlement);
    const ritual = {
      beliefMythId: belief.mythId,
      name: ritualName,
      formedTick: tick,
      lastPerformed: tick,
      period: 50,
      narrative: `The citizens gather for the ${ritualName}, remembering: "${belief.narrative}"`,
    };

    religion.rituals.push(ritual);

    recordEvent(settlement.chronicle, tick, 'ritual_formed', [],
      `A ritual has emerged: "${ritualName}" — ${ritual.narrative}`,
      { affectsAll: true }
    );

    settlement.events.push({
      tick,
      type: 'ritual',
      text: `RITUAL FORMED: "${ritualName}" — performed every ${ritual.period} days`,
    });
  }
}

function generateRitualName(myth, settlement) {
  const prefixes = ['The Annual', 'The Sacred', 'The Great', 'The Solemn'];
  const names = {
    crisis: ['Fast of Remembrance', 'Hunger Vigil', 'Day of Ashes', 'Mourning of the Empty Stores'],
    election: ['Council Blessing', 'Day of Voices', 'Assembly of the Ancestors', 'Choosing Ceremony'],
    tax_change: ['Tribute Ceremony', 'Day of the Common Good', 'Sharing Rite', 'Offering Day'],
    founding: ['Founders\' Day', 'First Light Festival', 'Day of Roots', 'Settlement Blessing'],
    death: ['Remembrance of the Fallen', 'Spirit Walk', 'Ancestor Calling', 'Vigil of Lights'],
    surplus: ['Harvest Celebration', 'Festival of Plenty', 'Gratitude Feast', 'Day of Thanks'],
    bankruptcy: ['Lesson of Want', 'Day of Warning', 'Humble Remembrance', 'Austerity Vigil'],
  };

  const pool = names[myth.sourceEventType] || ['Day of Spirits', 'Ancestor Gathering', 'Sacred Remembrance'];
  const prefix = seededPick(prefixes, settlement);
  const name = seededPick(pool, settlement);
  return `${prefix} ${name}`;
}

function performRituals(settlement, tick) {
  const religion = settlement.religion;
  if (!religion) return;

  for (const ritual of religion.rituals) {
    if ((tick - ritual.lastPerformed) >= ritual.period) {
      ritual.lastPerformed = tick;

      recordEvent(settlement.chronicle, tick, 'ritual_performed', [],
        ritual.narrative, { affectsAll: true });

      settlement.events.push({
        tick,
        type: 'ritual_performed',
        text: `RITUAL: ${ritual.name} — ${ritual.narrative}`,
      });

      // Boost satisfaction for believers
      const myth = religion.myths.find(m => m.id === ritual.beliefMythId);
      if (myth) {
        for (const npc of getLiving(settlement)) {
          if (myth.holders.includes(npc.id)) {
            npc.opinions.satisfaction = clamp(npc.opinions.satisfaction + 0.03, -1, 1);
          }
        }
      }
    }
  }
}

// ── Priesthood ──

function detectPriests(settlement, tick) {
  const religion = settlement.religion;
  if (religion.beliefs.length === 0) return;

  const living = getLiving(settlement);
  if (living.length < 5) return;

  const scores = [];
  for (const npc of living) {
    let score = 0;
    score += (npc.genome.assertiveness || 0) * 30;
    score += Math.min(20, Object.keys(npc.relationships).length * 2);

    for (const belief of religion.beliefs) {
      const myth = religion.myths.find(m => m.id === belief.mythId);
      if (myth && myth.holders.includes(npc.id)) score += 10;
    }
    score += npc.memories.length * 1.5;
    scores.push({ npc, score });
  }

  scores.sort((a, b) => b.score - a.score);
  const priestCount = Math.max(1, Math.floor(living.length / 30));
  const newPriests = scores.slice(0, priestCount).map(s => s.npc.id);

  // Announce new priests, set current list
  for (const priestId of newPriests) {
    if (!religion.priests.includes(priestId)) {
      const npc = living.find(n => n.id === priestId);
      if (npc) {
        recordEvent(settlement.chronicle, tick, 'priest_emerged',
          [{ id: npc.id, name: npc.name, role: 'priest' }],
          `${npc.name} has become a keeper of the sacred stories.`,
          { affectedCount: 1 });
        settlement.events.push({
          tick, type: 'priest',
          text: `PRIEST: ${npc.name} has become a keeper of the sacred stories`,
        });
      }
    }
  }

  // Replace priest list entirely (scored fresh each cycle)
  religion.priests = newPriests;

  // Priest bonuses
  for (const priestId of religion.priests) {
    const npc = living.find(n => n.id === priestId);
    if (npc) {
      npc.opinions.satisfaction = clamp(npc.opinions.satisfaction + 0.01, -1, 1);
      npc.opinions.leaderApproval = clamp(npc.opinions.leaderApproval + 0.02, -1, 1);
    }
  }
}

// ── Schism ──

const INCOMPATIBLE_MORALS = [
  ['hubris_punished', 'leaders_necessary'],
  ['outsiders_dangerous', 'unity_saves'],
  ['tradition_neglected', 'tradition_sacred'],
  ['greed_cursed', 'generosity_rewarded'],
  ['hubris_punished', 'tradition_sacred'],
];

function detectSchisms(settlement, tick) {
  const religion = settlement.religion;
  if (religion.beliefs.length < 2) return;

  const living = getLiving(settlement);
  const pop = living.length;
  if (pop === 0) return;

  for (let i = 0; i < religion.beliefs.length; i++) {
    for (let j = i + 1; j < religion.beliefs.length; j++) {
      const a = religion.beliefs[i];
      const b = religion.beliefs[j];

      if (religion.schisms.some(s =>
        (s.beliefA === a.mythId && s.beliefB === b.mythId) ||
        (s.beliefA === b.mythId && s.beliefB === a.mythId)
      )) continue;

      if (!INCOMPATIBLE_MORALS.some(([x, y]) =>
        (a.moral === x && b.moral === y) || (a.moral === y && b.moral === x)
      )) continue;

      const mythA = religion.myths.find(m => m.id === a.mythId);
      const mythB = religion.myths.find(m => m.id === b.mythId);
      if (!mythA || !mythB) continue;

      if (mythA.holders.length / pop >= 0.4 && mythB.holders.length / pop >= 0.4) {
        religion.schisms.push({
          beliefA: a.mythId,
          beliefB: b.mythId,
          formedTick: tick,
          narrativeA: a.narrative,
          narrativeB: b.narrative,
        });

        recordEvent(settlement.chronicle, tick, 'religious_schism', [],
          `A religious schism has divided ${settlement.name}! "${a.narrative}" vs "${b.narrative}"`,
          { affectsAll: true, affectedCount: pop }
        );

        settlement.events.push({
          tick, type: 'schism',
          text: `SCHISM: "${a.narrative}" vs "${b.narrative}" — the settlement is divided!`,
        });
      }
    }
  }
}

// ── Sacred Law Pressure ──

function applySacredLawPressure(settlement) {
  const religion = settlement.religion;
  if (!religion || religion.priests.length === 0) return;

  const living = getLiving(settlement);

  for (const priestId of religion.priests) {
    const priest = living.find(n => n.id === priestId);
    if (!priest) continue;

    for (const belief of religion.beliefs) {
      const myth = religion.myths.find(m => m.id === belief.mythId);
      if (!myth || !myth.holders.includes(priestId)) continue;

      const nearby = living.filter(n =>
        n.id !== priestId &&
        Math.abs(n.position.x - priest.position.x) + Math.abs(n.position.y - priest.position.y) <= 3
      );

      for (const npc of nearby) {
        if (belief.moral === 'greed_cursed' || belief.moral === 'unity_saves') {
          npc.opinions.taxSentiment = clamp(npc.opinions.taxSentiment + 0.005, -1, 1);
        } else if (belief.moral === 'leaders_necessary') {
          npc.opinions.leaderApproval = clamp(npc.opinions.leaderApproval + 0.005, -1, 1);
        } else if (belief.moral === 'hubris_punished') {
          npc.opinions.leaderApproval = clamp(npc.opinions.leaderApproval - 0.003, -1, 1);
        }
      }
    }
  }
}

// ── Main Tick ──

function tickReligion(settlement, tick) {
  if (!settlement.religion) settlement.religion = createReligionState();

  // Full detection every 10 ticks
  if (tick % 10 !== 0) {
    applyBeliefEffects(settlement);
    performRituals(settlement, tick);
    applySacredLawPressure(settlement);
    return;
  }

  // Refresh all myth holders
  const living = getLiving(settlement);
  for (const myth of settlement.religion.myths) {
    refreshHolders(myth, living);
  }

  detectMyths(settlement, tick);
  detectBeliefs(settlement, tick);
  detectRituals(settlement, tick);
  detectPriests(settlement, tick);
  detectSchisms(settlement, tick);
  applyBeliefEffects(settlement);
  performRituals(settlement, tick);
  applySacredLawPressure(settlement);
}

// ── Display ──

function formatBeliefs(settlement) {
  if (!settlement.religion) return 'No religious beliefs have formed yet. The world is young.';
  const religion = settlement.religion;
  const living = getLiving(settlement);
  const pop = living.length;
  const name = settlement.name || 'the settlement';

  const lines = [`═══ BELIEFS & MYTHOLOGY OF ${name.toUpperCase()} ═══`, ''];

  if (religion.myths.length === 0) {
    lines.push('No myths have formed yet. History needs time to distort.');
    lines.push('');
    lines.push(`The people of ${name} have no shared mythology yet.`);
    lines.push('Give it time. History must happen, and memories must distort.');
    return lines.join('\n');
  }

  lines.push(`MYTHS (${religion.myths.length}):`);
  for (const myth of religion.myths) {
    const adoption = pop > 0 ? Math.round(myth.holders.length / pop * 100) : 0;
    lines.push(`  ◆ ${myth.name || 'Unnamed Myth'}`);
    lines.push(`    "${myth.narrative}"`);
    lines.push(`    Origin: ${myth.sourceEventType} (Day ${myth.sourceTick}) | Moral: ${myth.moral}`);
    lines.push(`    Adoption: ${adoption}% (${myth.holders.length}/${pop})`);
    lines.push('');
  }

  if (religion.beliefs.length > 0) {
    lines.push(`BELIEFS (${religion.beliefs.length}):`);
    for (const belief of religion.beliefs) {
      const myth = religion.myths.find(m => m.id === belief.mythId);
      const currentAdoption = myth ? Math.round(myth.holders.length / pop * 100) : 0;
      const age = (settlement.tick || 0) - belief.formedTick;
      lines.push(`  ★ "${belief.narrative}"`);
      lines.push(`    Moral: ${belief.moral} | Adoption: ${currentAdoption}% | Age: ${age > 0 ? age : '?'} days`);
      lines.push('');
    }
  }

  if (religion.rituals.length > 0) {
    lines.push(`RITUALS (${religion.rituals.length}):`);
    for (const ritual of religion.rituals) {
      lines.push(`  🕯️ ${ritual.name}`);
      lines.push(`    ${ritual.narrative}`);
      lines.push(`    Every ${ritual.period} days`);
      lines.push('');
    }
  }

  if (religion.priests.length > 0) {
    lines.push(`PRIESTS (${religion.priests.length}):`);
    for (const priestId of religion.priests) {
      const npc = living.find(n => n.id === priestId);
      if (npc) lines.push(`  🙏 ${npc.name} the ${npc.job}`);
    }
    lines.push('');
  }

  if (religion.schisms.length > 0) {
    lines.push(`SCHISMS (${religion.schisms.length}):`);
    for (const schism of religion.schisms) {
      lines.push(`  ⚡ "${schism.narrativeA}" vs "${schism.narrativeB}"`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

module.exports = {
  createReligionState,
  tickReligion,
  formatBeliefs,
};
