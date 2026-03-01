'use strict';

const { detectFactions } = require('./politics');

function narrateEntry(entry, settlement) {
  const day = entry.tick;
  const actors = entry.actors || [];
  const actorNames = actors.map(a => a.name);
  const sName = settlement ? settlement.name : 'the settlement';

  switch (entry.eventType) {
    case 'founding':
      return `On the first day, ${actorNames[0] || sName} was founded. ` +
        `Souls gathered to carve a life from the wilderness.`;

    case 'election': {
      const councilMembers = actors.filter(a => a.role === 'council');
      const names = councilMembers.map(a => a.name);
      const taxMatch = entry.outcome.match(/Tax:\s*(\d+)%\s*→\s*(\d+)%/);
      const oldTax = taxMatch ? taxMatch[1] : '?';
      const newTax = taxMatch ? taxMatch[2] : '?';

      let factionNote = '';
      if (settlement) {
        const { factions } = detectFactions(settlement);
        for (const f of factions) {
          const elected = f.members.filter(m => councilMembers.some(c => c.id === m.id));
          if (elected.length > 0) {
            factionNote = ` ${f.emoji} ${f.name} ${elected.length > 1 ? 'celebrated' : 'took note'}.`;
          }
        }
      }

      if (names.length === 3) {
        return `On day ${day}, ${names[0]}, ${names[1]}, and ${names[2]} were elected to ${sName}'s council. ` +
          `Taxes shifted from ${oldTax}% to ${newTax}%.${factionNote}`;
      }
      return `On day ${day}, a new council was elected in ${sName}: ${names.join(', ')}. ` +
        `Tax rate moved from ${oldTax}% to ${newTax}%.${factionNote}`;
    }

    case 'succession':
      return `Day ${day}: ${actorNames[0] || 'A new ruler'} claimed the throne of ${sName}.`;

    case 'coup':
      return `Day ${day}: COUP! ${actorNames[0] || 'A challenger'} overthrew ${actorNames[1] || 'the ruler'} in ${sName}. ` +
        `The old order crumbled.`;

    case 'tax_change': {
      const match = entry.outcome.match(/(raised|lowered) from (\d+)% to (\d+)%/);
      if (match) {
        return `Day ${day}: ${sName}'s ${match[1] === 'raised' ? 'taxes rose' : 'taxes fell'} from ${match[2]}% to ${match[3]}%.`;
      }
      return `Day ${day}: ${entry.outcome}`;
    }

    case 'crisis':
      return `Day ${day}: CRISIS in ${sName} — the treasury is nearly empty!`;

    case 'hunger': {
      const countMatch = entry.outcome.match(/^(\d+)/);
      const count = countMatch ? countMatch[1] : 'several';
      return `Day ${day}: ${count} residents of ${sName} went hungry.`;
    }

    case 'surplus':
      return `Day ${day}: ${sName}'s treasury swelled with surplus gold.`;

    case 'bankruptcy':
      return `Day ${day}: ${actorNames[0] || 'Someone'} in ${sName} went bankrupt.`;

    case 'relief':
      return `Day ${day}: ${sName}'s treasury distributed emergency food relief.`;

    case 'emigration':
      return `Day ${day}: ${actorNames[0] || 'A resident'} left ${sName} for greener pastures.`;

    case 'immigration':
      return `Day ${day}: ${actorNames[0] || 'A newcomer'} arrived in ${sName}, seeking a fresh start.`;

    case 'trade':
      return `Day ${day}: A trade caravan ${entry.outcome}`;

    case 'gossip_distortion':
      return `Day ${day}: Rumors spread through ${sName}. The truth bent further.`;

    case 'good_harvest':
      return `Day ${day}: Bountiful harvest in ${sName}!`;

    case 'marriage':
      return `Day ${day}: ${actorNames[0] || '?'} and ${actorNames[1] || '?'} were married in ${sName}.`;

    case 'birth':
      return `Day ${day}: ${actorNames[0] || 'A child'} was born in ${sName}.`;

    case 'death':
      return `Day ${day}: ${actorNames[0] || 'A resident'} of ${sName} passed away.`;

    default:
      return `Day ${day}: ${entry.outcome || entry.eventType}`;
  }
}

function formatNewspaper(world, count = 5, settlementId) {
  const settlement = settlementId
    ? world.settlements.find(s => s.id === settlementId)
    : world.settlements[0];
  if (!settlement) return 'Settlement not found.';

  if (!settlement.chronicle || settlement.chronicle.entries.length === 0) {
    return 'The presses are silent. No news to report.';
  }

  const entries = settlement.chronicle.entries.slice(-count);
  const lines = [
    '╔══════════════════════════════════════════════════╗',
    `║   THE ${settlement.name.toUpperCase()} CHRONICLE — Daily Gazette   `,
    `║              Day ${String(world.tick).padStart(4)}                         ║`,
    '╚══════════════════════════════════════════════════╝',
    '',
  ];

  for (const entry of entries.reverse()) {
    const stars = entry.significance >= 100 ? '⚡' :
                  entry.significance >= 60 ? '★' : '·';
    lines.push(`${stars} ${narrateEntry(entry, settlement)}`);
    lines.push('');
  }

  lines.push(`─── ${settlement.chronicle.entries.length} entries in the Chronicle ───`);
  return lines.join('\n');
}

