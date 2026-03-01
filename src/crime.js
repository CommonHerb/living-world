'use strict';

const { recordEvent } = require('./chronicle');
const { formMemory } = require('./memory');
const { getRelationship, updateRelationship } = require('./npc');
const { getLivingNPCs } = require('./family');

/**
 * Crime & Conflict System
 * 
 * Social conflict only — no HP, no combat stats. Violence is implied, never mechanical.
 * 
 * Flow:
 * 1. Crime: low satisfaction + low wealth NPCs may steal
 * 2. Guards: treasury-funded, chance to catch thieves
 * 3. Trials: jury of 5, vote based on opinions
 * 4. Punishment: fine or exile
 * 5. Feuds: repeated crimes between families escalate
 * 6. Banditry: exiled NPCs raid from outside
 * 7. Militia: council vote when crime is bad
 */

// --- Constants ---
const CRIME_BASE_CHANCE = 0.02;       // base chance per tick per desperate NPC
const GUARD_CATCH_BASE = 0.3;         // base catch rate per funded guard
const GUARD_COST_PER_TICK = 0.5;      // treasury cost per guard per tick
const EXILE_DURATION = 50;            // ticks
const FEUD_THRESHOLD = 3;             // crimes between families before feud
const FEUD_CRIME_MULTIPLIER = 2.0;    // crime probability multiplier during feud
const MILITIA_CRIME_THRESHOLD = 5;    // crimes in last 30 ticks to trigger militia vote
const MILITIA_COST_PER_TICK = 1.5;    // treasury cost
const MILITIA_CRIME_REDUCTION = 0.5;  // multiplier on crime chance
const TRIAL_JURY_SIZE = 5;
const BANDIT_RAID_CHANCE = 0.04;      // per bandit per tick
const BANDIT_STEAL_AMOUNT = 3;        // gold stolen per raid

// --- Initialize crime data ---
function initCrimeData(world) {
  world.crime = {
    log: [],             // { tick, thiefId, victimId, amount, caught, trialResult }
    feuds: [],           // { familyA, familyB, incidents, startTick }
    exiles: [],          // { npcId, exileTick, returnTick }
    bandits: [],         // { npcId, exileTick }
    guardCount: 0,       // funded guard slots (NPCs with job 'guard' who are paid)
    militiaActive: false,
    militiaVoteTick: 0,
    trials: [],          // { tick, accusedId, verdict, jurorIds, votes }
    stats: {
      totalCrimes: 0,
      totalCaught: 0,
      totalExiled: 0,
      totalFines: 0,
    },
  };
}

// --- Crime probability for an NPC ---
function crimeChance(npc, world) {
  // Only desperate NPCs steal: low satisfaction AND low wealth
  const satisfaction = npc.opinions.satisfaction;
  const gold = npc.gold;

  // No crime if content and wealthy
  if (satisfaction > 0 && gold > 5) return 0;

  let chance = CRIME_BASE_CHANCE;

  // Dissatisfaction increases crime
  if (satisfaction < -0.2) chance += Math.abs(satisfaction) * 0.04;

  // Poverty increases crime
  if (gold < 3) chance += (3 - gold) * 0.01;

  // Personality: high risk tolerance + low agreeableness
  chance *= (0.5 + npc.genome.riskTolerance * 0.8);
  chance *= (1.2 - npc.genome.agreeableness * 0.6);

  // Militia reduces crime
  if (world.crime && world.crime.militiaActive) {
    chance *= MILITIA_CRIME_REDUCTION;
  }

  return Math.min(0.15, chance); // cap at 15%
}

// --- Check if two NPCs are in a feud ---
function getFeud(world, npcA, npcB) {
  if (!world.crime) return null;
  const famA = npcA.familyId;
  const famB = npcB.familyId;
  if (famA == null && famB == null) return null;

  return world.crime.feuds.find(f =>
    (f.familyA === famA && f.familyB === famB) ||
    (f.familyA === famB && f.familyB === famA) ||
    // Individual feuds (no family)
    (f.npcA === npcA.id && f.npcB === npcB.id) ||
    (f.npcA === npcB.id && f.npcB === npcA.id)
  );
}

