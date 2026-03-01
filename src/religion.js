'use strict';

/**
 * Phase 9: Emergent Religion & Mythology Engine
 * 
 * Upgraded to match the Mythology Engine design doc (2026-03-01).
 * 
 * Features:
 * - 8 distortion operations that transform myth narrative and metadata
 * - Narrative gravity: drama-weighted myth persistence
 * - Competing mythologies: factions develop different versions of the same event
 * - Myth evolution over time: myths distort further each tick
 * - Narrative text generation with prose templates
 * - Belief → ritual → priesthood → schism pipeline
 * - Mythology → behavior feedback loops
 */

const { recordEvent, queryChronicle } = require('./chronicle');

// ══════════════════════════════════════════════════
// DATA STRUCTURES
// ══════════════════════════════════════════════════

function createReligionState() {
  return {
    myths: [],
    beliefs: [],
    rituals: [],
    priests: [],
    schisms: [],
    nextMythId: 1,
  };
}

// ══════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function getLiving(settlement) {
  return settlement.npcs.filter(n => n.alive !== false && !n.isChild);
}

function seededRandom(settlement) {
  return settlement.tickRng ? settlement.tickRng.random() : Math.random();
}

function seededPick(arr, settlement) {
  if (!arr || arr.length === 0) return undefined;
  return arr[Math.floor(seededRandom(settlement) * arr.length)];
}

function weightedPick(items, weights, settlement) {
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) return items[0];
  let r = seededRandom(settlement) * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

// ══════════════════════════════════════════════════
// DISTORTION OPERATIONS (8 of 14)
// ══════════════════════════════════════════════════

/**
 * Each distortion op takes a myth and settlement context,
 * and mutates the myth's narrative text, metadata, and distortion history.
 */