function formatTalk(world, name) {
  if (!name) return 'Talk to whom? Usage: talk <name>';

  let npc = null;
  let settlement = null;
  for (const s of world.settlements) {
    npc = s.npcs.find(n => n.name.toLowerCase() === name.toLowerCase() && n.alive !== false);
    if (npc) { settlement = s; break; }
  }
  if (!npc) return `No one named "${name}" lives in any settlement.`;

  const lines = [];
  const sat = npc.opinions.satisfaction;
  let greeting;
  if (sat > 0.5) greeting = `${npc.name} smiles warmly.`;
  else if (sat > 0.2) greeting = `${npc.name} nods in greeting.`;
  else if (sat > -0.2) greeting = `${npc.name} glances at you.`;
  else if (sat > -0.5) greeting = `${npc.name} scowls slightly.`;
  else greeting = `${npc.name} barely looks up. Their eyes are tired.`;

  lines.push(`[${settlement.name}] ${greeting}`);
  lines.push('');

  const goldStatus = npc.gold > 50 ? 'doing well' :
                     npc.gold > 20 ? 'getting by' :
                     npc.gold > 5 ? 'struggling' : 'nearly broke';
  lines.push(`"I'm a ${npc.job} here in ${settlement.name}. ${goldStatus === 'doing well' ? 'Business is good.' :
    goldStatus === 'getting by' ? 'Could be worse, I suppose.' :
    goldStatus === 'struggling' ? 'Times are hard.' :
    'I can barely afford to eat.'}" [${Math.floor(npc.gold)}g]`);

  const taxPct = Math.round(settlement.taxRate * 100);
  if (settlement.government === 'monarchy') {
    if (npc.opinions.taxSentiment > 0.3) {
      lines.push(`"The monarch keeps taxes at ${taxPct}%. Fair enough for order."`);
    } else if (npc.opinions.taxSentiment < -0.3) {
      lines.push(`"${taxPct}% tax by royal decree? Tyrant."`);
    } else {
      lines.push(`"${taxPct}% tax... the monarch could do worse."`);
    }
  } else {
    if (npc.opinions.taxSentiment > 0.3) {
      lines.push(`"Taxes at ${taxPct}%? Fair enough. We need the treasury."`);
    } else if (npc.opinions.taxSentiment < -0.3) {
      lines.push(`"${taxPct}% tax is robbery!"`);
    } else {
      lines.push(`"${taxPct}% tax... it's tolerable."`);
    }
  }

  const leaderNames = settlement.council
    .map(id => settlement.npcs.find(n => n.id === id)?.name || '?')
    .join(', ');
  if (npc.opinions.leaderApproval > 0.3) {
    lines.push(`"${leaderNames}? Doing alright."`);
  } else if (npc.opinions.leaderApproval > -0.3) {
    lines.push(`"${leaderNames}? Eh. Could do better."`);
  } else {
    lines.push(`"${leaderNames}? Don't get me started."`);
  }

  if (npc.memories.length > 0) {
    const recent = npc.memories[npc.memories.length - 1];
    lines.push('');
    lines.push(formatMemoryQuote(recent, world));
  }

  lines.push('');
  const { factions } = detectFactions(settlement);
  const myFaction = factions.find(f => f.members.some(m => m.id === npc.id));
  if (myFaction) {
    lines.push(`${myFaction.emoji} Aligned with ${myFaction.name}`);
  } else {
    lines.push('⚖️  Unaligned');
  }

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
      return `"I remember ${timeAgo} when they raised taxes..."`;
    case 'food_shortage':
      return `"${timeAgo}... I went hungry."`;
    case 'crisis':
      return `"I remember the crisis ${timeAgo}."`;
    case 'surplus':
      return `"${timeAgo}, the treasury was overflowing."`;
    case 'migration':
      return `"I left ${mem.subject} ${timeAgo}. Had to find something better."`;
    case 'coup':
      return `"${timeAgo}... the throne changed hands. Wild times."`;
    default:
      return `"Something happened ${timeAgo}... the details are fuzzy."`;
  }
}

function renderBar(value, min, max, width) {
  const normalized = (value - min) / (max - min);
  const filled = Math.round(normalized * width);
  return '[' + '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, width - filled)) + ']';
}