// --- Record a crime between families for feud tracking ---
function recordCrimeBetween(world, thief, victim) {
  const famA = thief.familyId;
  const famB = victim.familyId;

  // Track by family if both have families, otherwise by individual
  let feud = getFeud(world, thief, victim);

  if (!feud) {
    feud = {
      familyA: famA,
      familyB: famB,
      npcA: famA == null ? thief.id : null,
      npcB: famB == null ? victim.id : null,
      incidents: 0,
      startTick: world.tick,
      isFeud: false,
    };
    world.crime.feuds.push(feud);
  }

  feud.incidents++;

  if (!feud.isFeud && feud.incidents >= FEUD_THRESHOLD) {
    feud.isFeud = true;

    const thiefLabel = famA != null ? `the family of ${thief.name}` : thief.name;
    const victimLabel = famB != null ? `the family of ${victim.name}` : victim.name;

    recordEvent(world.chronicle, world.tick, 'feud',
      [{ id: thief.id, name: thief.name, role: 'aggressor' },
       { id: victim.id, name: victim.name, role: 'victim' }],
      `A feud has erupted between ${thiefLabel} and ${victimLabel} after ${feud.incidents} incidents.`,
      { affectedCount: 4 }
    );

    world.events.push({
      tick: world.tick,
      type: 'feud',
      text: `⚔️ FEUD: ${thiefLabel} vs ${victimLabel} — bad blood runs deep.`,
    });
  }

  return feud;
}

