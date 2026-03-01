'use strict';

/**
 * Phase 4: Narrative Chronicle — transforms raw chronicle entries
 * into readable, story-like text.
 */

const { detectFactions } = require('./politics');

/**
 * Generate a narrative string from a chronicle entry + world context.
 */
function narrateEntry(entry, world) {
  const day = entry.tick;
  const actors = entry.actors || [];
  const actorNames = actors.map(a => a.name);

  switch (entry.eventType) {
    case 'founding':
      return `On the first day, ${actorNames[0] || 'a settlement'} was founded. ` +
        `Twenty-five souls gathered to carve a life from the wilderness. ` +
        `The fields were untilled, the granaries empty, and the future uncertain.`;

    case 'election': {
      const councilMembers = actors.filter(a => a.role === 'council');
      const names = councilMembers.map(a => a.name);
      const taxMatch = entry.outcome.match(/Tax:\s*(\d+)%\s*→\s*(\d+)%/);
      const oldTax = taxMatch ? taxMatch[1] : '?';
      const newTax = taxMatch ? taxMatch[2] : '?';

      // Find factions for color
      let factionNote = '';
      if (world) {
        const { factions } = detectFactions(world);
        for (const f of factions) {
          const elected = f.members.filter(m => councilMembers.some(c => c.id === m.id));
          if (elected.length > 0) {
            factionNote = ` ${f.emoji} ${f.name} ${elected.length > 1 ? 'celebrated' : 'took note'}.`;
          }
        }
      }

      if (names.length === 3) {
        return `On day ${day}, ${names[0]}, ${names[1]}, and ${names[2]} were elected to the council. ` +
          `Taxes shifted from ${oldTax}% to ${newTax}%.${factionNote}`;
      }
      return `On day ${day}, a new council was elected: ${names.join(', ')}. ` +
        `Tax rate moved from ${oldTax}% to ${newTax}%.${factionNote}`;
    }

    case 'tax_change': {
      const match = entry.outcome.match(/(raised|lowered) from (\d+)% to (\d+)%/);
      if (match) {
        const direction = match[1];
        const from = match[2];
        const to = match[3];
        if (direction === 'raised') {
          return `Day ${day}: The council ${direction} taxes from ${from}% to ${to}%. ` +
            `Farmers grumbled. Guards nodded approvingly.`;
        } else {
          return `Day ${day}: Taxes were cut from ${from}% to ${to}%. ` +
            `The market hummed a little louder.`;
        }
      }
      return `Day ${day}: ${entry.outcome}`;
    }

    case 'crisis': {
      const treasuryMatch = entry.outcome.match(/(\d+)g/);
      const amount = treasuryMatch ? treasuryMatch[1] : '???';
      return `Day ${day}: CRISIS — The treasury dwindled to just ${amount} gold. ` +
        `Guards whispered about unpaid wages. The settlement held its breath.`;
    }

    case 'hunger': {
      const countMatch = entry.outcome.match(/^(\d+)/);
      const count = countMatch ? countMatch[1] : 'several';
      const hungerNames = actors.slice(0, 3).map(a => a.name);
      const nameStr = hungerNames.length > 0
        ? ` — among them ${hungerNames.join(' and ')}`
        : '';
      return `Day ${day}: ${count} residents went hungry${nameStr}. ` +
        `The smell of baking bread was conspicuously absent.`;
    }

    case 'surplus': {
      const goldMatch = entry.outcome.match(/(\d+)g/);
      const gold = goldMatch ? goldMatch[1] : 'plenty';
      return `Day ${day}: The treasury swelled to ${gold} gold. ` +
        `A rare surplus — some called it prosperity, others called it over-taxation.`;
    }

    case 'bankruptcy': {
      const npcName = actorNames[0] || 'Someone';
      const oldJob = actors[0]?.role || 'their trade';
      const newJobMatch = entry.outcome.match(/switched to (.+)\./);
      const newJob = newJobMatch ? newJobMatch[1] : 'a new trade';
      return `Day ${day}: ${npcName} went bankrupt as a ${oldJob} and turned to ${newJob}. ` +
        `Desperate times demand reinvention.`;
    }

    case 'relief': {
      const spentMatch = entry.outcome.match(/(\d+) gold spent feeding (\d+)/);
      if (spentMatch) {
        return `Day ${day}: The treasury opened its coffers — ${spentMatch[1]} gold spent ` +
          `to feed ${spentMatch[2]} hungry souls. Not charity, but survival.`;
      }
      return `Day ${day}: Emergency relief was distributed. ${entry.outcome}`;
    }

    case 'gossip_distortion': {
      const teller = actors.find(a => a.role === 'teller');
      const listener = actors.find(a => a.role === 'listener');
      const origMatch = entry.outcome.match(/Original value: ([\d.]+), transmitted as: ([\d.]+)/);
      if (teller && listener && origMatch) {
        const orig = parseFloat(origMatch[1]).toFixed(1);
        const distorted = parseFloat(origMatch[2]).toFixed(1);
        return `Day ${day}: ${teller.name} told ${listener.name} a distorted tale. ` +
          `What was ${orig} became ${distorted} in the retelling. ` +
          `Rumors have a way of growing legs.`;
      }
      return `Day ${day}: A rumor spread through ${actorNames.join(' and ')}. ` +
        `The truth bent a little further.`;
    }

    case 'good_harvest': {
      const bonusMatch = entry.outcome.match(/(\d+) extra grain/);
      const bonus = bonusMatch ? bonusMatch[1] : 'extra';
      return `Day ${day}: The weather smiled on Millhaven. ` +
        `A bountiful harvest brought ${bonus} extra grain to every farmer's stores.`;
    }

    case 'job_switch': {
      const name = actorNames[0] || 'Someone';
      return `Day ${day}: ${name} abandoned their old trade to become a farmer, ` +
        `driven by the gnawing reality of an empty stomach.`;
    }

    default:
      return `Day ${day}: ${entry.outcome || entry.eventType}`;
  }
}