const DISTORTION_OPS = {
  /**
   * 1. ACTOR_SWAP — Wrong person credited/blamed.
   * The actual actor is replaced by someone more prominent.
   */
  ACTOR_SWAP(myth, settlement) {
    const living = getLiving(settlement);
    if (living.length < 3) return false;

    // Find the most prominent NPC (most relationships + memories)
    const candidates = living.slice().sort((a, b) => {
      const scoreA = Object.keys(a.relationships || {}).length + (a.memories || []).length;
      const scoreB = Object.keys(b.relationships || {}).length + (b.memories || []).length;
      return scoreB - scoreA;
    }).slice(0, 3);

    const swapped = seededPick(candidates, settlement);
    if (!swapped) return false;

    const oldActor = myth.actor || 'the people';
    myth.actor = swapped.name;
    myth.actorId = swapped.id;
    myth.distortions.push({ op: 'ACTOR_SWAP', tick: settlement.tick, from: oldActor, to: swapped.name });
    myth.avgFidelity = Math.max(0, myth.avgFidelity - 0.15);

    // Update narrative
    if (myth.narrative.includes(oldActor)) {
      myth.narrative = myth.narrative.replace(oldActor, swapped.name);
    } else {
      myth.narrative = myth.narrative.replace(/^/, `${swapped.name} was there when `);
    }
    return true;
  },

  /**
   * 2. HERO_INSERTION — A nobody becomes the protagonist.
   */
  HERO_INSERTION(myth, settlement) {
    const living = getLiving(settlement);
    if (living.length < 2) return false;

    // Pick the most locally famous NPC
    const scored = living.map(n => ({
      npc: n,
      score: (Object.keys(n.relationships || {}).length * 2) + 
             (n.memories || []).length +
             ((n.genome || {}).assertiveness || 0) * 20,
    })).sort((a, b) => b.score - a.score);

    const hero = scored[0].npc;
    const epithet = seededPick(EPITHETS, settlement);

    myth.hero = { name: hero.name, id: hero.id, epithet };
    myth.distortions.push({ op: 'HERO_INSERTION', tick: settlement.tick, hero: hero.name });
    myth.distortedMagnitude = (myth.distortedMagnitude || 0) + 20;
    myth.avgFidelity = Math.max(0, myth.avgFidelity - 0.12);

    // Rewrite narrative with hero
    myth.narrative += ` It was ${hero.name} ${epithet} who stood against the darkness.`;
    return true;
  },

  /**
   * 3. MAGNITUDE_EXAGGERATION — Numbers inflate multiplicatively.
   */
  MAGNITUDE_EXAGGERATION(myth, settlement) {
    const multiplier = 1.3 + seededRandom(settlement) * 0.7; // 1.3x to 2.0x
    const current = myth.distortedMagnitude || 1;

    if (current === 0) {
      myth.distortedMagnitude = Math.round((seededRandom(settlement) > 0.5 ? 1 : -1) * (10 + seededRandom(settlement) * 20));
    } else {
      myth.distortedMagnitude = Math.round(clamp(current * multiplier, -128, 127));
    }

    myth.distortions.push({ op: 'MAGNITUDE_EXAGGERATION', tick: settlement.tick, multiplier: multiplier.toFixed(2) });
    myth.avgFidelity = Math.max(0, myth.avgFidelity - 0.08);

    // Amplify narrative language
    const intensifiers = [
      'a thousand souls witnessed', 'the very earth shook', 'none had ever seen the like',
      'it was beyond reckoning', 'the devastation was absolute',
    ];
    myth.narrative += ` ${seededPick(intensifiers, settlement)}.`;
    return true;
  },

  /**
   * 4. CAUSE_SUBSTITUTION — Natural/human cause → supernatural explanation.
   */
  CAUSE_SUBSTITUTION(myth, settlement) {
    const causes = [
      { cause: 'spirit_anger', text: 'The spirits were displeased' },
      { cause: 'ancestor_warning', text: 'The ancestors sent a warning' },
      { cause: 'sacred_violation', text: 'Someone defiled the sacred ground' },
      { cause: 'divine_test', text: 'The gods tested the worthy' },
      { cause: 'cosmic_cycle', text: 'The world renews itself every age' },
    ];
    const picked = seededPick(causes, settlement);

    myth.supernaturalCause = picked.cause;
    myth.tags = myth.tags || [];
    if (!myth.tags.includes('SUPERNATURAL')) myth.tags.push('SUPERNATURAL');
    myth.distortions.push({ op: 'CAUSE_SUBSTITUTION', tick: settlement.tick, cause: picked.cause });
    myth.avgFidelity = Math.max(0, myth.avgFidelity - 0.2);

    myth.narrative = myth.narrative.replace(
      /because [^.]+\./i,
      `because ${picked.text.toLowerCase()}.`
    );
    if (!myth.narrative.toLowerCase().includes(picked.text.toLowerCase())) {
      myth.narrative += ` ${picked.text}.`;
    }
    return true;
  },

  /**
   * 5. CAUSE_MORALIZATION — Accident → moral punishment.
   */
  CAUSE_MORALIZATION(myth, settlement) {
    if (myth.distortedValence > -0.1) return false; // only negative events

    const morals = [
      { moral: 'hubris_punished', text: 'The people had grown too proud' },
      { moral: 'greed_cursed', text: 'Greed had poisoned the settlement' },
      { moral: 'outsiders_dangerous', text: 'The strangers brought misfortune' },
      { moral: 'neglect_punished', text: 'They forgot the old ways' },
      { moral: 'betrayal_punished', text: 'Treachery always returns to the treacherous' },
    ];
    const picked = seededPick(morals, settlement);

    myth.moral = picked.moral;
    myth.tags = myth.tags || [];
    if (!myth.tags.includes('MORALIZED')) myth.tags.push('MORALIZED');
    myth.distortions.push({ op: 'CAUSE_MORALIZATION', tick: settlement.tick, moral: picked.moral });
    myth.distortedValence = Math.max(-1, myth.distortedValence - 0.15);
    myth.avgFidelity = Math.max(0, myth.avgFidelity - 0.15);

    myth.narrative += ` ${picked.text}, and so the suffering came.`;
    return true;
  },

  /**
   * 6. TEMPORAL_COMPRESSION — Two events merge into one.
   */
  TEMPORAL_COMPRESSION(myth, settlement) {
    const religion = settlement.religion;
    // Find another myth of similar type from a nearby era
    const candidates = religion.myths.filter(m =>
      m.id !== myth.id &&
      m.sourceEventType === myth.sourceEventType &&
      Math.abs(m.sourceTick - myth.sourceTick) < 100 &&
      Math.abs(m.sourceTick - myth.sourceTick) > 5
    );
    if (candidates.length === 0) return false;

    const absorbed = seededPick(candidates, settlement);
    myth.distortedMagnitude = (myth.distortedMagnitude || 0) + (absorbed.distortedMagnitude || 0);
    myth.distortions.push({ op: 'TEMPORAL_COMPRESSION', tick: settlement.tick, absorbed: absorbed.name });
    myth.avgFidelity = Math.max(0, myth.avgFidelity - 0.25);

    // Absorb the other myth's holders
    for (const h of absorbed.holders) {
      if (!myth.holders.includes(h)) myth.holders.push(h);
    }

    myth.narrative += ` The elders say this happened alongside ${absorbed.name}, but truly it was all one great calamity.`;

    // Mark absorbed myth for removal
    absorbed._absorbed = true;
    return true;
  },

  /**
   * 7. MORAL_SIMPLIFICATION — Complex situation → good vs evil.
   */
  MORAL_SIMPLIFICATION(myth, settlement) {
    myth.tags = myth.tags || [];
    if (myth.tags.includes('MORALIZED')) return false;

    // Push valence to extremes
    if (myth.distortedValence > 0) {
      myth.distortedValence = Math.min(1, myth.distortedValence + 0.3);
    } else {
      myth.distortedValence = Math.max(-1, myth.distortedValence - 0.3);
    }

    myth.tags.push('MORALIZED');
    myth.distortions.push({ op: 'MORAL_SIMPLIFICATION', tick: settlement.tick });
    myth.avgFidelity = Math.max(0, myth.avgFidelity - 0.2);

    // Add good/evil framing
    const framings = [
      'What was complex became simple: there were those who served the people, and those who served themselves.',
      'The truth became clear — it was a battle between the righteous and the wicked.',
      'In the retelling, the shades of gray burned away, leaving only light and shadow.',
    ];
    myth.narrative += ` ${seededPick(framings, settlement)}`;
    return true;
  },

  /**
   * 8. EMOTIONAL_AMPLIFICATION — Neutral event gains dramatic emotional coloring.
   */
  EMOTIONAL_AMPLIFICATION(myth, settlement) {
    const direction = myth.distortedValence >= 0 ? 1 : -1;
    const boost = (0.15 + seededRandom(settlement) * 0.25) * direction;
    myth.distortedValence = clamp(myth.distortedValence + boost, -1, 1);

    myth.distortions.push({ op: 'EMOTIONAL_AMPLIFICATION', tick: settlement.tick, boost: boost.toFixed(2) });
    myth.avgFidelity = Math.max(0, myth.avgFidelity - 0.08);

    const amplifiers = direction > 0
      ? ['Joy filled the hearts of all who heard.', 'The people wept with gratitude.', 'It was the happiest day anyone could remember.']
      : ['Sorrow consumed the settlement.', 'The mourning lasted a generation.', 'None who lived through it were ever the same.'];
    myth.narrative += ` ${seededPick(amplifiers, settlement)}`;
    return true;
  },
};

const EPITHETS = [
  'the Brave', 'the Wise', 'the Unyielding', 'River-Born', 'Stone-Heart',
  'the Just', 'the Feared', 'the Merciful', 'Wall-Breaker', 'Storm-Caller',
  'the Cunning', 'Night-Walker', 'the Scarred', 'the Silent', 'Fire-Touched',
];

// Distortion probability table (base rates, scaled by accuracy factor)
const DISTORTION_PROBS = [
  { op: 'MAGNITUDE_EXAGGERATION', base: 0.25 },
  { op: 'EMOTIONAL_AMPLIFICATION', base: 0.18 },
  { op: 'ACTOR_SWAP', base: 0.15 },
  { op: 'MORAL_SIMPLIFICATION', base: 0.12 },
  { op: 'CAUSE_MORALIZATION', base: 0.10 },
  { op: 'HERO_INSERTION', base: 0.10 },
  { op: 'CAUSE_SUBSTITUTION', base: 0.08 },
  { op: 'TEMPORAL_COMPRESSION', base: 0.07 },
];