function formatSettlementLook(world, settlementId) {
  const settlement = settlementId
    ? world.settlements.find(s => s.id === settlementId)
    : world.settlements[0];
  if (!settlement) return 'Settlement not found.';

  const living = settlement.npcs.filter(n => n.alive !== false);
  const adults = living.filter(n => !n.isChild);
  const avgSat = adults.length > 0
    ? adults.reduce((s, n) => s + n.opinions.satisfaction, 0) / adults.length
    : 0;
  
  let marketMood;
  if (avgSat > 0.3) marketMood = 'bustling with life';
  else if (avgSat > 0) marketMood = 'quietly humming along';
  else if (avgSat > -0.3) marketMood = 'subdued and tense';
  else marketMood = 'eerily quiet — people keep their heads down';

  const treasuryDesc = settlement.treasury > 80 ? 'The treasury is well-stocked.' :
                       settlement.treasury > 30 ? 'The treasury holds a modest sum.' :
                       settlement.treasury > 10 ? 'The treasury is running low.' :
                       'The treasury is nearly empty.';

  const govDesc = settlement.government === 'monarchy'
    ? `A throne sits at the center, where ${settlement.council.map(id => settlement.npcs.find(n => n.id === id)?.name || '?').join(', ')} rules.`
    : `The council chamber stands at the center, where ${settlement.council.map(id => settlement.npcs.find(n => n.id === id)?.name || '?').join(', ')} deliberate.`;

  const { factions } = detectFactions(settlement);
  let factionDesc = '';
  if (factions.length >= 2) {
    factionDesc = `\nPolitical tension simmers between ${factions.map(f => `${f.emoji} ${f.name}`).join(' and ')}.`;
  } else if (factions.length === 1) {
    factionDesc = `\n${factions[0].emoji} ${factions[0].name} hold sway over local politics.`;
  }

  return [
    `═══ ${settlement.name.toUpperCase()} ═══`,
    '',
    `${settlement.name} is a ${settlement.government === 'monarchy' ? 'monarchy' : 'council-governed settlement'} of ${living.length} souls.`,
    `The market is ${marketMood}.`,
    govDesc,
    `${treasuryDesc} (${Math.floor(settlement.treasury)}g)`,
    `Tax rate: ${Math.round(settlement.taxRate * 100)}% | Day ${world.tick}`,
    factionDesc,
    '',
    `Type "people" to see residents, "talk <name>" to chat, or "look <name>" for details.`,
    `Type "settlements" to see all settlements.`,
  ].join('\n');
}

function formatHistory(world, settlementId) {
  const settlement = settlementId
    ? world.settlements.find(s => s.id === settlementId)
    : world.settlements[0];
  if (!settlement) return 'Settlement not found.';

  if (!settlement.chronicle || settlement.chronicle.entries.length === 0) {
    return 'No history recorded yet.';
  }

  const major = settlement.chronicle.entries.filter(e => e.significance >= 50);
  if (major.length === 0) return 'Nothing of great significance has occurred yet.';

  const lines = [`═══ HISTORY OF ${settlement.name.toUpperCase()} ═══`, ''];

  for (const entry of major) {
    if (entry.eventType === 'election') {
      const councilNames = entry.actors.filter(a => a.role === 'council').map(a => a.name).join(', ');
      lines.push(`── Day ${entry.tick}: ELECTION ──`);
      lines.push(`   Council: ${councilNames}`);
    } else if (entry.eventType === 'founding') {
      lines.push(`── Day ${entry.tick}: FOUNDING ──`);
      lines.push(`   ${settlement.name} established.`);
    } else if (entry.eventType === 'coup') {
      lines.push(`── Day ${entry.tick}: COUP ──`);
      lines.push(`   ${entry.outcome}`);
    } else if (entry.eventType === 'succession') {
      lines.push(`── Day ${entry.tick}: SUCCESSION ──`);
      lines.push(`   ${entry.outcome}`);
    } else if (entry.eventType === 'crisis') {
      lines.push(`   ⚠ Day ${entry.tick}: Treasury crisis`);
    } else if (entry.eventType === 'relief') {
      lines.push(`   ♥ Day ${entry.tick}: Emergency relief distributed`);
    } else if (entry.eventType === 'emigration') {
      lines.push(`   ← Day ${entry.tick}: ${entry.actors[0]?.name || '?'} emigrated`);
    } else if (entry.eventType === 'immigration') {
      lines.push(`   → Day ${entry.tick}: ${entry.actors[0]?.name || '?'} immigrated`);
    } else if (entry.eventType === 'trade') {
      lines.push(`   ⇄ Day ${entry.tick}: ${entry.outcome}`);
    } else if (entry.eventType === 'bankruptcy') {
      lines.push(`   ✗ Day ${entry.tick}: ${entry.actors[0]?.name || '?'} went bankrupt`);
    }
  }

  lines.push('');
  lines.push(`${major.length} significant events.`);
  return lines.join('\n');
}

module.exports = {
  narrateEntry, formatNewspaper, formatTalk,
  formatSettlementLook, formatHistory,
};