// --- Theft ---
function tickCrime(world) {
  const rng = world.tickRng;
  if (!world.crime) initCrimeData(world);

  const living = getLivingNPCs(world);
  const nonExiled = living.filter(n =>
    !world.crime.exiles.some(e => e.npcId === n.id && e.returnTick > world.tick)
  );

  if (nonExiled.length < 3) return; // too few people

  // Count funded guards
  const guards = nonExiled.filter(n => n.job === 'guard');
  world.crime.guardCount = 0;
  for (const g of guards) {
    if (world.treasury >= GUARD_COST_PER_TICK) {
      world.treasury -= GUARD_COST_PER_TICK;
      world.crime.guardCount++;
    }
  }

  // Militia cost
  if (world.crime.militiaActive) {
    if (world.treasury >= MILITIA_COST_PER_TICK) {
      world.treasury -= MILITIA_COST_PER_TICK;
    } else {
      world.crime.militiaActive = false;
      world.events.push({
        tick: world.tick,
        type: 'militia_disbanded',
        text: '🛡️ The militia has been disbanded — treasury cannot afford it.',
      });
    }
  }

  // Each NPC has a chance to commit crime
  for (const npc of nonExiled) {
    if (npc.job === 'guard') continue; // guards don't steal (usually)

    let chance = crimeChance(npc, world);
    if (chance <= 0) continue;

    // Feud bonus: if in active feud, more likely to target feud rival
    const activeFeud = world.crime.feuds.find(f =>
      f.isFeud && (
        (f.familyA === npc.familyId && npc.familyId != null) ||
        (f.familyB === npc.familyId && npc.familyId != null) ||
        f.npcA === npc.id || f.npcB === npc.id
      )
    );
    if (activeFeud) chance *= FEUD_CRIME_MULTIPLIER;

    if (rng.float(0, 1) >= chance) continue;

    // Pick a victim — prefer richer NPCs, or feud targets
    let victim = null;
    if (activeFeud && rng.float(0, 1) < 0.6) {
      // Target feud rival
      const rivalFamily = activeFeud.familyA === npc.familyId ? activeFeud.familyB : activeFeud.familyA;
      const rivalNpc = activeFeud.npcA === npc.id ? activeFeud.npcB : activeFeud.npcA;
      const rivals = nonExiled.filter(n =>
        n.id !== npc.id && (
          (rivalFamily != null && n.familyId === rivalFamily) ||
          n.id === rivalNpc
        )
      );
      if (rivals.length > 0) victim = rivals[rng.int(0, rivals.length - 1)];
    }

    if (!victim) {
      // Pick random victim weighted by wealth
      const candidates = nonExiled.filter(n => n.id !== npc.id && n.gold > 1);
      if (candidates.length === 0) continue;
      // Simple weighted: richer = more likely target
      const totalGold = candidates.reduce((s, c) => s + c.gold, 0);
      let pick = rng.float(0, totalGold);
      for (const c of candidates) {
        pick -= c.gold;
        if (pick <= 0) { victim = c; break; }
      }
      if (!victim) victim = candidates[candidates.length - 1];
    }

    // Steal
    const stealAmount = Math.min(victim.gold * 0.3, rng.float(1, 4));
    if (stealAmount < 0.5) continue;

    victim.gold -= stealAmount;
    npc.gold += stealAmount;

    // Was the thief caught?
    let caught = false;
    const catchChance = world.crime.guardCount * GUARD_CATCH_BASE *
      (world.crime.militiaActive ? 1.3 : 1.0);

    if (rng.float(0, 1) < catchChance) {
      caught = true;
    }

    // Record crime
    const crimeRecord = {
      tick: world.tick,
      thiefId: npc.id,
      victimId: victim.id,
      amount: stealAmount,
      caught,
      trialResult: null,
    };
    world.crime.log.push(crimeRecord);
    world.crime.stats.totalCrimes++;
    if (caught) world.crime.stats.totalCaught++;

    // Victim remembers and hates thief
    formMemory(victim, 'robbed', npc.name, stealAmount, -0.8, world.tick);
    updateRelationship(victim, npc.id, -0.4, -0.5);

    // Thief feels guilty (maybe) based on agreeableness
    if (npc.genome.agreeableness > 0.5) {
      formMemory(npc, 'stole', victim.name, stealAmount, -0.3, world.tick);
    }

    // Track for feuds
    recordCrimeBetween(world, npc, victim);

    // Chronicle
    if (caught) {
      recordEvent(world.chronicle, world.tick, 'crime_caught',
        [{ id: npc.id, name: npc.name, role: 'thief' },
         { id: victim.id, name: victim.name, role: 'victim' }],
        `${npc.name} was caught stealing ${stealAmount.toFixed(1)}g from ${victim.name}.`,
        { affectedCount: 2 }
      );
      world.events.push({
        tick: world.tick,
        type: 'crime_caught',
        text: `🚨 ${npc.name} caught stealing from ${victim.name}! A trial will be held.`,
      });

      // Hold trial
      holdTrial(world, npc, victim, crimeRecord, rng);
    } else {
      recordEvent(world.chronicle, world.tick, 'crime',
        [{ id: npc.id, name: npc.name, role: 'thief' },
         { id: victim.id, name: victim.name, role: 'victim' }],
        `${victim.name} was robbed of ${stealAmount.toFixed(1)}g. The culprit escaped.`,
        { affectedCount: 2 }
      );
      world.events.push({
        tick: world.tick,
        type: 'crime',
        text: `💰 ${victim.name} was robbed of ${stealAmount.toFixed(1)}g. No suspect found.`,
      });
    }
  }

  // Bandit raids
  tickBanditry(world, rng);

  // Return exiles
  tickExileReturn(world);

  // Trim old crime log
  if (world.crime.log.length > 100) {
    world.crime.log = world.crime.log.slice(-100);
  }
}

