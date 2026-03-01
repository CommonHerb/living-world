'use strict';

const { distance, getRelationship, updateRelationship } = require('./npc');
const { formMemory } = require('./memory');
const { recordEvent } = require('./chronicle');

/**
 * Phase 8: Social Life — Speech bubbles, NPC-NPC interaction,
 * social clustering, emotional state, daily routines.
 * 
 * Called per-settlement each tick (settlement passed as first arg).
 */

// ─── Time of Day ───
function getTimeOfDay(tick) {
  const phase = tick % 6;
  if (phase < 3) return 'day';      // ticks 0,1,2 = work
  if (phase < 5) return 'evening';  // ticks 3,4 = socialize
  return 'night';                   // tick 5 = sleep
}

// ─── Mood System ───
function computeMood(npc) {
  const sat = npc.opinions.satisfaction;
  const emo = npc.emotionalState || 0;
  const combined = sat * 0.7 + emo * 0.3;
  if (combined > 0.5) return 'happy';
  if (combined > 0.2) return 'content';
  if (combined > -0.2) return 'neutral';
  if (combined > -0.5) return 'sad';
  return 'angry';
}

// ─── Speech Bubble Templates (~55 total) ───
const SPEECH_TEMPLATES = {
  hungry_desperate: [
    "Need food...",
    "My stomach is eating itself.",
    "When did I last eat?",
    "I'd kill for a loaf of bread.",
    "The granary's bare again...",
  ],
  hungry_worried: [
    "Getting harder to find food.",
    "Hope the harvest comes soon.",
    "Can't keep going like this.",
  ],
  happy: [
    "Beautiful day!",
    "Life is good.",
    "Can't complain!",
    "Sun's out, belly's full. What more?",
    "I love this place.",
    "Things are looking up!",
  ],
  content: [
    "Not bad, not bad.",
    "Could be worse.",
    "Steady as she goes.",
    "Another day, another coin.",
  ],
  political_pro_tax: [
    "We need taxes for the common good.",
    "The treasury keeps us safe.",
    "Pay your fair share!",
    "Without taxes, who feeds the guards?",
  ],
  political_anti_tax: [
    "Taxes are too damn high!",
    "The council takes and takes...",
    "I work all day just to line their pockets.",
    "Vote them out!",
    "Taxation is theft, I tell you.",
    "A man can't even keep what he earns.",
  ],
  political_council_good: [
    "The council's doing alright by us.",
    "At least someone's in charge.",
  ],
  political_council_bad: [
    "This council is useless.",
    "We need new leadership.",
    "The council couldn't run a bath.",
  ],
  work_farmer: [
    "These fields won't plow themselves.",
    "Rain would be nice.",
    "Good soil this season.",
    "Back's killing me.",
  ],
  work_miller: [
    "Grain in, flour out. Simple life.",
    "The millstone never stops.",
    "Need more grain to mill!",
  ],
  work_guard: [
    "All quiet on the watch.",
    "I keep the peace around here.",
    "Hope payday comes soon.",
  ],
  work_woodcutter: [
    "Timber!",
    "One more tree, one more log.",
    "The forest provides.",
  ],
  work_miner: [
    "Rock and dust, that's my life.",
    "Found a good vein today.",
    "The quarry echoes.",
  ],
  work_smith: [
    "The forge is hot today.",
    "Good steel takes patience.",
    "Need more wood for the fire.",
  ],
  weather: [
    "Looks like rain.",
    "Clear skies today.",
    "Wind's picking up.",
    "Cold morning.",
    "The air smells like autumn.",
  ],
  family_spouse: [
    "My other half is waiting at home.",
    "Marriage changes a person.",
    "Lucky to have someone.",
  ],
  family_children: [
    "The little one's growing fast.",
    "Kids these days...",
    "Hope my children have it better than me.",
  ],
  family_mourning: [
    "I still think about them...",
    "The empty chair at the table...",
    "They're gone but not forgotten.",
  ],
  gossip: [
    "Did you hear about {target}?",
    "Word around town is...",
    "I shouldn't say this, but...",
    "Between you and me...",
    "You didn't hear it from me, but...",
  ],
  sad: [
    "*sigh*",
    "What's the point?",
    "Everything's falling apart.",
    "I miss better days.",
    "Just trying to get through.",
  ],
  angry: [
    "This is unacceptable!",
    "Something has to change!",
    "I've had enough!",
    "Who's responsible for this mess?",
    "Mark my words, there'll be trouble.",
  ],
  sleep: [
    "*yawn*",
    "Time to rest...",
    "Long day...",
    "Candle's burning low.",
  ],
};