/**
 * Format the newspaper — last N chronicle entries as narrative.
 */
function formatNewspaper(world, count = 5) {
  if (!world.chronicle || world.chronicle.entries.length === 0) {
    return 'The presses are silent. No news to report.';
  }

  const entries = world.chronicle.entries.slice(-count);
  const lines = [
    '╔══════════════════════════════════════════════════╗',
    '║     THE MILLHAVEN CHRONICLE — Daily Gazette     ║',
    `║              Day ${String(world.tick).padStart(4)}                         ║`,
    '╚══════════════════════════════════════════════════╝',
    '',
  ];

  for (const entry of entries.reverse()) {
    const stars = entry.significance >= 100 ? '⚡' :
                  entry.significance >= 60 ? '★' : '·';
    lines.push(`${stars} ${narrateEntry(entry, world)}`);
    lines.push('');
  }

  lines.push(`─── ${world.chronicle.entries.length} entries in the Chronicle ───`);
  return lines.join('\n');
}

/**
 * Format talk output — what an NPC says when you approach them.
 */
function formatTalk(world, name) {
  if (!name) return 'Talk to whom? Usage: talk <name>';

  const npc = world.npcs.find(n => n.name.toLowerCase() === name.toLowerCase());
  if (!npc) return `No one named "${name}" lives here.`;

  const lines = [];

  // Greeting based on mood
  const sat = npc.opinions.satisfaction;
  let greeting;
  if (sat > 0.5) greeting = `${npc.name} smiles warmly.`;
  else if (sat > 0.2) greeting = `${npc.name} nods in greeting.`;
  else if (sat > -0.2) greeting = `${npc.name} glances at you.`;
  else if (sat > -0.5) greeting = `${npc.name} scowls slightly.`;
  else greeting = `${npc.name} barely looks up. Their eyes are tired.`;

  lines.push(greeting);
  lines.push('');

  // Job and economic status
  const goldStatus = npc.gold > 50 ? 'doing well' :
                     npc.gold > 20 ? 'getting by' :
                     npc.gold > 5 ? 'struggling' : 'nearly broke';
  lines.push(`"I'm a ${npc.job}. ${goldStatus === 'doing well' ? 'Business is good.' :
    goldStatus === 'getting by' ? 'Could be worse, I suppose.' :
    goldStatus === 'struggling' ? 'Times are hard.' :
    'I can barely afford to eat.'}" [${Math.floor(npc.gold)}g]`);

  // Political opinion
  const taxPct = Math.round(world.taxRate * 100);
  if (npc.opinions.taxSentiment > 0.3) {
    lines.push(`"Taxes at ${taxPct}%? Fair enough. We need the treasury for hard times."`);
  } else if (npc.opinions.taxSentiment > 0) {
    lines.push(`"${taxPct}% tax... it's tolerable, I suppose."`);
  } else if (npc.opinions.taxSentiment > -0.3) {
    lines.push(`"${taxPct}% tax is getting steep, if you ask me."`);
  } else {
    lines.push(`"${taxPct}% tax is robbery! The council lines its pockets while we starve."`);
  }

  // Leader approval
  const councilNames = world.council
    .map(id => world.npcs.find(n => n.id === id)?.name || '?')
    .join(', ');
  if (npc.opinions.leaderApproval > 0.3) {
    lines.push(`"The council — ${councilNames} — they're doing alright."`);
  } else if (npc.opinions.leaderApproval > -0.3) {
    lines.push(`"The council? ${councilNames}. Eh. Could do better."`);
  } else {
    lines.push(`"${councilNames}? Don't get me started. This council is useless."`);
  }

  // Recent memory
  if (npc.memories.length > 0) {
    const recent = npc.memories[npc.memories.length - 1];
    const memText = formatMemoryQuote(recent, world);
    lines.push('');
    lines.push(memText);
  }

  // Gossip — find a memory with low fidelity (distorted)
  const gossipMem = npc.memories.find(m => m.fidelity < 0.6 && m.fidelity > 0.2);
  if (gossipMem) {
    lines.push('');
    const gossipText = formatGossipQuote(gossipMem, world, npc);
    lines.push(gossipText);
  }

  // Faction
  lines.push('');
  const { factions } = detectFactions(world);
  const myFaction = factions.find(f => f.members.some(m => m.id === npc.id));
  if (myFaction) {
    lines.push(`${myFaction.emoji} Aligned with ${myFaction.name}`);
  } else {
    lines.push('⚖️  Unaligned — no strong faction ties');
  }

  // Satisfaction meter
  const satBar = renderBar(npc.opinions.satisfaction, -1, 1, 20);
  lines.push(`Satisfaction: ${satBar}`);

  return lines.join('\n');
}