// Chain reactions: distortion A can trigger distortion B
const DISTORTION_CHAINS = {
  HERO_INSERTION: [{ op: 'MAGNITUDE_EXAGGERATION', prob: 0.30 }],
  CAUSE_SUBSTITUTION: [{ op: 'EMOTIONAL_AMPLIFICATION', prob: 0.25 }],
  MAGNITUDE_EXAGGERATION: [{ op: 'TEMPORAL_COMPRESSION', prob: 0.15 }],
  MORAL_SIMPLIFICATION: [{ op: 'EMOTIONAL_AMPLIFICATION', prob: 0.35 }],
  CAUSE_MORALIZATION: [{ op: 'MORAL_SIMPLIFICATION', prob: 0.20 }],
  ACTOR_SWAP: [{ op: 'HERO_INSERTION', prob: 0.10 }],
};

// ══════════════════════════════════════════════════
// NARRATIVE GRAVITY
// ══════════════════════════════════════════════════

/**
 * Computes how "sticky" a myth is — higher gravity = resists forgetting,
 * attracts more distortion, spreads faster.
 */
function computeNarrativeGravity(myth, settlement) {
  let score = 0;

  // Drama factors by event type
  const DRAMA = {
    death: 25, crisis: 30, raid: 30, coup: 35, plague: 35,
    founding: 35, fire: 25, flood: 25, drought: 20, harsh_winter: 20,
    bankruptcy: 15, election: 5, tax_change: 5, surplus: 10,
    marriage: 10, discovery: 15, winter_death: 20, food_shortage: 20,
    prophet: 25, famine: 30, bountiful_year: 10,
  };
  score += DRAMA[myth.sourceEventType] || 5;

  // Emotional extremity
  score += Math.abs(myth.distortedValence) * 30;

  // Supernatural bonus
  if (myth.tags && myth.tags.includes('SUPERNATURAL')) score += 20;

  // Hero presence
  if (myth.hero) score += 15;

  // Distortion count (more distorted = more memorable paradoxically)
  score += Math.min(20, (myth.distortions || []).length * 4);

  // Holder count (social proof)
  const living = getLiving(settlement);
  if (living.length > 0) {
    score += (myth.holders.length / living.length) * 15;
  }

  // Boringness penalty for routine events
  if (['election', 'tax_change', 'surplus'].includes(myth.sourceEventType) &&
      Math.abs(myth.distortedValence) < 0.3) {
    score -= 20;
  }

  // Age bonus (recent myths slightly stickier)
  const age = (settlement.tick || 0) - myth.sourceTick;
  score += Math.max(0, 20 - age * 0.05);

  return Math.max(0, score);
}

// ══════════════════════════════════════════════════
// MYTH EVOLUTION (distortion over time)
// ══════════════════════════════════════════════════

/**
 * Each tick (when called), myths with enough believers get a chance to distort further.
 * After ~200 ticks, the original event should be unrecognizable.
 */
function evolveMythsOverTime(settlement, tick) {
  const religion = settlement.religion;
  const living = getLiving(settlement);
  if (living.length === 0) return;

  for (const myth of religion.myths) {
    if (myth._absorbed) continue;

    // Only myths with some adoption can evolve (they need retellers)
    const adoption = myth.holders.length / Math.max(1, living.length);
    if (adoption < 0.15) continue;

    // Accuracy factor: lower fidelity = more susceptible to distortion
    const accuracyFactor = 1.0 - myth.avgFidelity;
    if (accuracyFactor < 0.05) continue; // still too fresh

    // Narrative gravity affects distortion: high-gravity myths attract MORE distortion
    const gravity = computeNarrativeGravity(myth, settlement);
    const gravityBonus = gravity > 60 ? 1 : 0;

    // Distortion budget: how many ops can fire this tick
    const budget = Math.min(3, Math.floor(accuracyFactor * 3) + gravityBonus);
    if (budget <= 0) continue;

    // Shuffle distortion table and try to apply
    const shuffled = DISTORTION_PROBS.slice().sort(() => seededRandom(settlement) - 0.5);
    let applied = 0;

    for (const { op, base } of shuffled) {
      if (applied >= budget) break;
      const prob = base * accuracyFactor * 0.3; // scale down per-tick (this runs every 10 ticks)
      if (seededRandom(settlement) < prob) {
        const fn = DISTORTION_OPS[op];
        if (fn && fn(myth, settlement)) {
          applied++;

          // Check chain reactions
          const chains = DISTORTION_CHAINS[op] || [];
          for (const chain of chains) {
            if (applied >= budget) break;
            if (seededRandom(settlement) < chain.prob * 0.5) {
              const chainFn = DISTORTION_OPS[chain.op];
              if (chainFn && chainFn(myth, settlement)) {
                applied++;
              }
            }
          }
        }
      }
    }
  }

  // Remove absorbed myths
  religion.myths = religion.myths.filter(m => !m._absorbed);
}

// ══════════════════════════════════════════════════
// COMPETING MYTHOLOGIES
// ══════════════════════════════════════════════════

/**
 * Factions develop different versions of the same event.
 * When a myth forms, check if different factions should remember it differently.
 */