// --- Trial System ---
function holdTrial(world, accused, victim, crimeRecord, rng) {
  const living = getLivingNPCs(world);
  const eligible = living.filter(n =>
    n.id !== accused.id && n.id !== victim.id &&
    !world.crime.exiles.some(e => e.npcId === n.id && e.returnTick > world.tick)
  );

  if (eligible.length < TRIAL_JURY_SIZE) {
    // Not enough people for a trial — automatic guilty
    crimeRecord.trialResult = 'guilty_default';
    punish(world, accused, crimeRecord, rng);
    return;
  }

  // Select jury
  const shuffled = [...eligible].sort(() => rng.float(-1, 1));
  const jury = shuffled.slice(0, TRIAL_JURY_SIZE);

  // Each juror votes based on:
  // - Opinion of accused (relationship)
  // - Opinion of victim (relationship)
  // - Fairness sensitivity (genome)
  // - Whether they know about the crime (proximity/gossip)
  let guiltyVotes = 0;
  const votes = [];

  for (const juror of jury) {
    const relAccused = getRelationship(juror, accused.id);
    const relVictim = getRelationship(juror, victim.id);

    // Base: lean guilty (they were caught after all)
    let guiltyWeight = 0.55;

    // Trust the accused? Less likely to convict
    guiltyWeight -= relAccused.trust * 0.2;
    guiltyWeight -= relAccused.affinity * 0.15;

    // Trust the victim? More likely to convict
    guiltyWeight += relVictim.trust * 0.1;
    guiltyWeight += relVictim.affinity * 0.1;

    // High fairness sensitivity → more likely to convict (crime is wrong)
    guiltyWeight += juror.genome.fairnessSens * 0.15;

    // Agreeableness → less likely to punish harshly
    guiltyWeight -= juror.genome.agreeableness * 0.1;

    // Feud dynamics: if juror is in a feud with accused's family
    const feudWithAccused = getFeud(world, juror, accused);
    if (feudWithAccused && feudWithAccused.isFeud) {
      guiltyWeight += 0.2; // bias against feud rivals
    }

    guiltyWeight = Math.max(0.1, Math.min(0.9, guiltyWeight));

    const vote = rng.float(0, 1) < guiltyWeight ? 'guilty' : 'innocent';
    votes.push({ jurorId: juror.id, jurorName: juror.name, vote });
    if (vote === 'guilty') guiltyVotes++;
  }

  const verdict = guiltyVotes >= 3 ? 'guilty' : 'innocent';
  crimeRecord.trialResult = verdict;

  const trial = {
    tick: world.tick,
    accusedId: accused.id,
    accusedName: accused.name,
    victimId: victim.id,
    victimName: victim.name,
    verdict,
    votes,
    guiltyCount: guiltyVotes,
  };
  world.crime.trials.push(trial);

  // Chronicle
  const voteStr = `${guiltyVotes}-${TRIAL_JURY_SIZE - guiltyVotes}`;
  recordEvent(world.chronicle, world.tick, 'trial',
    [{ id: accused.id, name: accused.name, role: 'accused' },
     { id: victim.id, name: victim.name, role: 'victim' },
     ...jury.map(j => ({ id: j.id, name: j.name, role: 'juror' }))],
    `Trial of ${accused.name} for theft from ${victim.name}: ${verdict.toUpperCase()} (${voteStr}).`,
    { affectedCount: jury.length + 2 }
  );

  if (verdict === 'guilty') {
    world.events.push({
      tick: world.tick,
      type: 'trial_guilty',
      text: `⚖️ TRIAL: ${accused.name} found GUILTY of theft (${voteStr}). Punishment follows.`,
    });
    punish(world, accused, crimeRecord, rng);
  } else {
    world.events.push({
      tick: world.tick,
      type: 'trial_innocent',
      text: `⚖️ TRIAL: ${accused.name} found INNOCENT (${voteStr}). Released.`,
    });

    // Victim feels wronged — grievance
    formMemory(victim, 'unjust_acquittal', accused.name, 0, -0.6, world.tick);
    updateRelationship(victim, accused.id, -0.2, -0.3);

    // Victim also loses trust in the justice system
    for (const juror of jury) {
      if (votes.find(v => v.jurorId === juror.id).vote === 'innocent') {
        updateRelationship(victim, juror.id, -0.15, -0.1);
      }
    }
  }

  // All jurors form memory of the trial
  for (const juror of jury) {
    formMemory(juror, 'trial_juror', accused.name, 0, -0.1, world.tick);
  }

  // Trim old trials
  if (world.crime.trials.length > 50) {
    world.crime.trials = world.crime.trials.slice(-50);
  }
}

