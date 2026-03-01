'use strict';

const { generateName, FIRST_NAMES } = require('./names');
const { recordEvent } = require('./chronicle');
const { formMemory } = require('./memory');
const { initNPCMarketData } = require('./market');
const { JOBS, JOB_DISTRIBUTION } = require('./npc');

/**
 * Phase 7: Family & Birth System
 * Now operates per-settlement.
 */

const MARRIAGE_MIN_AGE = 30;
const CHILD_MATURITY_AGE = 30;
const MIN_LIFESPAN = 150;
const MAX_LIFESPAN = 250;
const BIRTH_CHANCE = 0.03;
const MUTATION_RATE = 0.10;
const MEMORY_TRANSFER_FIDELITY = 0.5;
const MAX_CHILDREN_PER_COUPLE = 4;

function assignGender(rng) {
  return rng.float(0, 1) < 0.5 ? 'male' : 'female';
}

function initFamilyData(settlement, tick) {
  const rng = settlement.rng;
  settlement.families = {};
  settlement.nextFamilyId = 1;
  if (!settlement.nextNpcId) settlement.nextNpcId = settlement.npcs.length;
  settlement.deaths = [];

  for (const npc of settlement.npcs) {
    npc.gender = assignGender(rng);
    npc.age = rng.int(30, 80);
    npc.lifespan = rng.int(MIN_LIFESPAN, MAX_LIFESPAN);
    npc.spouseId = null;
    npc.familyId = null;
    npc.childIds = [];
    npc.parentIds = [];
    npc.isChild = false;
    npc.alive = true;
    npc.birthTick = -(npc.age);
  }
}

function findMarriageCandidates(settlement, tick) {
  const eligible = settlement.npcs.filter(n =>
    n.alive && !n.isChild && n.spouseId === null &&
    (tick - n.birthTick) >= MARRIAGE_MIN_AGE
  );
  const males = eligible.filter(n => n.gender === 'male');
  const females = eligible.filter(n => n.gender === 'female');
  return { males, females };
}

function compatibilityScore(a, b, rng) {
  const traits = Object.keys(a.genome);
  let diff = 0;
  for (const t of traits) {
    if (typeof a.genome[t] === 'number' && typeof b.genome[t] === 'number') {
      diff += Math.abs(a.genome[t] - b.genome[t]);
    }
  }
  const avgDiff = diff / traits.length;
  const compatibility = 1 - Math.abs(avgDiff - 0.3) * 2;
  return Math.max(0, compatibility + rng.float(-0.2, 0.2));
}

function tickMarriage(settlement, tick) {
  const rng = settlement.tickRng;
  const { males, females } = findMarriageCandidates(settlement, tick);

  if (males.length === 0 || females.length === 0) return;

  const male = males[rng.int(0, males.length - 1)];
  let bestFemale = null;
  let bestScore = 0;

  for (const f of females) {
    const score = compatibilityScore(male, f, rng);
    if (score > bestScore) {
      bestScore = score;
      bestFemale = f;
    }
  }

  if (!bestFemale || bestScore < 0.3) return;

  const familyId = settlement.nextFamilyId++;
  male.spouseId = bestFemale.id;
  bestFemale.spouseId = male.id;
  male.familyId = familyId;
  bestFemale.familyId = familyId;

  settlement.families[familyId] = {
    id: familyId,
    spouseA: male.id,
    spouseB: bestFemale.id,
    children: [],
    formTick: tick,
  };

  recordEvent(settlement.chronicle, tick, 'marriage',
    [{ id: male.id, name: male.name, role: 'spouse' },
     { id: bestFemale.id, name: bestFemale.name, role: 'spouse' }],
    `${male.name} and ${bestFemale.name} were married on Day ${tick}.`,
    { affectedCount: 2 }
  );

  settlement.events.push({
    tick,
    type: 'marriage',
    text: `${male.name} and ${bestFemale.name} were married.`
  });
}

function crossoverGenome(parentA, parentB, rng) {
  const child = {};
  const traits = Object.keys(parentA.genome);
  for (const t of traits) {
    const a = parentA.genome[t];
    const b = parentB.genome[t];
    if (typeof a !== 'number' || typeof b !== 'number') {
      child[t] = rng.float(0, 1) < 0.5 ? a : b;
      continue;
    }
    if (rng.float(0, 1) < 0.5) {
      child[t] = rng.float(0, 1) < 0.5 ? a : b;
    } else {
      const w = rng.float(0.3, 0.7);
      child[t] = a * w + b * (1 - w);
    }
    if (rng.float(0, 1) < MUTATION_RATE) {
      child[t] += (rng.float(-1, 1)) * 0.15;
      child[t] = Math.max(0, Math.min(typeof a === 'number' && a > 2 ? 4 : 1, child[t]));
    }
  }
  return child;
}

function pickChildJob(rng) {
  const jobs = Object.entries(JOB_DISTRIBUTION);
  const total = jobs.reduce((s, [, c]) => s + c, 0);
  let r = rng.int(0, total - 1);
  for (const [job, count] of jobs) {
    r -= count;
    if (r < 0) return job;
  }
  return 'farmer';
}