function spawnCompetingVersions(myth, settlement, tick) {
  const living = getLiving(settlement);
  if (living.length < 8) return; // need enough people for factions

  // Detect rough factions by tax sentiment (mirrors politics.js)
  const antiTax = living.filter(n => n.opinions.taxSentiment < -0.15);
  const proTax = living.filter(n => n.opinions.taxSentiment > 0.15);

  if (antiTax.length < 3 || proTax.length < 3) return;
  
  // Only spawn competing version for dramatic negative events
  if (myth.distortedValence > -0.15) return;

  const religion = settlement.religion;

  // Check if competing version already exists
  if (religion.myths.some(m =>
    m.sourceEventType === myth.sourceEventType &&
    Math.abs(m.sourceTick - myth.sourceTick) < 5 &&
    m.factionVersion && m.factionVersion !== myth.factionVersion
  )) return;

  // Mark original myth with faction
  myth.factionVersion = 'Shields'; // pro-tax faction holds original
  myth.holders = proTax.map(n => n.id);

  // Create competing version for anti-tax faction
  const competingMorals = {
    hubris_punished: 'leaders_corrupt',
    greed_cursed: 'neglect_punished',
    outsiders_dangerous: 'leaders_corrupt',
    neglect_punished: 'greed_cursed',
    leaders_corrupt: 'hubris_punished',
    balance_required: 'tradition_neglected',
  };

  const competingNarratives = {
    crisis: [
      'The crisis came because the leaders hoarded while the workers starved',
      'Weak leadership let the rot spread until the people had nothing',
      'The rulers cared more for their position than for their people',
    ],
    drought: [
      'The leaders knew the drought was coming but did nothing to prepare',
      'While the earth dried, the council debated and the people suffered',
    ],
    raid: [
      'The settlement was defenseless because the leaders spent the treasury on vanity',
      'The raiders came because our leaders showed weakness to the world',
    ],
    plague: [
      'The sickness spread because the rulers quarantined the poor and protected the rich',
      'Leadership failed — the plague was manageable but they panicked',
    ],
    bankruptcy: [
      'The treasury emptied because those in power took more than their share',
      'Ruin came from above, not from below — the leaders bankrupted the people',
    ],
    food_shortage: [
      'There was food enough, but it was distributed by those who favored their own',
      'The shortage was manufactured by those who profited from hunger',
    ],
    famine: [
      'The famine was no act of spirits — it was the price of incompetent leadership',
      'The granaries were full in the leaders\' quarter. It was only the workers who starved',
    ],
  };

  const narrativePool = competingNarratives[myth.sourceEventType] || [
    'The suffering came not from the spirits but from those who claimed to lead',
    'The people say it was fate. The workers know it was failure from above',
  ];

  const competing = {
    id: religion.nextMythId++,
    name: `${myth.name} (The Workers' Version)`,
    sourceEventId: myth.sourceEventId,
    sourceEventType: myth.sourceEventType,
    sourceTick: myth.sourceTick,
    formedTick: tick,
    narrative: seededPick(narrativePool, settlement),
    originalOutcome: myth.originalOutcome,
    distortedValue: myth.distortedValue,
    distortedValence: myth.distortedValence - 0.1,
    distortedMagnitude: myth.distortedMagnitude || 0,
    avgFidelity: myth.avgFidelity,
    holders: antiTax.map(n => n.id),
    moral: competingMorals[myth.moral] || 'leaders_corrupt',
    behaviorEffect: { taxSentiment: -0.1, leaderApproval: -0.08 },
    hero: null,
    actor: null,
    tags: [],
    distortions: [{ op: 'FACTION_DIVERGENCE', tick, from: myth.factionVersion }],
    factionVersion: 'Tillers',
  };

  religion.myths.push(competing);

  settlement.events.push({
    tick,
    type: 'competing_myth',
    text: `COMPETING MYTH: The Tillers remember "${myth.name}" differently: "${competing.narrative}"`,
  });

  if (settlement.chronicle) {
    recordEvent(settlement.chronicle, tick, 'mythology_diverged', [],
      `The Tillers and Shields now tell different versions of "${myth.name}"`,
      { affectsAll: true }
    );
  }
}

// ══════════════════════════════════════════════════
// NARRATIVE TEXT GENERATION (prose templates)
// ══════════════════════════════════════════════════

const TALE_OPENINGS = {
  ancient: [
    'In the time before the counting of years,',
    'When the world was young and the river had no name,',
    'Before the first stone was laid upon stone,',
    'In the age when spirits walked among the people,',
  ],
  old: [
    'In the days of our grandmothers\' grandmothers,',
    'Long ago, when the settlement was but a circle of huts,',
    'They say that once, many lifetimes past,',
    'In the days when the old ways still held,',
  ],
  recent: [
    'Not so long ago, as the elders reckon,',
    'In a time still remembered by the oldest among us,',
    'It is told that in recent days,',
  ],
};

const TALE_CONFLICTS = {
  crisis: [
    'a great hunger fell upon the land. The stores emptied and the people knew want.',
    'hardship came without warning. The settlement teetered on the edge of ruin.',
  ],
  death: [
    'a great soul was called home to the river. The light dimmed and the people grieved.',
    'death came for one of the beloved, and the settlement was changed forever.',
  ],
  raid: [
    'outsiders came with violence in their hearts. The people stood between life and destruction.',
    'warriors from beyond the hills fell upon the settlement like a storm.',
  ],
  drought: [
    'the sky sealed itself and the rain refused to fall. The earth cracked and the wells went dry.',
    'a terrible thirst gripped the land. The rivers shrank to trickles.',
  ],
  plague: [
    'a sickness crept through the settlement, taking the strong and the weak alike.',
    'the dark plague spread from house to house. None were spared its touch.',
  ],
  flood: [
    'the waters rose beyond all reckoning, swallowing fields and homes.',
    'the river broke its banks and consumed everything in its path.',
  ],
  fire: [
    'flames leapt from house to house until the night sky turned orange.',
    'a great fire consumed what generations had built.',
  ],
  founding: [
    'the first people came to this place and planted roots in the earth.',
    'the founders laid the first stones and spoke the first laws.',
  ],
  coup: [
    'the old power was broken and new hands seized the reins.',
    'leadership changed in a single terrible night.',
  ],
  election: [
    'the people gathered to choose who would speak for them.',
    'voices rose and fell as the settlement decided its future.',
  ],
};

const TALE_RESOLUTIONS = {
  heroic: [
    'And {hero} stood firm, and the people were saved.',
    'By courage alone, {hero} drove back the darkness.',
    'And so {hero} did what none thought possible, and the settlement endured.',
  ],
  sacrifice: [
    'And {hero} gave everything so that others might live.',
    'The price was {hero}\'s own life. It was paid willingly.',
  ],
  mystery: [
    'What became of it all, none can say. But the memory remains.',
    'And then it passed, as all things pass. But the story endures.',
  ],
  survival: [
    'And the people endured, as they always do. Scarred, but unbroken.',
    'They survived, though the scars would last for generations.',
  ],
};

