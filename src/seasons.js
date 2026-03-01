'use strict';

/**
 * Seasons & Environmental Pressure System
 * 
 * 50 ticks = 1 year, 4 seasons of ~12-13 ticks each.
 * Seasons affect food production, mortality, and create dramatic events.
 * 
 * Random events (external shocks) happen periodically to break equilibrium.
 */

const { formMemory } = require('./memory');
const { recordEvent } = require('./chronicle');

// Season definitions
const SEASON_LENGTH = 12; // ~12 ticks per season
const YEAR_LENGTH = 50;

function getSeason(tick) {
  const dayOfYear = tick % YEAR_LENGTH;
  if (dayOfYear < SEASON_LENGTH) return 'spring';
  if (dayOfYear < SEASON_LENGTH * 2) return 'summer';
  if (dayOfYear < SEASON_LENGTH * 3) return 'autumn';
  return 'winter';
}

function getYear(tick) {
  return Math.floor(tick / YEAR_LENGTH);
}

function getSeasonEmoji(season) {
  return { spring: '🌱', summer: '☀️', autumn: '🍂', winter: '❄️' }[season] || '🌍';
}

/**
 * Apply seasonal effects to a settlement each tick.
 * Returns a food production multiplier and any events.
 */
function tickSeasons(settlement, tick) {
  const rng = settlement.tickRng;
  const season = getSeason(tick);
  const prevSeason = getSeason(tick - 1);
  const year = getYear(tick);
  const living = settlement.npcs.filter(n => n.alive !== false && !n.isChild);

  // Track current season on settlement
  settlement.season = season;
  settlement.year = year;

  // Announce season change
  if (season !== prevSeason && tick > 1) {
    const emoji = getSeasonEmoji(season);
    settlement.events.push({
      tick,
      type: 'season_change',
      text: `${emoji} ${season.toUpperCase()} has arrived in ${settlement.name} (Year ${year + 1}).`,
    });
    if (settlement.chronicle) {
      recordEvent(settlement.chronicle, tick, 'season_change',
        [{ id: -1, name: settlement.name, role: 'settlement' }],
        `${season.charAt(0).toUpperCase() + season.slice(1)} arrives in Year ${year + 1}.`,
        { affectsAll: true }
      );
    }
  }

  // Initialize yearly state tracking
  if (!settlement._yearlyState) settlement._yearlyState = {};
  const yearKey = `y${year}`;
  if (!settlement._yearlyState[yearKey]) {
    settlement._yearlyState[yearKey] = {
      drought: false,
      harshWinter: false,
      goodHarvest: false,
      eventFired: false,
    };
    // Roll yearly events at start of year
    const ys = settlement._yearlyState[yearKey];
    ys.drought = rng.random() < 0.05;           // 5% drought
    ys.harshWinter = rng.random() < 0.10;       // 10% harsh winter
    ys.goodHarvest = rng.random() < 0.15;       // 15% good harvest year
    
    // Clean old yearly states
    const oldKey = `y${year - 3}`;
    delete settlement._yearlyState[oldKey];
  }

  const ys = settlement._yearlyState[yearKey];

  // === SEASONAL FOOD PRODUCTION MULTIPLIER ===
  let foodMultiplier = 1.0;
  switch (season) {
    case 'spring': foodMultiplier = 1.1; break;  // planting, mild boost
    case 'summer': foodMultiplier = 1.3; break;  // peak production
    case 'autumn': foodMultiplier = 1.0; break;  // harvest tapering
    case 'winter': foodMultiplier = 0.4; break;  // harsh reduction
  }

  // Drought: affects spring/summer/autumn
  if (ys.drought && season !== 'winter') {
    foodMultiplier *= 0.5;
    if (season === 'summer' && !ys._droughtAnnounced) {
      ys._droughtAnnounced = true;
      settlement.events.push({
        tick, type: 'drought',
        text: `☠️ DROUGHT! The rains have failed. Crops wither in ${settlement.name}.`,
      });
      if (settlement.chronicle) {
        recordEvent(settlement.chronicle, tick, 'drought',
          [{ id: -1, name: settlement.name, role: 'settlement' }],
          `A devastating drought strikes ${settlement.name}. Crops fail across the fields.`,
          { affectsAll: true, affectedCount: living.length, crisisLevel: 3 }
        );
      }
      for (const npc of living) {
        formMemory(npc, 'drought', settlement.name, 0, -0.8, tick);
      }
    }
  }

  // Good harvest year: boost spring/summer/autumn
  if (ys.goodHarvest && season !== 'winter') {
    foodMultiplier *= 1.4;
    if (season === 'summer' && !ys._goodHarvestAnnounced) {
      ys._goodHarvestAnnounced = true;
      settlement.events.push({
        tick, type: 'bountiful_year',
        text: `🌾 BOUNTIFUL YEAR! The harvests overflow in ${settlement.name}.`,
      });
      if (settlement.chronicle) {
        recordEvent(settlement.chronicle, tick, 'bountiful_year',
          [{ id: -1, name: settlement.name, role: 'settlement' }],
          `An extraordinarily bountiful year blesses ${settlement.name}.`,
          { affectsAll: true, affectedCount: living.length }
        );
      }
      for (const npc of living) {
        formMemory(npc, 'bountiful_year', settlement.name, 0, 0.7, tick);
      }
    }
  }

  // Harsh winter: kill NPCs, reduce satisfaction
  if (ys.harshWinter && season === 'winter') {
    if (!ys._harshWinterAnnounced) {
      ys._harshWinterAnnounced = true;
      settlement.events.push({
        tick, type: 'harsh_winter',
        text: `🥶 HARSH WINTER descends on ${settlement.name}! The cold is merciless.`,
      });
      if (settlement.chronicle) {
        recordEvent(settlement.chronicle, tick, 'harsh_winter',
          [{ id: -1, name: settlement.name, role: 'settlement' }],
          `A brutal winter grips ${settlement.name}. Many may not survive.`,
          { affectsAll: true, affectedCount: living.length, crisisLevel: 2 }
        );
      }
      for (const npc of living) {
        formMemory(npc, 'harsh_winter', settlement.name, 0, -0.7, tick);
      }
    }
    
    // Each tick of harsh winter: chance to kill weak/old/poor NPCs
    foodMultiplier *= 0.3; // stacks with normal winter
    for (const npc of living) {
      if (living.filter(n => n.alive !== false).length <= 5) break; // don't kill below minimum
      const food = (npc.inventory.grain || 0) + (npc.inventory.flour || 0);
      const ageRatio = npc.age / npc.lifespan;
      // Vulnerable: old, hungry, poor
      const vulnerability = (ageRatio > 0.7 ? 0.03 : 0.005) + (food < 1 ? 0.02 : 0) + (npc.gold < 1 ? 0.01 : 0);
      if (rng.random() < vulnerability) {
        npc.alive = false;
        settlement.events.push({
          tick, type: 'winter_death',
          text: `💀 ${npc.name} perished in the harsh winter.`,
        });
        if (settlement.chronicle) {
          recordEvent(settlement.chronicle, tick, 'winter_death',
            [{ id: npc.id, name: npc.name, role: 'victim' }],
            `${npc.name} died from the brutal cold of winter.`,
            { affectedCount: 1, crisisLevel: 1 }
          );
        }
        // Nearby NPCs get grief memories
        for (const other of living) {
          if (other.id === npc.id || other.alive === false) continue;
          const rel = other.relationships[npc.id];
          if (rel && (rel.trust > 0.1 || rel.affinity > 0.1)) {
            formMemory(other, 'winter_death', npc.name, 0, -0.6, tick);
          }
        }
      }
    }
    // Everyone suffers
    for (const npc of living) {
      if (npc.alive === false) continue;
      npc.opinions.satisfaction = Math.max(-1, npc.opinions.satisfaction - 0.03);
    }
  }

  // Store multiplier for economy to use
  settlement.foodMultiplier = foodMultiplier;
}