// --- Punishment ---
function punish(world, accused, crimeRecord, rng) {
  const stealAmount = crimeRecord.amount;

  // Fine or exile based on severity and repeat offenses
  const priorCrimes = world.crime.log.filter(c =>
    c.thiefId === accused.id && c.tick < world.tick
  ).length;

  if (priorCrimes >= 2 || stealAmount > 3) {
    // Exile
    exile(world, accused, rng);
  } else {
    // Fine
    const fine = Math.min(accused.gold, stealAmount * 2);
    accused.gold -= fine;
    world.treasury += fine;
    world.crime.stats.totalFines += fine;

    world.events.push({
      tick: world.tick,
      type: 'fine',
      text: `💸 ${accused.name} fined ${fine.toFixed(1)}g. Gold returned to treasury.`,
    });

    recordEvent(world.chronicle, world.tick, 'fine',
      [{ id: accused.id, name: accused.name, role: 'convict' }],
      `${accused.name} fined ${fine.toFixed(1)}g for theft.`,
      {}
    );

    formMemory(accused, 'fined', 'settlement', fine, -0.5, world.tick);
  }
}

// --- Exile ---
function exile(world, npc, rng) {
  const returnTick = world.tick + EXILE_DURATION;

  world.crime.exiles.push({
    npcId: npc.id,
    exileTick: world.tick,
    returnTick,
  });

  // Become a bandit
  world.crime.bandits.push({
    npcId: npc.id,
    exileTick: world.tick,
  });

  world.crime.stats.totalExiled++;

  // Move to edge of map
  npc.position = { x: rng.float(0, 1) < 0.5 ? -1 : 10, y: rng.int(0, 9) };

  world.events.push({
    tick: world.tick,
    type: 'exile',
    text: `🚪 ${npc.name} has been EXILED for ${EXILE_DURATION} days. They vanish into the wilds.`,
  });

  recordEvent(world.chronicle, world.tick, 'exile',
    [{ id: npc.id, name: npc.name, role: 'exile' }],
    `${npc.name} was exiled from Millhaven for ${EXILE_DURATION} days.`,
    { affectedCount: 1 }
  );

  // Exiled NPC remembers — deep grievance
  formMemory(npc, 'exiled', 'settlement', EXILE_DURATION, -0.9, world.tick);

  // Family members form grievance too
  const familyMembers = world.npcs.filter(n =>
    n.alive && n.id !== npc.id && (
      n.spouseId === npc.id ||
      n.parentIds.includes(npc.id) ||
      npc.parentIds.includes(n.id)
    )
  );
  for (const fm of familyMembers) {
    formMemory(fm, 'family_exiled', npc.name, 0, -0.6, world.tick);
  }
}

// --- Exile Return ---
function tickExileReturn(world) {
  const returning = world.crime.exiles.filter(e => e.returnTick <= world.tick);

  for (const exile of returning) {
    const npc = world.npcs.find(n => n.id === exile.npcId);
    if (!npc || !npc.alive) continue;

    // Return to settlement
    npc.position = { x: world.tickRng.int(2, 7), y: world.tickRng.int(2, 7) };

    // Remove from bandits
    world.crime.bandits = world.crime.bandits.filter(b => b.npcId !== npc.id);

    world.events.push({
      tick: world.tick,
      type: 'exile_return',
      text: `🏠 ${npc.name} has returned from exile.`,
    });

    recordEvent(world.chronicle, world.tick, 'exile_return',
      [{ id: npc.id, name: npc.name, role: 'returned' }],
      `${npc.name} returned from exile after ${EXILE_DURATION} days.`,
      {}
    );
  }

  world.crime.exiles = world.crime.exiles.filter(e => e.returnTick > world.tick);
}