const TALE_MORALS = {
  hubris_punished: ['And so the people learned: pride devours its host.', 'Remember this, and be humble.'],
  greed_cursed: ['This is why we share what we have.', 'Greed eats itself — this is known.'],
  outsiders_dangerous: ['This is why we watch the roads.', 'Trust is earned, not given to strangers.'],
  unity_saves: ['Alone we fall. Together we endure.', 'No wall stands that one person builds alone.'],
  leaders_necessary: ['Without the strong to guide, all are lost.', 'This is why we choose well.'],
  tradition_neglected: ['The old ways exist for a reason.', 'Forget the past and it will repeat.'],
  neglect_punished: ['Those who fail to act invite the suffering.', 'Inaction is its own kind of sin.'],
  leaders_corrupt: ['Power corrupts — this the people have always known.', 'Those who lead must be watched.'],
  betrayal_punished: ['Treachery always returns to the treacherous.', 'Remember this when you are tempted.'],
  balance_required: ['All things in measure. Excess invites ruin.', 'The wise seek balance.'],
  tradition_sacred: ['Honor the old ways, for they have kept us alive.'],
  generosity_rewarded: ['Give freely, and the world provides.'],
};

const TALE_CLOSINGS = [
  'This is known.',
  'So it was. So it is remembered.',
  'Ask the elders. They will tell you the same — though not always in the same way.',
  'Whether it happened so, who can say? But the story endures.',
  'So it was told to me, and so I tell it to you.',
];

/**
 * Generate full prose narrative for a myth using templates.
 */
function generateFullNarrative(myth, settlement) {
  const age = (settlement.tick || 0) - myth.sourceTick;
  const parts = [];

  // Opening
  let openingPool;
  if (age > 300) openingPool = TALE_OPENINGS.ancient;
  else if (age > 100) openingPool = TALE_OPENINGS.old;
  else openingPool = TALE_OPENINGS.recent;
  parts.push(seededPick(openingPool, settlement));

  // Conflict
  const conflictPool = TALE_CONFLICTS[myth.sourceEventType] || [
    'something beyond understanding changed the course of the settlement.',
  ];
  parts.push(seededPick(conflictPool, settlement));

  // Supernatural element
  if (myth.supernaturalCause) {
    const supTexts = [
      'The spirits moved in ways the living could not see.',
      'The ancestors spoke, though none could understand their words.',
      'Something beyond the mortal world stirred.',
    ];
    parts.push(seededPick(supTexts, settlement));
  }

  // Resolution
  if (myth.hero) {
    const pool = seededRandom(settlement) > 0.3
      ? TALE_RESOLUTIONS.heroic
      : TALE_RESOLUTIONS.sacrifice;
    parts.push(seededPick(pool, settlement).replace(/\{hero\}/g, `${myth.hero.name} ${myth.hero.epithet || ''}`).trim());
  } else {
    const pool = myth.distortedValence >= 0 ? TALE_RESOLUTIONS.survival : TALE_RESOLUTIONS.mystery;
    parts.push(seededPick(pool, settlement));
  }

  // Moral
  if (myth.moral) {
    const moralPool = TALE_MORALS[myth.moral] || ['And the people remembered.'];
    parts.push(seededPick(moralPool, settlement));
  }

  // Closing
  parts.push(seededPick(TALE_CLOSINGS, settlement));

  return parts.join(' ');
}

// ══════════════════════════════════════════════════
// MYTH DETECTION
// ══════════════════════════════════════════════════

function detectMyths(settlement, tick) {
  const religion = settlement.religion;
  const living = getLiving(settlement);
  if (living.length === 0 || !settlement.chronicle) return;

  const oldEvents = queryChronicle(settlement.chronicle, {
    minSignificance: 60,
  }).filter(e => (tick - e.tick) >= 50);

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
    const eventEra = Math.floor(event.tick / 50);
    if (religion.myths.some(m =>
      m.sourceEventType === event.eventType &&
      Math.floor(m.sourceTick / 50) === eventEra
    )) continue;

    const mythsOfType = religion.myths.filter(m => m.sourceEventType === event.eventType);
    if (mythsOfType.length >= 3) continue;

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

    const mythName = generateMythName(event.eventType, avgFidelity, avgValence, settlement);
    const moral = deriveMoral(event.eventType, avgValence, settlement);

    const myth = {
      id: religion.nextMythId++,
      name: mythName,
      sourceEventId: event.id,
      sourceEventType: event.eventType,
      sourceTick: event.tick,
      formedTick: tick,
      narrative: '', // will be generated below
      originalOutcome: event.outcome,
      distortedValue: avgValue,
      distortedValence: avgValence,
      distortedMagnitude: 0,
      avgFidelity,
      holders: memoriesOfEvent.map(m => m.npcId),
      moral,
      behaviorEffect: deriveBehaviorEffect(event.eventType, avgValence),
      hero: null,
      actor: null,
      tags: [],
      distortions: [],
      factionVersion: null,
    };

    // Generate prose narrative
    myth.narrative = generateFullNarrative(myth, settlement);

    religion.myths.push(myth);

    // Spawn competing faction version for dramatic events
    spawnCompetingVersions(myth, settlement, tick);

    recordEvent(settlement.chronicle, tick, 'myth_formed', [],
      `A myth has formed: "${mythName}" — ${myth.narrative.slice(0, 120)}...`,
      { affectsAll: true, affectedCount: memoriesOfEvent.length }
    );

    settlement.events.push({
      tick,
      type: 'myth',
      text: `MYTH FORMED: "${mythName}" — ${myth.narrative.slice(0, 200)}`,
    });
  }
}

// ══════════════════════════════════════════════════
// DRAMATIC EVENT-DRIVEN MYTHS
// ══════════════════════════════════════════════════

const DRAMATIC_EVENT_TYPES = new Set([
  'drought', 'harsh_winter', 'plague', 'flood', 'fire', 'raid',
  'coup', 'prophet', 'winter_death', 'discovery', 'bountiful_year',
  'famine', 'food_shortage',
]);