function pickSpeechBubble(npc, settlement, rng) {
  const mood = computeMood(npc);
  const time = getTimeOfDay(settlement.tick || 0);
  const candidates = [];

  if (time === 'night') {
    candidates.push(...SPEECH_TEMPLATES.sleep);
    if (rng.random() > 0.7) candidates.push(...(SPEECH_TEMPLATES[mood] || []));
    return candidates.length > 0 ? rng.pick(candidates) : null;
  }

  // Hunger
  const totalFood = (npc.inventory.grain || 0) + (npc.inventory.flour || 0);
  if (totalFood < 2) {
    candidates.push(...SPEECH_TEMPLATES.hungry_desperate, ...SPEECH_TEMPLATES.hungry_desperate);
  } else if (totalFood < 5) {
    candidates.push(...SPEECH_TEMPLATES.hungry_worried);
  }

  // Mood
  if (SPEECH_TEMPLATES[mood]) candidates.push(...SPEECH_TEMPLATES[mood]);

  // Political
  if (npc.opinions.taxSentiment > 0.3) candidates.push(...SPEECH_TEMPLATES.political_pro_tax);
  else if (npc.opinions.taxSentiment < -0.3) candidates.push(...SPEECH_TEMPLATES.political_anti_tax);
  if (npc.opinions.leaderApproval > 0.3) candidates.push(...SPEECH_TEMPLATES.political_council_good);
  else if (npc.opinions.leaderApproval < -0.3) candidates.push(...SPEECH_TEMPLATES.political_council_bad);

  // Work (day only)
  if (time === 'day' && SPEECH_TEMPLATES[`work_${npc.job}`]) {
    candidates.push(...SPEECH_TEMPLATES[`work_${npc.job}`]);
  }

  // Weather filler
  candidates.push(...SPEECH_TEMPLATES.weather);

  // Family
  if (npc.spouseId != null) {
    const spouse = settlement.npcs.find(n => n.id === npc.spouseId);
    if (spouse && spouse.alive !== false) candidates.push(...SPEECH_TEMPLATES.family_spouse);
    else if (spouse && spouse.alive === false) candidates.push(...SPEECH_TEMPLATES.family_mourning);
  }
  if (npc.childIds && npc.childIds.length > 0) candidates.push(...SPEECH_TEMPLATES.family_children);

  // Gossip with target sub
  if (npc.memories.length > 0) {
    candidates.push(...SPEECH_TEMPLATES.gossip.map(t => {
      const mem = rng.pick(npc.memories);
      return t.replace('{target}', mem.subject || 'things');
    }));
  }

  return candidates.length > 0 ? rng.pick(candidates) : null;
}

// ─── NPC-NPC Interactions ───
function pickInteraction(npcA, npcB, settlement, rng) {
  const rel = getRelationship(npcA, npcB.id);
  const weights = { chat: 3, gossip: 2, argue: 0, trade: 1 };

  const taxDiff = Math.abs(npcA.opinions.taxSentiment - npcB.opinions.taxSentiment);
  if (taxDiff > 0.5) weights.argue += 3;
  if (rel.trust < 0) { weights.chat -= 1; weights.argue += 1; }
  if (rel.trust > 0.3) { weights.gossip += 2; weights.chat += 1; }

  const aHasGoods = Object.values(npcA.inventory || {}).some(v => v > 3);
  const bHasGoods = Object.values(npcB.inventory || {}).some(v => v > 3);
  if (aHasGoods && bHasGoods) weights.trade += 2;

  const total = Object.values(weights).reduce((s, w) => s + Math.max(0, w), 0);
  let r = rng.random() * total;
  for (const [type, w] of Object.entries(weights)) {
    r -= Math.max(0, w);
    if (r <= 0) return type;
  }
  return 'chat';
}