// --- Banditry ---
function tickBanditry(world, rng) {
  for (const bandit of world.crime.bandits) {
    const npc = world.npcs.find(n => n.id === bandit.npcId);
    if (!npc || !npc.alive) continue;

    if (rng.float(0, 1) >= BANDIT_RAID_CHANCE) continue;

    // Raid: steal from a random settlement-edge NPC or treasury
    const edgeNpcs = getLivingNPCs(world).filter(n =>
      n.id !== npc.id &&
      !world.crime.exiles.some(e => e.npcId === n.id && e.returnTick > world.tick) &&
      (n.position.x <= 1 || n.position.x >= 8 || n.position.y <= 1 || n.position.y >= 8)
    );

    if (edgeNpcs.length === 0) {
      // Raid treasury instead
      const stolen = Math.min(world.treasury, BANDIT_STEAL_AMOUNT);
      if (stolen <= 0) continue;
      world.treasury -= stolen;
      npc.gold += stolen;

      world.events.push({
        tick: world.tick,
        type: 'bandit_raid',
        text: `🏴 Bandit ${npc.name} raided the settlement! ${stolen.toFixed(1)}g stolen from treasury.`,
      });

      recordEvent(world.chronicle, world.tick, 'bandit_raid',
        [{ id: npc.id, name: npc.name, role: 'bandit' }],
        `Bandit ${npc.name} raided Millhaven treasury for ${stolen.toFixed(1)}g.`,
        { affectedCount: 2 }
      );
    } else {
      const target = edgeNpcs[rng.int(0, edgeNpcs.length - 1)];
      const stolen = Math.min(target.gold * 0.4, BANDIT_STEAL_AMOUNT);
      if (stolen < 0.5) continue;

      target.gold -= stolen;
      npc.gold += stolen;

      updateRelationship(target, npc.id, -0.3, -0.4);
      formMemory(target, 'bandit_attack', npc.name, stolen, -0.7, world.tick);

      world.events.push({
        tick: world.tick,
        type: 'bandit_raid',
        text: `🏴 Bandit ${npc.name} ambushed ${target.name} on the settlement edge! ${stolen.toFixed(1)}g stolen.`,
      });

      recordEvent(world.chronicle, world.tick, 'bandit_raid',
        [{ id: npc.id, name: npc.name, role: 'bandit' },
         { id: target.id, name: target.name, role: 'victim' }],
        `Bandit ${npc.name} ambushed ${target.name} and stole ${stolen.toFixed(1)}g.`,
        { affectedCount: 2 }
      );
    }
  }
}

// --- Militia (council vote via HERB VM concept) ---
function tickMilitiaVote(world) {
  if (!world.crime) return;

  // Only vote every 30 ticks, and only if not already active
  if (world.crime.militiaActive) return;
  if (world.tick - world.crime.militiaVoteTick < 30) return;

  // Count recent crimes
  const recentCrimes = world.crime.log.filter(c =>
    c.tick > world.tick - 30
  ).length;

  if (recentCrimes < MILITIA_CRIME_THRESHOLD) return;

  // Council votes
  const council = world.council.map(id => world.npcs.find(n => n.id === id)).filter(Boolean);
  let yesVotes = 0;

  for (const member of council) {
    // Factors: fairness sensitivity, satisfaction, treasury health
    let voteYes = 0.5;
    voteYes += member.genome.fairnessSens * 0.2;
    voteYes -= member.opinions.satisfaction * 0.15; // unhappy → want militia
    if (world.treasury > 50) voteYes += 0.1; // can afford it
    if (world.treasury < 20) voteYes -= 0.3; // can't afford it

    if (world.tickRng.float(0, 1) < voteYes) yesVotes++;
  }

  world.crime.militiaVoteTick = world.tick;

  if (yesVotes > council.length / 2) {
    world.crime.militiaActive = true;

    world.events.push({
      tick: world.tick,
      type: 'militia_formed',
      text: `🛡️ The council has voted to form a MILITIA (${yesVotes}-${council.length - yesVotes}). Crime will be reduced.`,
    });

    recordEvent(world.chronicle, world.tick, 'militia',
      council.map(n => ({ id: n.id, name: n.name, role: 'council' })),
      `The council voted ${yesVotes}-${council.length - yesVotes} to form a militia.`,
      { affectedCount: world.npcs.length }
    );
  }
}