function detectDramaticMyths(settlement, tick) {
  const religion = settlement.religion;
  const living = getLiving(settlement);
  if (living.length === 0) return;

  const memoryCounts = {};
  for (const npc of living) {
    for (const mem of npc.memories) {
      if (!DRAMATIC_EVENT_TYPES.has(mem.eventType)) continue;
      if (mem.fidelity < 0.3) continue;
      const key = `${mem.eventType}:${Math.floor(mem.tick / 25)}`;
      if (!memoryCounts[key]) {
        memoryCounts[key] = { eventType: mem.eventType, tick: mem.tick, count: 0, totalValence: 0 };
      }
      memoryCounts[key].count++;
      memoryCounts[key].totalValence += mem.valence;
    }
  }

  for (const [key, data] of Object.entries(memoryCounts)) {
    if (data.count < Math.floor(living.length * 0.4)) continue;

    const era = key.split(':')[1];
    if (religion.myths.some(m =>
      m.sourceEventType === data.eventType &&
      Math.floor(m.sourceTick / 25) === parseInt(era)
    )) continue;

    // Cap total myths
    if (religion.myths.length >= 15) {
      const weakest = religion.myths.reduce((a, b) => {
        const ga = computeNarrativeGravity(a, settlement);
        const gb = computeNarrativeGravity(b, settlement);
        return ga < gb ? a : b;
      });
      const idx = religion.myths.indexOf(weakest);
      religion.myths.splice(idx, 1);
    }

    const avgValence = data.totalValence / data.count;
    const mythName = generateMythName(data.eventType, 0.5, avgValence, settlement);
    const moral = deriveMoral(data.eventType, avgValence, settlement);

    const myth = {
      id: religion.nextMythId++,
      name: mythName,
      sourceEventId: -1,
      sourceEventType: data.eventType,
      sourceTick: data.tick,
      formedTick: tick,
      narrative: '',
      originalOutcome: '',
      distortedValue: 0,
      distortedValence: avgValence,
      distortedMagnitude: 0,
      avgFidelity: 0.5,
      holders: living.map(n => n.id),
      moral,
      behaviorEffect: deriveBehaviorEffect(data.eventType, avgValence),
      hero: null,
      actor: null,
      tags: [],
      distortions: [],
      factionVersion: null,
    };

    myth.narrative = generateFullNarrative(myth, settlement);

    religion.myths.push(myth);

    // Spawn competing version
    spawnCompetingVersions(myth, settlement, tick);

    settlement.events.push({
      tick, type: 'myth',
      text: `MYTH FORMED: "${mythName}" — ${myth.narrative.slice(0, 200)}`,
    });

    if (settlement.chronicle) {
      recordEvent(settlement.chronicle, tick, 'myth_formed', [],
        `A new myth: "${mythName}" — ${myth.narrative.slice(0, 120)}...`,
        { affectsAll: true }
      );
    }
  }
}

// ══════════════════════════════════════════════════
// MYTH NAME GENERATION
// ══════════════════════════════════════════════════

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
    drought: ['The Thirsty Earth', 'The Dry Season', 'The Withering', 'The Parched Days'],
    harsh_winter: ['The Great Freeze', 'The Ice That Spoke', 'The Bitter Cold', 'The White Death'],
    plague: ['The Sickness', 'The Shadow Plague', 'The Great Dying', 'The Dark Days'],
    flood: ['The Rising Waters', 'The River\'s Wrath', 'The Great Deluge', 'The Drowning'],
    raid: ['The Day of Swords', 'The Blood Tax', 'The Outsiders\' Fury', 'The Burning Night'],
    fire: ['The Great Burning', 'The Night of Flames', 'The Red Hour'],
    prophet: ['The Voice', 'The Awakening', 'The Revelation', 'The Dividing Word'],
    winter_death: ['The Cold Harvest', 'The Ice\'s Claim', 'Winter\'s Price'],
    discovery: ['The Gift Below', 'The Earth\'s Blessing', 'The Lucky Strike'],
    bountiful_year: ['The Year of Plenty', 'The Great Abundance', 'The Blessed Season'],
    food_shortage: ['The Empty Bellies', 'The Wanting', 'The Lean Time'],
    coup: ['The Overthrow', 'The Breaking of Power', 'The Night of Daggers'],
    traders: ['The Coming of Strangers', 'The Day of Trade', 'The Foreign Wind'],
    famine: ['The Great Famine', 'The Starving Time', 'The Year of Empty Hands'],
  };

  const pool = nameTemplates[eventType] || [
    'The Strange Happening', 'The Omen', 'The Sign', 'The Turning',
  ];

  return seededPick(pool, settlement);
}

// ══════════════════════════════════════════════════
// MORAL & BEHAVIOR DERIVATION
// ══════════════════════════════════════════════════

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
  if (eventType === 'crisis' || eventType === 'bankruptcy' || eventType === 'famine' || eventType === 'food_shortage') {
    effects.taxSentiment = valence < 0 ? 0.1 : -0.05;
    effects.satisfaction = -0.05;
  } else if (eventType === 'election' || eventType === 'coup') {
    effects.leaderApproval = valence > 0 ? 0.05 : -0.08;
  } else if (eventType === 'surplus' || eventType === 'bountiful_year') {
    effects.satisfaction = 0.03;
    effects.taxSentiment = 0.05;
  } else if (eventType === 'tax_change') {
    effects.taxSentiment = valence < 0 ? -0.1 : 0.05;
  } else if (eventType === 'raid' || eventType === 'fire' || eventType === 'flood') {
    effects.satisfaction = -0.03;
    effects.leaderApproval = valence < -0.3 ? -0.05 : 0;
  }
  return effects;
}

// ══════════════════════════════════════════════════
// BELIEF DETECTION
// ══════════════════════════════════════════════════

function refreshHolders(myth, living) {
  myth.holders = [];
  for (const npc of living) {
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
    if (myth.holders.length >= threshold) {
      const belief = {
        mythId: myth.id,
        formedTick: tick,
        narrative: myth.narrative.slice(0, 200),
        moral: myth.moral,
        behaviorEffect: myth.behaviorEffect,
        adoptionRate: myth.holders.length / living.length,
      };

      religion.beliefs.push(belief);

      recordEvent(settlement.chronicle, tick, 'belief_formed', [],
        `A belief has taken hold: "${myth.name}" (${Math.round(belief.adoptionRate * 100)}% adoption)`,
        { affectsAll: true, affectedCount: myth.holders.length }
      );

      settlement.events.push({
        tick, type: 'belief',
        text: `BELIEF FORMED: "${myth.name}" — Moral: ${myth.moral} (${Math.round(belief.adoptionRate * 100)}% adoption)`,
      });
    }
  }
}