// === RANDOM WORLD EVENTS (External Shocks) ===

const RANDOM_EVENTS = [
  {
    id: 'plague',
    name: 'Plague',
    weight: 1,
    minPop: 8,
    apply(settlement, tick, rng) {
      const living = settlement.npcs.filter(n => n.alive !== false && !n.isChild);
      const victims = [];
      for (const npc of living) {
        if (living.filter(n => n.alive !== false).length <= 5) break;
        if (rng.random() < 0.15) { // 15% chance per NPC
          npc.alive = false;
          victims.push(npc);
        }
      }
      for (const npc of settlement.npcs.filter(n => n.alive !== false && !n.isChild)) {
        formMemory(npc, 'plague', settlement.name, victims.length, -0.9, tick);
      }
      return {
        text: `🦠 PLAGUE strikes ${settlement.name}! ${victims.length} souls perished: ${victims.map(v => v.name).join(', ')}.`,
        chronicle: `A devastating plague swept through ${settlement.name}, killing ${victims.length} people.`,
        crisisLevel: 3,
      };
    },
  },
  {
    id: 'discovery',
    name: 'Resource Discovery',
    weight: 2,
    minPop: 3,
    apply(settlement, tick, rng) {
      const resources = ['gold vein', 'iron deposit', 'fertile valley', 'clay pit', 'herb grove'];
      const resource = resources[rng.int(0, resources.length - 1)];
      const bonus = rng.int(30, 80);
      settlement.treasury += bonus;
      for (const npc of settlement.npcs.filter(n => n.alive !== false && !n.isChild)) {
        npc.gold += rng.int(2, 5);
        formMemory(npc, 'discovery', resource, bonus, 0.8, tick);
      }
      return {
        text: `⛏️ DISCOVERY! A ${resource} found near ${settlement.name}! Treasury gains ${bonus}g.`,
        chronicle: `A ${resource} was discovered near ${settlement.name}, bringing sudden wealth.`,
        crisisLevel: 0,
      };
    },
  },
  {
    id: 'flood',
    name: 'Flood',
    weight: 1,
    minPop: 3,
    apply(settlement, tick, rng) {
      const living = settlement.npcs.filter(n => n.alive !== false && !n.isChild);
      // Destroy stored grain
      let grainLost = 0;
      for (const npc of living) {
        const lost = Math.floor((npc.inventory.grain || 0) * 0.6);
        npc.inventory.grain = (npc.inventory.grain || 0) - lost;
        grainLost += lost;
      }
      const granaryLost = Math.floor((settlement.granary || 0) * 0.4);
      settlement.granary = (settlement.granary || 0) - granaryLost;
      for (const npc of living) {
        formMemory(npc, 'flood', settlement.name, grainLost, -0.7, tick);
      }
      return {
        text: `🌊 FLOOD! Waters surge through ${settlement.name}. ${grainLost + granaryLost} grain destroyed.`,
        chronicle: `A catastrophic flood destroyed food stores in ${settlement.name}.`,
        crisisLevel: 2,
      };
    },
  },
  {
    id: 'prophet',
    name: 'Charismatic Prophet',
    weight: 1,
    minPop: 5,
    apply(settlement, tick, rng) {
      const living = settlement.npcs.filter(n => n.alive !== false && !n.isChild);
      // Pick the most assertive non-priest NPC
      const sorted = [...living].sort((a, b) => b.genome.assertiveness - a.genome.assertiveness);
      const prophet = sorted.find(n => 
        !settlement.religion?.priests?.includes(n.id)
      ) || sorted[0];
      
      // Prophet shifts opinions dramatically
      for (const npc of living) {
        const influence = rng.random() * prophet.genome.assertiveness * npc.genome.credulity;
        if (influence > 0.3) {
          npc.opinions.taxSentiment += (rng.random() - 0.5) * 0.4;
          npc.opinions.leaderApproval += (rng.random() - 0.5) * 0.3;
          formMemory(npc, 'prophet', prophet.name, 0, rng.random() > 0.5 ? 0.6 : -0.4, tick);
        }
      }
      return {
        text: `🔮 PROPHET! ${prophet.name} begins preaching radical ideas in ${settlement.name}!`,
        chronicle: `${prophet.name} emerged as a charismatic prophet, dividing opinion in ${settlement.name}.`,
        crisisLevel: 1,
      };
    },
  },
  {
    id: 'raid',
    name: 'Bandit Raid',
    weight: 2,
    minPop: 5,
    apply(settlement, tick, rng) {
      const living = settlement.npcs.filter(n => n.alive !== false && !n.isChild);
      const guards = living.filter(n => n.job === 'guard');
      const stolen = guards.length >= 3 ? rng.int(5, 15) : rng.int(20, 60);
      settlement.treasury = Math.max(0, settlement.treasury - stolen);
      
      // May kill a guard
      if (guards.length > 0 && rng.random() < 0.2) {
        const victim = guards[rng.int(0, guards.length - 1)];
        if (living.length > 5) {
          victim.alive = false;
          settlement.events.push({
            tick, type: 'raid_death',
            text: `⚔️ ${victim.name} fell defending ${settlement.name} from raiders.`,
          });
        }
      }
      
      for (const npc of living.filter(n => n.alive !== false)) {
        formMemory(npc, 'raid', 'bandits', stolen, -0.7, tick);
      }
      
      // Create political pressure for defense spending
      if (!settlement._politicalIssues) settlement._politicalIssues = [];
      if (!settlement._politicalIssues.includes('defense')) {
        settlement._politicalIssues.push('defense');
      }
      
      return {
        text: `⚔️ RAID! Bandits attack ${settlement.name}! ${stolen}g stolen from treasury.`,
        chronicle: `Bandits raided ${settlement.name}, stealing ${stolen} gold. ${guards.length} guards defended.`,
        crisisLevel: 2,
      };
    },
  },
  {
    id: 'traders',
    name: 'Traveling Traders',
    weight: 2,
    minPop: 3,
    apply(settlement, tick, rng) {
      const living = settlement.npcs.filter(n => n.alive !== false && !n.isChild);
      const goods = rng.int(10, 25);
      for (const npc of living) {
        const commodity = ['grain', 'flour', 'wood', 'tools'][rng.int(0, 3)];
        npc.inventory[commodity] = (npc.inventory[commodity] || 0) + rng.int(1, 3);
      }
      for (const npc of living) {
        formMemory(npc, 'traders', 'foreigners', goods, 0.5, tick);
      }
      return {
        text: `🐫 TRADERS arrive in ${settlement.name}! Foreign goods flood the market.`,
        chronicle: `Traveling merchants visited ${settlement.name}, bringing exotic wares.`,
        crisisLevel: 0,
      };
    },
  },
  {
    id: 'fire',
    name: 'Settlement Fire',
    weight: 1,
    minPop: 5,
    apply(settlement, tick, rng) {
      const living = settlement.npcs.filter(n => n.alive !== false && !n.isChild);
      // Destroy wood and tools
      let woodLost = 0;
      for (const npc of living) {
        const lost = Math.floor((npc.inventory.wood || 0) * 0.7);
        npc.inventory.wood = (npc.inventory.wood || 0) - lost;
        const toolsLost = Math.floor((npc.inventory.tools || 0) * 0.5);
        npc.inventory.tools = (npc.inventory.tools || 0) - toolsLost;
        woodLost += lost;
      }
      for (const npc of living) {
        formMemory(npc, 'fire', settlement.name, woodLost, -0.6, tick);
      }
      return {
        text: `🔥 FIRE sweeps through ${settlement.name}! Wood stores and tools destroyed.`,
        chronicle: `A devastating fire tore through ${settlement.name}, destroying supplies.`,
        crisisLevel: 2,
      };
    },
  },
];

