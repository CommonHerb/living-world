'use strict';

const { generateName, FIRST_NAMES } = require('./names');
const { recordEvent } = require('./chronicle');
const { formMemory } = require('./memory');
const { initNPCMarketData } = require('./market');
const { JOBS, JOB_DISTRIBUTION } = require('./npc');

/**
 * Phase 7: Family & Birth System
 * 
 * Gender, marriage, children, aging, death.
 * Population grows slowly over time.
 */

// --- Constants ---
const MARRIAGE_MIN_AGE = 30;       // ticks old
const CHILD_MATURITY_AGE = 30;     // ticks as dependent before becoming adult
const MIN_LIFESPAN = 150;
const MAX_LIFESPAN = 250;
const BIRTH_CHANCE = 0.03;         // per tick per married couple
const MUTATION_RATE = 0.10;
const MEMORY_TRANSFER_FIDELITY = 0.5;
const MAX_CHILDREN_PER_COUPLE = 4;

// --- Gender Assignment ---
function assignGender(rng) {
  return rng.float(0, 1) < 0.5 ? 'male' : 'female';
}

// --- Initialize family data on existing NPCs ---
function initFamilyData(world) {
  const rng = world.rng;
  world.families = {};          // familyId -> { id, members, spouseA, spouseB }
  world.nextFamilyId = 1;
  world.nextNpcId = world.npcs.length;
  world.deaths = [];

  for (const npc of world.npcs) {
    npc.gender = assignGender(rng);
    npc.age = rng.int(30, 80);  // existing NPCs start as adults of varying age
    npc.lifespan = rng.int(MIN_LIFESPAN, MAX_LIFESPAN);
    npc.spouseId = null;
    npc.familyId = null;
    npc.childIds = [];
    npc.parentIds = [];
    npc.isChild = false;        // dependents who don't work yet
    npc.alive = true;
    npc.birthTick = -(npc.age); // virtual birth tick so age tracks correctly
  }
}

// --- Marriage ---
function findMarriageCandidates(world) {
  const eligible = world.npcs.filter(n =>
    n.alive && !n.isChild && n.spouseId === null &&
    (world.tick - n.birthTick) >= MARRIAGE_MIN_AGE
  );

  const males = eligible.filter(n => n.gender === 'male');
  const females = eligible.filter(n => n.gender === 'female');
  return { males, females };
}

function compatibilityScore(a, b, rng) {
  // Simple: genome similarity + random chemistry
  const traits = Object.keys(a.genome);
  let diff = 0;
  for (const t of traits) {
    if (typeof a.genome[t] === 'number' && typeof b.genome[t] === 'number') {
      diff += Math.abs(a.genome[t] - b.genome[t]);
    }
  }
  const avgDiff = diff / traits.length;
  // Sweet spot: some difference is good (0.2-0.4 range)
  const compatibility = 1 - Math.abs(avgDiff - 0.3) * 2;
  return Math.max(0, compatibility + rng.float(-0.2, 0.2));
}

function tickMarriage(world) {
  const rng = world.tickRng;
  const { males, females } = findMarriageCandidates(world);

  // Attempt one marriage per tick at most
  if (males.length === 0 || females.length === 0) return;

  // Pick a random male, find best compatible female
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

  // Create marriage
  const familyId = world.nextFamilyId++;
  male.spouseId = bestFemale.id;
  bestFemale.spouseId = male.id;
  male.familyId = familyId;
  bestFemale.familyId = familyId;

  world.families[familyId] = {
    id: familyId,
    spouseA: male.id,
    spouseB: bestFemale.id,
    children: [],
    formTick: world.tick,
  };

  // Chronicle
  recordEvent(world.chronicle, world.tick, 'marriage',
    [{ id: male.id, name: male.name, role: 'spouse' },
     { id: bestFemale.id, name: bestFemale.name, role: 'spouse' }],
    `${male.name} and ${bestFemale.name} were married on Day ${world.tick}.`,
    { affectedCount: 2 }
  );

  world.events.push({
    tick: world.tick,
    type: 'marriage',
    text: `${male.name} and ${bestFemale.name} were married.`
  });
}

// --- Children ---
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
    // 50% single parent, 50% blend
    if (rng.float(0, 1) < 0.5) {
      child[t] = rng.float(0, 1) < 0.5 ? a : b;
    } else {
      const w = rng.float(0.3, 0.7);
      child[t] = a * w + b * (1 - w);
    }
    // Mutation
    if (rng.float(0, 1) < MUTATION_RATE) {
      child[t] += (rng.float(-1, 1)) * 0.15;
      child[t] = Math.max(0, Math.min(typeof a === 'number' && a > 2 ? 4 : 1, child[t]));
    }
  }
  return child;
}