function executeInteraction(npcA, npcB, type, settlement, rng, tick) {
  switch (type) {
    case 'chat': {
      updateRelationship(npcA, npcB.id, 0.03, 0.02);
      updateRelationship(npcB, npcA.id, 0.03, 0.02);
      npcA.opinions.satisfaction = Math.min(1, npcA.opinions.satisfaction + 0.01);
      npcB.opinions.satisfaction = Math.min(1, npcB.opinions.satisfaction + 0.01);
      const lines = [
        `${npcA.name} and ${npcB.name} chat about the weather.`,
        `${npcA.name} shares a laugh with ${npcB.name}.`,
        `${npcA.name} and ${npcB.name} swap stories.`,
        `${npcB.name} listens as ${npcA.name} talks about work.`,
        `${npcA.name} and ${npcB.name} sit together quietly.`,
      ];
      return { text: rng.pick(lines), type: 'chat' };
    }

    case 'gossip': {
      if (npcA.memories.length === 0) {
        return { text: `${npcA.name} has nothing to share with ${npcB.name}.`, type: 'gossip' };
      }
      const mem = rng.pick(npcA.memories);
      const alreadyKnows = npcB.memories.some(m =>
        m.eventType === mem.eventType && m.subject === mem.subject && Math.abs(m.tick - mem.tick) < 5
      );
      if (!alreadyKnows && rng.random() < npcB.genome.credulity * 0.7 + 0.3) {
        formMemory(npcB, mem.eventType, mem.subject,
          mem.value * (0.8 + rng.random() * 0.4),
          mem.valence * (0.85 + rng.random() * 0.3), mem.tick);
      }
      updateRelationship(npcA, npcB.id, 0.02, 0.01);
      updateRelationship(npcB, npcA.id, 0.01, 0.01);
      const lines = [
        `${npcA.name} whispers to ${npcB.name} about ${mem.eventType.replace(/_/g, ' ')}.`,
        `${npcA.name} leans close to ${npcB.name}: "Did you hear...?"`,
        `${npcB.name} raises an eyebrow as ${npcA.name} shares a rumor.`,
      ];
      return { text: rng.pick(lines), type: 'gossip' };
    }

    case 'argue': {
      updateRelationship(npcA, npcB.id, -0.05, -0.03);
      updateRelationship(npcB, npcA.id, -0.05, -0.03);
      npcA.opinions.satisfaction = Math.max(-1, npcA.opinions.satisfaction - 0.02);
      npcB.opinions.satisfaction = Math.max(-1, npcB.opinions.satisfaction - 0.02);
      npcA.emotionalState = Math.max(-1, (npcA.emotionalState || 0) - 0.1);
      npcB.emotionalState = Math.max(-1, (npcB.emotionalState || 0) - 0.1);

      const aStance = npcA.opinions.taxSentiment > 0 ? 'higher taxes' : 'lower taxes';
      const bStance = npcB.opinions.taxSentiment > 0 ? 'higher taxes' : 'lower taxes';
      const lines = [
        `${npcA.name} and ${npcB.name} argue about taxes. ${npcA.name} wants ${aStance}; ${npcB.name} wants ${bStance}.`,
        `${npcA.name} slams the table. "${npcB.name}, you're wrong about the council!"`,
        `Voices rise as ${npcA.name} and ${npcB.name} debate the tax rate.`,
        `${npcA.name} and ${npcB.name} exchange heated words about leadership.`,
      ];

      if (Math.abs(npcA.opinions.taxSentiment - npcB.opinions.taxSentiment) > 0.6 && settlement.chronicle) {
        recordEvent(settlement.chronicle, tick, 'political_argument',
          [{ id: npcA.id, name: npcA.name, role: 'arguer' },
           { id: npcB.id, name: npcB.name, role: 'arguer' }],
          `${npcA.name} and ${npcB.name} clashed over politics in ${settlement.name}.`,
          { affectedCount: 2 }
        );
      }
      return { text: rng.pick(lines), type: 'argue' };
    }

    case 'trade': {
      for (const commodity of ['grain', 'flour', 'wood', 'stone', 'tools']) {
        const aHas = (npcA.inventory[commodity] || 0);
        const bHas = (npcB.inventory[commodity] || 0);
        if (aHas > 5 && bHas < 2) {
          const amount = Math.min(2, aHas - 3);
          npcA.inventory[commodity] -= amount;
          npcB.inventory[commodity] = (npcB.inventory[commodity] || 0) + amount;
          const price = amount * 1.5;
          if (npcB.gold >= price) { npcB.gold -= price; npcA.gold += price; }
          updateRelationship(npcA, npcB.id, 0.04, 0.02);
          updateRelationship(npcB, npcA.id, 0.04, 0.02);
          npcA.emotionalState = Math.min(1, (npcA.emotionalState || 0) + 0.05);
          npcB.emotionalState = Math.min(1, (npcB.emotionalState || 0) + 0.05);
          return { text: `${npcA.name} sells ${amount} ${commodity} to ${npcB.name}.`, type: 'trade' };
        }
      }
      return { text: `${npcA.name} and ${npcB.name} haggle but can't agree on a price.`, type: 'trade' };
    }
  }
}