// ══════════════════════════════════════════════════
// BELIEF EFFECTS (mythology → behavior feedback)
// ══════════════════════════════════════════════════

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

      // Base belief effects
      if (effect.taxSentiment)
        npc.opinions.taxSentiment = clamp(npc.opinions.taxSentiment + effect.taxSentiment * 0.01, -1, 1);
      if (effect.leaderApproval)
        npc.opinions.leaderApproval = clamp(npc.opinions.leaderApproval + effect.leaderApproval * 0.01, -1, 1);
      if (effect.satisfaction)
        npc.opinions.satisfaction = clamp(npc.opinions.satisfaction + effect.satisfaction * 0.01, -1, 1);

      // Mythology→behavior feedback from moral type
      const moralEffects = MORAL_BEHAVIOR_MAP[myth.moral];
      if (moralEffects) {
        for (const [key, val] of Object.entries(moralEffects)) {
          if (npc.opinions[key] !== undefined) {
            npc.opinions[key] = clamp(npc.opinions[key] + val * 0.005, -1, 1);
          }
        }
      }
    }
  }
}

/**
 * Moral → NPC opinion pressure mapping.
 * This is the feedback loop: myths shape politics which creates events which become myths.
 */
const MORAL_BEHAVIOR_MAP = {
  hubris_punished: { leaderApproval: -0.02, satisfaction: -0.01 },
  greed_cursed: { taxSentiment: 0.02 }, // anti-greed = pro-sharing = pro-tax
  outsiders_dangerous: { satisfaction: -0.01 },
  unity_saves: { taxSentiment: 0.02, satisfaction: 0.01 },
  leaders_necessary: { leaderApproval: 0.03 },
  tradition_neglected: { satisfaction: -0.01 },
  leaders_corrupt: { leaderApproval: -0.03, taxSentiment: -0.02 },
  neglect_punished: { leaderApproval: -0.01 },
  tradition_sacred: { satisfaction: 0.01 },
  generosity_rewarded: { taxSentiment: 0.01, satisfaction: 0.01 },
  betrayal_punished: { leaderApproval: -0.01 },
  balance_required: {},
};

// ══════════════════════════════════════════════════
// RITUALS
// ══════════════════════════════════════════════════

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
      narrative: `The citizens gather for the ${ritualName}, remembering: "${myth.name}"`,
    };

    religion.rituals.push(ritual);

    recordEvent(settlement.chronicle, tick, 'ritual_formed', [],
      `A ritual has emerged: "${ritualName}" — ${ritual.narrative}`,
      { affectsAll: true }
    );

    settlement.events.push({
      tick, type: 'ritual',
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
    drought: ['Rain Calling', 'The Dry Vigil', 'Water Remembrance'],
    plague: ['The Healing Rite', 'Day of the Departed', 'Purification'],
    raid: ['Shield Day', 'Vigil of the Watch', 'Remembrance of Blood'],
    flood: ['The Water Blessing', 'Day of the Rising', 'River Appeasement'],
    fire: ['The Flame Vigil', 'Night of Remembrance', 'Ash Day'],
    famine: ['The Empty Bowl Rite', 'Day of Hunger', 'Fasting Vigil'],
    food_shortage: ['The Lean Feast', 'Day of Rationing'],
    coup: ['Day of the Turning', 'Power Remembrance'],
  };

  const pool = names[myth.sourceEventType] || ['Day of Spirits', 'Ancestor Gathering', 'Sacred Remembrance'];
  const prefix = seededPick(prefixes, settlement);
  const name = seededPick(pool, settlement);
  // Avoid "The Sacred The Dry Vigil" — strip leading "The " from name if prefix ends with article
  const cleanName = name.startsWith('The ') ? name.slice(4) : name;
  return `${prefix} ${cleanName}`;
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
        tick, type: 'ritual_performed',
        text: `RITUAL: ${ritual.name} — ${ritual.narrative}`,
      });

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

// ══════════════════════════════════════════════════
// PRIESTHOOD
// ══════════════════════════════════════════════════

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

  religion.priests = newPriests;

  for (const priestId of religion.priests) {
    const npc = living.find(n => n.id === priestId);
    if (npc) {
      npc.opinions.satisfaction = clamp(npc.opinions.satisfaction + 0.01, -1, 1);
      npc.opinions.leaderApproval = clamp(npc.opinions.leaderApproval + 0.02, -1, 1);
    }
  }
}

// ══════════════════════════════════════════════════
// SCHISM
// ══════════════════════════════════════════════════

const INCOMPATIBLE_MORALS = [
  ['hubris_punished', 'leaders_necessary'],
  ['outsiders_dangerous', 'unity_saves'],
  ['tradition_neglected', 'tradition_sacred'],
  ['greed_cursed', 'generosity_rewarded'],
  ['hubris_punished', 'tradition_sacred'],
  ['leaders_corrupt', 'leaders_necessary'],
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

      // Check incompatible morals OR competing faction versions
      const moralConflict = INCOMPATIBLE_MORALS.some(([x, y]) =>
        (a.moral === x && b.moral === y) || (a.moral === y && b.moral === x)
      );

      const mythA = religion.myths.find(m => m.id === a.mythId);
      const mythB = religion.myths.find(m => m.id === b.mythId);
      if (!mythA || !mythB) continue;

      // Also detect schism from competing faction versions
      const factionConflict = mythA.factionVersion && mythB.factionVersion &&
        mythA.factionVersion !== mythB.factionVersion &&
        mythA.sourceEventType === mythB.sourceEventType;

      if (!moralConflict && !factionConflict) continue;

      if (mythA.holders.length / pop >= 0.3 && mythB.holders.length / pop >= 0.3) {
        religion.schisms.push({
          beliefA: a.mythId,
          beliefB: b.mythId,
          formedTick: tick,
          narrativeA: mythA.name + (mythA.factionVersion ? ` (${mythA.factionVersion})` : ''),
          narrativeB: mythB.name + (mythB.factionVersion ? ` (${mythB.factionVersion})` : ''),
        });

        recordEvent(settlement.chronicle, tick, 'religious_schism', [],
          `A mythological schism has divided ${settlement.name}! "${mythA.name}" vs "${mythB.name}"`,
          { affectsAll: true, affectedCount: pop }
        );

        settlement.events.push({
          tick, type: 'schism',
          text: `SCHISM: "${mythA.name}" vs "${mythB.name}" — the settlement is divided!`,
        });
      }
    }
  }
}