function formatMemoryQuote(mem, world) {
  const age = world.tick - mem.tick;
  const timeAgo = age <= 5 ? 'just recently' :
                  age <= 15 ? 'not long ago' :
                  age <= 30 ? 'a while back' : 'a long time ago';

  switch (mem.eventType) {
    case 'tax_raised':
      return `"I remember ${timeAgo} when they raised taxes to ${(mem.value * 100).toFixed(0)}%..."`;
    case 'tax_lowered':
      return `"I remember ${timeAgo} when taxes came down to ${(mem.value * 100).toFixed(0)}%... that was nice."`;
    case 'food_shortage':
      return `"${timeAgo}... I went hungry. Had only ${mem.value.toFixed(0)}g to my name."`;
    case 'crisis':
      return `"I remember the crisis ${timeAgo}. The treasury had just ${mem.value.toFixed(0)}g."`;
    case 'election':
      return `"There was an election ${timeAgo}. Things changed... or didn't."`;
    case 'surplus':
      return `"${timeAgo}, the treasury was overflowing. ${mem.value.toFixed(0)}g! Felt safe."`;
    case 'bankruptcy':
      return `"${timeAgo}... I lost everything. Had to start over."`;
    case 'relief':
      return `"The treasury saved me ${timeAgo}. Gave me ${mem.value.toFixed(0)} grain."`;
    case 'good_trade':
      return `"Had a decent stretch ${timeAgo}. Belly was full."`;
    case 'bad_trade':
      return `"${timeAgo}, I got a raw deal on a trade. Still stings."`;
    default:
      return `"Something happened ${timeAgo}... the details are fuzzy."`;
  }
}

function formatGossipQuote(mem, world, npc) {
  // Gossip is a distorted memory — show the distorted value
  switch (mem.eventType) {
    case 'tax_raised':
      return `*lowers voice* "I heard taxes were actually ${(mem.value * 100).toFixed(0)}%... ` +
        `that's what they told me, anyway." (fidelity: ${mem.fidelity.toFixed(2)})`;
    case 'tax_lowered':
      return `*lowers voice* "Word is taxes dropped to ${(mem.value * 100).toFixed(0)}%. ` +
        `Take it with a grain of salt." (fidelity: ${mem.fidelity.toFixed(2)})`;
    case 'food_shortage':
      return `*lowers voice* "I heard someone had only ${mem.value.toFixed(0)}g ` +
        `during the shortage..." (fidelity: ${mem.fidelity.toFixed(2)})`;
    case 'crisis':
      return `*lowers voice* "They say the treasury hit ${mem.value.toFixed(0)}g. ` +
        `Who knows if it's true." (fidelity: ${mem.fidelity.toFixed(2)})`;
    default:
      return `*lowers voice* "I heard something about ${mem.eventType.replace(/_/g, ' ')}..." ` +
        `(fidelity: ${mem.fidelity.toFixed(2)})`;
  }
}

function renderBar(value, min, max, width) {
  const normalized = (value - min) / (max - min);
  const filled = Math.round(normalized * width);
  return '[' + '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, width - filled)) + ']';
}