function tickBirths(settlement, tick) {
  const rng = settlement.tickRng;

  for (const family of Object.values(settlement.families)) {
    const parentA = settlement.npcs.find(n => n.id === family.spouseA);
    const parentB = settlement.npcs.find(n => n.id === family.spouseB);
    if (!parentA || !parentB || !parentA.alive || !parentB.alive) continue;
    if (family.children.length >= MAX_CHILDREN_PER_COUPLE) continue;

    if (rng.float(0, 1) < BIRTH_CHANCE) {
      const childId = settlement.nextNpcId++;
      const genome = crossoverGenome(parentA, parentB, rng);
      const gender = assignGender(rng);
      const name = FIRST_NAMES[rng.int(0, FIRST_NAMES.length - 1)];

      const child = {
        id: childId,
        name,
        genome,
        gender,
        job: 'dependent',
        position: { x: parentA.position.x, y: parentA.position.y },
        wealth: 0,
        gold: 0,
        opinions: { taxSentiment: 0, leaderApproval: 0, satisfaction: 0.3 },
        memories: [],
        relationships: {},
        emotionalState: 0,
        inventory: {},
        idealInventory: {},
        priceBeliefs: {},
        age: 0,
        lifespan: rng.int(MIN_LIFESPAN, MAX_LIFESPAN),
        spouseId: null,
        familyId: family.id,
        childIds: [],
        parentIds: [parentA.id, parentB.id],
        isChild: true,
        alive: true,
        birthTick: tick,
        settlementId: settlement.id,
      };

      settlement.npcs.push(child);
      family.children.push(childId);
      parentA.childIds.push(childId);
      parentB.childIds.push(childId);

      recordEvent(settlement.chronicle, tick, 'birth',
        [{ id: childId, name, role: 'child' },
         { id: parentA.id, name: parentA.name, role: 'parent' },
         { id: parentB.id, name: parentB.name, role: 'parent' }],
        `${name} was born to ${parentA.name} and ${parentB.name} on Day ${tick}.`,
        { affectedCount: 3 }
      );

      settlement.events.push({
        tick,
        type: 'birth',
        text: `${name} was born to ${parentA.name} and ${parentB.name}.`
      });
    }
  }
}

function tickMaturation(settlement, tick) {
  for (const npc of settlement.npcs) {
    if (!npc.alive || !npc.isChild) continue;
    const age = tick - npc.birthTick;
    if (age >= CHILD_MATURITY_AGE) {
      npc.isChild = false;
      npc.job = pickChildJob(settlement.tickRng);
      npc.position = { x: settlement.tickRng.int(2, 7), y: settlement.tickRng.int(2, 7) };
      initNPCMarketData(npc, settlement.tickRng);

      settlement.events.push({
        tick,
        type: 'maturation',
        text: `${npc.name} has come of age and become a ${npc.job}.`
      });
    }
  }
}

function tickAging(settlement, tick) {
  const deaths = [];

  for (const npc of settlement.npcs) {
    if (!npc.alive) continue;
    npc.age = tick - npc.birthTick;

    if (npc.age >= npc.lifespan) {
      npc.alive = false;
      deaths.push(npc);

      const familyMembers = settlement.npcs.filter(n =>
        n.alive && n.id !== npc.id &&
        (n.parentIds.includes(npc.id) || npc.parentIds.includes(n.id) ||
         n.spouseId === npc.id)
      );

      if (familyMembers.length > 0 && npc.memories.length > 0) {
        const topMemories = npc.memories
          .sort((a, b) => (b.weight || 0) - (a.weight || 0))
          .slice(0, 5);

        for (const mem of topMemories) {
          for (const fm of familyMembers) {
            const inherited = {
              ...mem,
              weight: (mem.weight || 1) * MEMORY_TRANSFER_FIDELITY,
              source: `inherited from ${npc.name}`,
              generation: (mem.generation || 0) + 1,
            };
            fm.memories.push(inherited);
          }
        }
      }

      if (npc.spouseId !== null) {
        const spouse = settlement.npcs.find(n => n.id === npc.spouseId);
        if (spouse && spouse.alive) {
          spouse.spouseId = null;
        }
      }

      recordEvent(settlement.chronicle, tick, 'death',
        [{ id: npc.id, name: npc.name, role: 'deceased' }],
        `${npc.name} died of old age on Day ${tick}. They were ${npc.age} days old.`,
        { affectedCount: familyMembers.length + 1 }
      );

      settlement.events.push({
        tick,
        type: 'death',
        text: `${npc.name} died of old age. They were ${npc.age} days old.`
      });
    }
  }

  settlement.deaths = (settlement.deaths || []).concat(deaths);
}

function tickFamily(settlement, tick) {
  if (!settlement.families) {
    initFamilyData(settlement, tick);
  }

  tickMarriage(settlement, tick);
  tickBirths(settlement, tick);
  tickMaturation(settlement, tick);
  tickAging(settlement, tick);
}

function getLivingNPCs(settlement) {
  return settlement.npcs.filter(n => n.alive && !n.isChild);
}

module.exports = {
  tickFamily, initFamilyData, getLivingNPCs,
  assignGender, crossoverGenome,
  MARRIAGE_MIN_AGE, CHILD_MATURITY_AGE, MIN_LIFESPAN, MAX_LIFESPAN,
};