// ══════════════════════════════════════════════════
// SACRED LAW PRESSURE
// ══════════════════════════════════════════════════

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
        } else if (belief.moral === 'hubris_punished' || belief.moral === 'leaders_corrupt') {
          npc.opinions.leaderApproval = clamp(npc.opinions.leaderApproval - 0.003, -1, 1);
        } else if (belief.moral === 'outsiders_dangerous') {
          npc.opinions.satisfaction = clamp(npc.opinions.satisfaction - 0.002, -1, 1);
        }
      }
    }
  }
}

// ══════════════════════════════════════════════════
// BELIEF DECAY (with narrative gravity)
// ══════════════════════════════════════════════════

function decayBeliefs(settlement, tick) {
  const religion = settlement.religion;
  const living = getLiving(settlement);
  if (living.length === 0) return;

  for (const myth of religion.myths) {
    const gravity = computeNarrativeGravity(myth, settlement);
    // Higher gravity = slower forgetting
    const forgetRate = 0.02 / (1 + gravity * 0.05);

    for (let i = myth.holders.length - 1; i >= 0; i--) {
      const npcId = myth.holders[i];
      const npc = living.find(n => n.id === npcId);
      if (!npc) { myth.holders.splice(i, 1); continue; }

      const hasRecentMemory = npc.memories.some(m =>
        m.eventType === myth.sourceEventType && m.fidelity > 0.3
      );
      if (!hasRecentMemory && seededRandom(settlement) < forgetRate) {
        myth.holders.splice(i, 1);
      }
    }
  }

  // Remove beliefs with low adoption
  for (let i = religion.beliefs.length - 1; i >= 0; i--) {
    const belief = religion.beliefs[i];
    const myth = religion.myths.find(m => m.id === belief.mythId);
    if (!myth) { religion.beliefs.splice(i, 1); continue; }

    const adoption = myth.holders.length / living.length;
    if (adoption < 0.2 && (tick - belief.formedTick) > 100) {
      religion.beliefs.splice(i, 1);
      settlement.events.push({
        tick, type: 'belief_faded',
        text: `A belief has faded from ${settlement.name}: "${myth.name}"`,
      });
    }
  }

  // Remove myths with zero holders and low gravity
  for (let i = religion.myths.length - 1; i >= 0; i--) {
    const myth = religion.myths[i];
    if (myth.holders.length === 0) {
      const gravity = computeNarrativeGravity(myth, settlement);
      if (gravity < 20) {
        religion.myths.splice(i, 1);
      }
    }
  }
}

// ══════════════════════════════════════════════════
// MAIN TICK
// ══════════════════════════════════════════════════

function tickReligion(settlement, tick) {
  if (!settlement.religion) settlement.religion = createReligionState();

  // Ensure all existing myths have new fields (backward compat)
  for (const myth of settlement.religion.myths) {
    if (!myth.distortions) myth.distortions = [];
    if (!myth.tags) myth.tags = [];
    if (myth.distortedMagnitude === undefined) myth.distortedMagnitude = 0;
    if (myth.hero === undefined) myth.hero = null;
    if (myth.actor === undefined) myth.actor = null;
    if (myth.factionVersion === undefined) myth.factionVersion = null;
  }

  // Full detection every 10 ticks
  if (tick % 10 !== 0) {
    applyBeliefEffects(settlement);
    performRituals(settlement, tick);
    applySacredLawPressure(settlement);
    return;
  }

  const living = getLiving(settlement);
  for (const myth of settlement.religion.myths) {
    refreshHolders(myth, living);
  }

  // Myth evolution — distort existing myths over time
  evolveMythsOverTime(settlement, tick);

  // Belief decay with narrative gravity
  decayBeliefs(settlement, tick);

  // Detect new myths
  detectMyths(settlement, tick);
  detectDramaticMyths(settlement, tick);

  // Belief pipeline
  detectBeliefs(settlement, tick);
  detectRituals(settlement, tick);
  detectPriests(settlement, tick);
  detectSchisms(settlement, tick);

  // Apply effects
  applyBeliefEffects(settlement);
  performRituals(settlement, tick);
  applySacredLawPressure(settlement);
}

// ══════════════════════════════════════════════════
// DISPLAY
// ══════════════════════════════════════════════════

function formatBeliefs(settlement) {
  if (!settlement.religion) return 'No religious beliefs have formed yet. The world is young.';
  const religion = settlement.religion;
  const living = getLiving(settlement);
  const pop = living.length;
  const name = settlement.name || 'the settlement';

  const lines = [`═══ MYTHOLOGY & BELIEFS OF ${name.toUpperCase()} ═══`, ''];

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
    const gravity = computeNarrativeGravity(myth, settlement);
    const distCount = (myth.distortions || []).length;

    lines.push(`  ◆ ${myth.name}${myth.factionVersion ? ` [${myth.factionVersion}]` : ''}`);
    lines.push(`    "${myth.narrative.slice(0, 150)}${myth.narrative.length > 150 ? '...' : ''}"`);
    lines.push(`    Origin: ${myth.sourceEventType} (Day ${myth.sourceTick}) | Moral: ${myth.moral}`);
    lines.push(`    Adoption: ${adoption}% | Gravity: ${Math.round(gravity)} | Distortions: ${distCount} | Fidelity: ${(myth.avgFidelity * 100).toFixed(0)}%`);
    if (myth.hero) lines.push(`    Hero: ${myth.hero.name} ${myth.hero.epithet || ''}`);
    if (myth.supernaturalCause) lines.push(`    Supernatural: ${myth.supernaturalCause}`);
    if (distCount > 0) {
      const ops = myth.distortions.map(d => d.op).join(' → ');
      lines.push(`    Distortion chain: ${ops}`);
    }
    lines.push('');
  }

  if (religion.beliefs.length > 0) {
    lines.push(`BELIEFS (${religion.beliefs.length}):`);
    for (const belief of religion.beliefs) {
      const myth = religion.myths.find(m => m.id === belief.mythId);
      const currentAdoption = myth ? Math.round(myth.holders.length / pop * 100) : 0;
      const age = (settlement.tick || 0) - belief.formedTick;
      lines.push(`  ★ "${myth ? myth.name : 'Unknown'}"`);
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
  computeNarrativeGravity,
};