/**
 * Enhanced look command — settlement overview when no name given.
 */
function formatSettlementLook(world) {
  const pop = world.npcs.length;
  const avgSat = world.npcs.reduce((s, n) => s + n.opinions.satisfaction, 0) / pop;
  
  let marketMood;
  if (avgSat > 0.3) marketMood = 'bustling with life';
  else if (avgSat > 0) marketMood = 'quietly humming along';
  else if (avgSat > -0.3) marketMood = 'subdued and tense';
  else marketMood = 'eerily quiet — people keep their heads down';

  const treasuryDesc = world.treasury > 80 ? 'The treasury is well-stocked.' :
                       world.treasury > 30 ? 'The treasury holds a modest sum.' :
                       world.treasury > 10 ? 'The treasury is running low.' :
                       'The treasury is nearly empty.';

  const { factions } = detectFactions(world);
  let factionDesc = '';
  if (factions.length >= 2) {
    factionDesc = `\nPolitical tension simmers between ${factions.map(f => `${f.emoji} ${f.name}`).join(' and ')}.`;
  } else if (factions.length === 1) {
    factionDesc = `\n${factions[0].emoji} ${factions[0].name} hold sway over local politics.`;
  }

  const councilNames = world.council
    .map(id => world.npcs.find(n => n.id === id))
    .filter(Boolean)
    .map(n => n.name)
    .join(', ');

  const lines = [
    `═══ MILLHAVEN ═══`,
    '',
    `Millhaven is a small settlement of ${pop} souls.`,
    `The market is ${marketMood}.`,
    `The council chamber stands at the center, where ${councilNames} deliberate.`,
    `${treasuryDesc} (${Math.floor(world.treasury)}g)`,
    `Tax rate: ${Math.round(world.taxRate * 100)}% | Day ${world.tick}`,
    factionDesc,
    '',
    `Type "people" to see residents, "talk <name>" to chat, or "look <name>" for details.`,
  ];

  return lines.join('\n');
}

/**
 * History command — compressed timeline of major events.
 */
function formatHistory(world) {
  if (!world.chronicle || world.chronicle.entries.length === 0) {
    return 'No history recorded yet.';
  }

  // Filter to significant events only
  const major = world.chronicle.entries.filter(e => e.significance >= 50);
  if (major.length === 0) {
    return 'Nothing of great significance has occurred yet.';
  }

  const lines = [
    '═══ HISTORY OF MILLHAVEN ═══',
    '',
  ];

  // Group by election cycles (every 30 ticks)
  let lastElectionTick = -1;
  for (const entry of major) {
    if (entry.eventType === 'election') {
      if (lastElectionTick >= 0) lines.push('');
      lastElectionTick = entry.tick;
      const councilNames = entry.actors
        .filter(a => a.role === 'council')
        .map(a => a.name)
        .join(', ');
      lines.push(`── Day ${entry.tick}: ELECTION ──`);
      lines.push(`   Council: ${councilNames}`);
      const taxMatch = entry.outcome.match(/Tax:\s*(\d+)%\s*→\s*(\d+)%/);
      if (taxMatch) lines.push(`   Tax: ${taxMatch[1]}% → ${taxMatch[2]}%`);
    } else if (entry.eventType === 'founding') {
      lines.push(`── Day ${entry.tick}: FOUNDING ──`);
      lines.push(`   Millhaven established. 25 settlers.`);
    } else if (entry.eventType === 'crisis') {
      lines.push(`   ⚠ Day ${entry.tick}: Treasury crisis`);
    } else if (entry.eventType === 'relief') {
      lines.push(`   ♥ Day ${entry.tick}: Emergency relief distributed`);
    } else if (entry.eventType === 'tax_change') {
      const match = entry.outcome.match(/(raised|lowered) from (\d+)% to (\d+)%/);
      if (match) lines.push(`   ◆ Day ${entry.tick}: Tax ${match[1]} ${match[2]}% → ${match[3]}%`);
    } else if (entry.eventType === 'bankruptcy') {
      lines.push(`   ✗ Day ${entry.tick}: ${entry.actors[0]?.name || '?'} went bankrupt`);
    } else if (entry.eventType === 'market_crash') {
      lines.push(`   ↓ Day ${entry.tick}: Market crash`);
    }
  }

  lines.push('');
  lines.push(`${major.length} significant events across ${world.tick} days.`);
  return lines.join('\n');
}

module.exports = {
  narrateEntry, formatNewspaper, formatTalk,
  formatSettlementLook, formatHistory,
};