// ─── Social Clustering / Movement ───
function moveToward(npc, targetX, targetY, rng) {
  const dx = targetX - npc.position.x;
  const dy = targetY - npc.position.y;
  if (Math.abs(dx) > 0 && (Math.abs(dx) >= Math.abs(dy) || rng.random() < 0.5)) {
    npc.position.x += dx > 0 ? 1 : -1;
  } else if (Math.abs(dy) > 0) {
    npc.position.y += dy > 0 ? 1 : -1;
  }
  npc.position.x = Math.max(0, Math.min(9, npc.position.x));
  npc.position.y = Math.max(0, Math.min(9, npc.position.y));
}

function tickSocialMovement(settlement, tick) {
  const rng = settlement.tickRng;
  const time = getTimeOfDay(tick);
  const npcs = settlement.npcs.filter(n => n.alive !== false && !n.isChild);

  for (const npc of npcs) {
    if (rng.random() > 0.3) continue;

    if (time === 'night') {
      const homeX = (npc.job === 'farmer' || npc.job === 'woodcutter') ? (rng.random() < 0.5 ? 1 : 8) : rng.int(3, 6);
      const homeY = (npc.job === 'farmer' || npc.job === 'woodcutter') ? (rng.random() < 0.5 ? 1 : 8) : rng.int(3, 6);
      moveToward(npc, homeX, homeY, rng);
      continue;
    }

    if (time === 'day') {
      let tx, ty;
      switch (npc.job) {
        case 'farmer': case 'woodcutter':
          tx = rng.random() < 0.5 ? 0 : 9; ty = rng.int(0, 9); break;
        case 'miner':
          tx = rng.random() < 0.5 ? 0 : 9; ty = rng.random() < 0.5 ? 0 : 9; break;
        default:
          tx = rng.int(3, 6); ty = rng.int(3, 6);
      }
      moveToward(npc, tx, ty, rng);
      continue;
    }

    // Evening: move toward liked NPCs (social clustering)
    let bestTarget = null;
    let bestScore = -Infinity;
    for (const other of npcs) {
      if (other.id === npc.id) continue;
      const rel = getRelationship(npc, other.id);
      let score = rel.trust + rel.affinity;
      if (npc.familyId && npc.familyId === other.familyId) score += 0.5;
      if (npc.spouseId === other.id) score += 1.0;
      if (npc.parentIds && npc.parentIds.includes(other.id)) score += 0.3;
      if (npc.childIds && npc.childIds.includes(other.id)) score += 0.3;
      if (score > bestScore && score > 0) { bestScore = score; bestTarget = other; }
    }
    if (bestTarget) {
      moveToward(npc, bestTarget.position.x, bestTarget.position.y, rng);
    } else {
      moveToward(npc, rng.int(3, 6), rng.int(3, 6), rng);
    }
  }
}