/**
 * Check and apply random world events.
 * Called once per tick per settlement.
 * Events happen every 50-100 ticks per settlement.
 */
function tickRandomEvents(settlement, tick) {
  if (!settlement._nextEventTick) {
    settlement._nextEventTick = tick + 50 + Math.floor(settlement.tickRng.random() * 50);
  }
  
  if (tick < settlement._nextEventTick) return;
  
  const rng = settlement.tickRng;
  const living = settlement.npcs.filter(n => n.alive !== false && !n.isChild);
  
  // Filter eligible events
  const eligible = RANDOM_EVENTS.filter(e => living.length >= e.minPop);
  if (eligible.length === 0) return;
  
  // Weighted random selection
  const totalWeight = eligible.reduce((s, e) => s + e.weight, 0);
  let r = rng.random() * totalWeight;
  let chosen = eligible[0];
  for (const e of eligible) {
    r -= e.weight;
    if (r <= 0) { chosen = e; break; }
  }
  
  const result = chosen.apply(settlement, tick, rng);
  
  settlement.events.push({
    tick,
    type: `random_${chosen.id}`,
    text: result.text,
  });
  
  if (settlement.chronicle) {
    recordEvent(settlement.chronicle, tick, chosen.id,
      [{ id: -1, name: settlement.name, role: 'settlement' }],
      result.chronicle,
      { affectsAll: true, affectedCount: living.length, crisisLevel: result.crisisLevel }
    );
  }
  
  // Schedule next event: 50-100 ticks
  settlement._nextEventTick = tick + 50 + Math.floor(rng.random() * 50);
}

module.exports = {
  getSeason, getYear, getSeasonEmoji,
  tickSeasons, tickRandomEvents,
  SEASON_LENGTH, YEAR_LENGTH,
};