// --- Format crime stats for display ---
function formatCrime(world) {
  if (!world.crime) return 'No crime records exist yet.';

  const c = world.crime;
  const lines = ['═══ CRIME & JUSTICE ═══', ''];

  // Stats
  lines.push('Statistics:');
  lines.push(`  Total crimes: ${c.stats.totalCrimes}`);
  lines.push(`  Caught: ${c.stats.totalCaught} (${c.stats.totalCrimes > 0 ? Math.round(c.stats.totalCaught / c.stats.totalCrimes * 100) : 0}%)`);
  lines.push(`  Exiled: ${c.stats.totalExiled}`);
  lines.push(`  Total fines collected: ${c.stats.totalFines.toFixed(1)}g`);
  lines.push(`  Active guards: ${c.guardCount}`);
  lines.push(`  Militia: ${c.militiaActive ? 'ACTIVE' : 'inactive'}`);
  lines.push('');

  // Active feuds
  const activeFeuds = c.feuds.filter(f => f.isFeud);
  if (activeFeuds.length > 0) {
    lines.push('Active Feuds:');
    for (const f of activeFeuds) {
      const labelA = f.familyA != null
        ? `Family ${f.familyA}`
        : world.npcs.find(n => n.id === f.npcA)?.name || '?';
      const labelB = f.familyB != null
        ? `Family ${f.familyB}`
        : world.npcs.find(n => n.id === f.npcB)?.name || '?';
      lines.push(`  ⚔️ ${labelA} vs ${labelB} — ${f.incidents} incidents (since Day ${f.startTick})`);
    }
    lines.push('');
  }

  // Current exiles
  const activeExiles = c.exiles.filter(e => e.returnTick > world.tick);
  if (activeExiles.length > 0) {
    lines.push('Exiles:');
    for (const e of activeExiles) {
      const npc = world.npcs.find(n => n.id === e.npcId);
      const remaining = e.returnTick - world.tick;
      lines.push(`  🚪 ${npc ? npc.name : '?'} — returns in ${remaining} days`);
    }
    lines.push('');
  }

  // Active bandits
  if (c.bandits.length > 0) {
    lines.push('Bandits:');
    for (const b of c.bandits) {
      const npc = world.npcs.find(n => n.id === b.npcId);
      lines.push(`  🏴 ${npc ? npc.name : '?'}`);
    }
    lines.push('');
  }

  // Recent trials
  const recentTrials = c.trials.slice(-5);
  if (recentTrials.length > 0) {
    lines.push('Recent Trials:');
    for (const t of recentTrials) {
      const voteStr = `${t.guiltyCount}-${TRIAL_JURY_SIZE - t.guiltyCount}`;
      lines.push(`  Day ${t.tick}: ${t.accusedName} — ${t.verdict.toUpperCase()} (${voteStr})`);
    }
    lines.push('');
  }

  // Recent crimes
  const recentCrimes = c.log.slice(-5);
  if (recentCrimes.length > 0) {
    lines.push('Recent Crimes:');
    for (const cr of recentCrimes) {
      const thief = world.npcs.find(n => n.id === cr.thiefId);
      const victim = world.npcs.find(n => n.id === cr.victimId);
      const status = cr.caught ? (cr.trialResult || 'caught') : 'unsolved';
      lines.push(`  Day ${cr.tick}: ${thief?.name || '?'} stole ${cr.amount.toFixed(1)}g from ${victim?.name || '?'} [${status}]`);
    }
  }

  return lines.join('\n');
}

module.exports = {
  initCrimeData, tickCrime, tickMilitiaVote, formatCrime,
  crimeChance, holdTrial, exile,
  EXILE_DURATION, FEUD_THRESHOLD,
};