// ─── Mood Updates from Events ───
function updateMoodFromEvents(npc, settlement) {
  for (const evt of settlement.events) {
    if (evt.type === 'marriage' && evt.text && evt.text.includes(npc.name)) {
      npc.emotionalState = Math.min(1, (npc.emotionalState || 0) + 0.5);
    }
    if (evt.type === 'birth' && evt.text && evt.text.includes(npc.name)) {
      npc.emotionalState = Math.min(1, (npc.emotionalState || 0) + 0.4);
    }
    if (evt.type === 'death' && evt.text && evt.text.includes(npc.name)) {
      npc.emotionalState = Math.max(-1, (npc.emotionalState || 0) - 0.6);
    }
    if (evt.type === 'hunger' && npc.inventory &&
        (npc.inventory.grain || 0) + (npc.inventory.flour || 0) < 1) {
      npc.emotionalState = Math.max(-1, (npc.emotionalState || 0) - 0.15);
    }
    if (evt.type === 'election' && settlement.council && settlement.council.includes(npc.id)) {
      npc.emotionalState = Math.min(1, (npc.emotionalState || 0) + 0.3);
    }
  }
}

// ─── Main Social Tick ───
// Called per settlement: tickSocial(settlement, worldTick)
function tickSocial(settlement, tick) {
  const rng = settlement.tickRng;
  const time = getTimeOfDay(tick);
  const npcs = settlement.npcs.filter(n => n.alive !== false && !n.isChild);

  // Store the current tick on settlement for speech bubble time-of-day
  settlement.tick = tick;

  // 1. Update mood from this tick's events
  for (const npc of npcs) {
    updateMoodFromEvents(npc, settlement);
    npc.mood = computeMood(npc);
  }

  // 2. Social movement (clustering)
  tickSocialMovement(settlement, tick);

  // 3. Speech bubbles (~15% chance, less at night)
  const speechChance = time === 'night' ? 0.05 : 0.15;
  for (const npc of npcs) {
    if (rng.random() < speechChance) {
      const bubble = pickSpeechBubble(npc, settlement, rng);
      if (bubble) {
        const mood = npc.mood;
        const verb = mood === 'angry' ? 'snaps' :
                     mood === 'sad' ? 'mutters' :
                     mood === 'happy' ? 'says cheerfully' :
                     mood === 'content' ? 'remarks' : 'says';
        settlement.events.push({
          tick,
          type: 'speech',
          text: `💬 ${npc.name} ${verb}: "${bubble}"`,
        });
      }
    }
  }

  // 4. NPC-NPC Interactions (more in evening, none at night)
  if (time !== 'night') {
    const interactionChance = time === 'evening' ? 0.4 : 0.15;
    const alreadyInteracted = new Set();

    for (const npc of npcs) {
      if (alreadyInteracted.has(npc.id)) continue;
      if (rng.random() > interactionChance) continue;

      const nearby = npcs.filter(other =>
        other.id !== npc.id &&
        !alreadyInteracted.has(other.id) &&
        distance(npc.position, other.position) <= 1
      );
      if (nearby.length === 0) continue;
      const partner = rng.pick(nearby);

      const interactionType = pickInteraction(npc, partner, settlement, rng);
      const result = executeInteraction(npc, partner, interactionType, settlement, rng, tick);

      if (result) {
        const emoji = result.type === 'argue' ? '⚡' :
                      result.type === 'gossip' ? '🗣️' :
                      result.type === 'trade' ? '🤝' : '💭';
        settlement.events.push({
          tick,
          type: `social_${result.type}`,
          text: `${emoji} ${result.text}`,
        });
      }

      alreadyInteracted.add(npc.id);
      alreadyInteracted.add(partner.id);
    }
  }
}

module.exports = {
  tickSocial, computeMood, getTimeOfDay,
  pickSpeechBubble, SPEECH_TEMPLATES,
};