function pickChildJob(rng) {
  // Weighted random from job distribution
  const jobs = Object.entries(JOB_DISTRIBUTION);
  const total = jobs.reduce((s, [, c]) => s + c, 0);
  let r = rng.int(0, total - 1);
  for (const [job, count] of jobs) {
    r -= count;
    if (r < 0) return job;
  }
  return 'farmer';
}

function tickBirths(world) {
  const rng = world.tickRng;

  for (const family of Object.values(world.families)) {
    const parentA = world.npcs.find(n => n.id === family.spouseA);
    const parentB = world.npcs.find(n => n.id === family.spouseB);
    if (!parentA || !parentB || !parentA.alive || !parentB.alive) continue;
    if (family.children.length >= MAX_CHILDREN_PER_COUPLE) continue;

    if (rng.float(0, 1) < BIRTH_CHANCE) {
      const childId = world.nextNpcId++;
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
        birthTick: world.tick,
      };

      world.npcs.push(child);
      family.children.push(childId);
      parentA.childIds.push(childId);
      parentB.childIds.push(childId);

      // Chronicle
      recordEvent(world.chronicle, world.tick, 'birth',
        [{ id: childId, name, role: 'child' },
         { id: parentA.id, name: parentA.name, role: 'parent' },
         { id: parentB.id, name: parentB.name, role: 'parent' }],
        `${name} was born to ${parentA.name} and ${parentB.name} on Day ${world.tick}.`,
        { affectedCount: 3 }
      );

      world.events.push({
        tick: world.tick,
        type: 'birth',
        text: `${name} was born to ${parentA.name} and ${parentB.name}.`
      });
    }
  }
}

// --- Maturation: children become adults ---
function tickMaturation(world) {
  for (const npc of world.npcs) {
    if (!npc.alive || !npc.isChild) continue;
    const age = world.tick - npc.birthTick;
    if (age >= CHILD_MATURITY_AGE) {
      npc.isChild = false;
      npc.job = pickChildJob(world.tickRng);
      // Place in town area
      npc.position = { x: world.tickRng.int(2, 7), y: world.tickRng.int(2, 7) };
      // Initialize market data
      initNPCMarketData(npc, world.tickRng);

      world.events.push({
        tick: world.tick,
        type: 'maturation',
        text: `${npc.name} has come of age and become a ${npc.job}.`
      });
    }
  }
}

// --- Aging & Death ---
function tickAging(world) {
  const rng = world.tickRng;
  const deaths = [];

  for (const npc of world.npcs) {
    if (!npc.alive) continue;
    npc.age = world.tick - npc.birthTick;

    if (npc.age >= npc.lifespan) {
      // Death
      npc.alive = false;
      deaths.push(npc);

      // Transfer memories to family members with fidelity loss
      const familyMembers = world.npcs.filter(n =>
        n.alive && n.id !== npc.id &&
        (n.parentIds.includes(npc.id) || npc.parentIds.includes(n.id) ||
         n.spouseId === npc.id)
      );

      if (familyMembers.length > 0 && npc.memories.length > 0) {
        // Transfer top memories with degradation
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

      // Widowhood
      if (npc.spouseId !== null) {
        const spouse = world.npcs.find(n => n.id === npc.spouseId);
        if (spouse && spouse.alive) {
          spouse.spouseId = null;
        }
      }

      // Chronicle
      recordEvent(world.chronicle, world.tick, 'death',
        [{ id: npc.id, name: npc.name, role: 'deceased' }],
        `${npc.name} died of old age on Day ${world.tick}. They were ${npc.age} days old.`,
        { affectedCount: familyMembers.length + 1 }
      );

      world.events.push({
        tick: world.tick,
        type: 'death',
        text: `${npc.name} died of old age. They were ${npc.age} days old.`
      });
    }
  }

  // Remove dead NPCs from active processing (keep in array for reference but filter in economy)
  world.deaths = (world.deaths || []).concat(deaths);
}

// --- Main family tick ---
function tickFamily(world) {
  if (!world.families) {
    initFamilyData(world);
  }

  tickMarriage(world);
  tickBirths(world);
  tickMaturation(world);
  tickAging(world);
}

// --- Get living NPCs (utility for other systems) ---
function getLivingNPCs(world) {
  return world.npcs.filter(n => n.alive && !n.isChild);
}

module.exports = {
  tickFamily, initFamilyData, getLivingNPCs,
  assignGender, crossoverGenome,
  MARRIAGE_MIN_AGE, CHILD_MATURITY_AGE, MIN_LIFESPAN, MAX_LIFESPAN,
};
