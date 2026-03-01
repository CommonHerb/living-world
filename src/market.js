'use strict';

/**
 * Phase 3: BazaarBot Market System
 * 
 * NPCs maintain price beliefs (min, max) per commodity.
 * Each tick: generate orders → double auction → update beliefs.
 * Prices EMERGE from agent interactions.
 */

const COMMODITIES = ['grain', 'flour', 'wood', 'stone', 'tools'];

const COMMODITY_INFO = {
  grain:  { producedBy: 'farmer',     baseProduction: 3 },
  flour:  { producedBy: 'miller',     baseProduction: 0 },  // miller converts grain→flour
  wood:   { producedBy: 'woodcutter', baseProduction: 2 },
  stone:  { producedBy: 'miner',      baseProduction: 2 },
  tools:  { producedBy: 'smith',      baseProduction: 0 },  // smith converts wood+stone→tools
};

// BazaarBot tuning constants
const LEARNING_RATE = 0.1;
const WIDEN_RATE = 0.1;
const SHIFT_RATE = 0.25;
const MIN_SPREAD = 0.1;
const PRICE_HISTORY_LENGTH = 10;

// Default ideal inventories per job
const IDEAL_INVENTORY = {
  farmer:     { grain: 4, flour: 2, wood: 1, stone: 0, tools: 1 },
  miller:     { grain: 4, flour: 3, wood: 1, stone: 0, tools: 1 },
  guard:      { grain: 3, flour: 2, wood: 0, stone: 0, tools: 0 },
  woodcutter: { grain: 3, flour: 2, wood: 2, stone: 0, tools: 1 },
  miner:      { grain: 3, flour: 2, wood: 0, stone: 1, tools: 1 },
  smith:      { grain: 3, flour: 2, wood: 3, stone: 3, tools: 1 },
};

// Default initial price beliefs by job (producers value their good lower)
const INITIAL_BELIEFS = {
  grain: { low: 0.5, high: 3.0 },
  flour: { low: 1.0, high: 5.0 },
  wood:  { low: 0.5, high: 3.0 },
  stone: { low: 0.5, high: 3.0 },
  tools: { low: 2.0, high: 8.0 },
};

function initMarket() {
  const market = {
    lastClearingPrices: {},
    lastTradeVolume: {},
    priceHistory: {},
    tradeLog: [],  // recent trades for display
  };
  for (const c of COMMODITIES) {
    market.lastClearingPrices[c] = null;
    market.lastTradeVolume[c] = 0;
    market.priceHistory[c] = [];
  }
  return market;
}

function initNPCMarketData(npc, rng) {
  npc.gold = 30;
  npc.inventory = {};
  npc.idealInventory = {};
  npc.priceBeliefs = {};

  const ideal = IDEAL_INVENTORY[npc.job] || IDEAL_INVENTORY.guard;
  for (const c of COMMODITIES) {
    npc.inventory[c] = 0;
    npc.idealInventory[c] = ideal[c] || 0;

    // Initial beliefs: spread based on risk tolerance (risk-tolerant = narrower)
    const base = INITIAL_BELIEFS[c];
    const spread = (base.high - base.low) * (1.2 - npc.genome.riskTolerance * 0.4);
    const mid = (base.low + base.high) / 2;
    npc.priceBeliefs[c] = {
      low: Math.max(0.01, mid - spread / 2 + rng.float(-0.3, 0.3)),
      high: mid + spread / 2 + rng.float(-0.3, 0.3),
    };
  }

  // Give starting inventory based on job
  // Everyone starts with some food to survive early market formation
  npc.inventory.grain = 8;
  if (npc.job === 'farmer') npc.inventory.grain = 12;
  else if (npc.job === 'miller') { npc.inventory.grain = 6; npc.inventory.flour = 2; }
  else if (npc.job === 'woodcutter') npc.inventory.wood = 3;
  else if (npc.job === 'miner') npc.inventory.stone = 3;
  else if (npc.job === 'smith') npc.inventory.tools = 2;
}

/**
 * Step 1: Generate buy/sell orders from NPC beliefs
 */
function generateOrders(world) {
  const rng = world.tickRng;
  const bids = [];
  const asks = [];

  for (const npc of world.npcs) {
    for (const commodity of COMMODITIES) {
      const belief = npc.priceBeliefs[commodity];
      if (!belief) continue;

      const deficit = npc.idealInventory[commodity] - npc.inventory[commodity];

      if (deficit > 0) {
        // Want to BUY
        let quantity = deficit;
        const price = rng.float(belief.low, belief.high);

        // Favorability adjustment
        const history = world.market.priceHistory[commodity];
        if (history.length > 0) {
          const observedMean = history.slice(-5).reduce((a, b) => a + b, 0) / Math.min(5, history.length);
          const range = belief.high - belief.low;
          if (range > 0) {
            const position = (price - belief.low) / range;
            quantity = Math.max(1, Math.round(quantity * (1 - position) * 2));
          }
        }

        // Can they afford it?
        if (npc.gold >= price) {
          bids.push({ npc, commodity, quantity, price });
        }
      } else if (deficit < 0) {
        // Want to SELL
        let quantity = Math.abs(deficit);
        const price = rng.float(belief.low, belief.high);

        // Favorability: sell more when price is high in range
        const history = world.market.priceHistory[commodity];
        if (history.length > 0) {
          const range = belief.high - belief.low;
          if (range > 0) {
            const position = (price - belief.low) / range;
            quantity = Math.max(1, Math.round(quantity * position * 2));
          }
        }

        // Do they have goods to sell?
        quantity = Math.min(quantity, npc.inventory[commodity]);
        if (quantity > 0) {
          asks.push({ npc, commodity, quantity, price });
        }
      }
    }
  }

  return { bids, asks };
}

/**
 * Step 2: Double auction clearing
 */
function clearMarket(world, bids, asks) {
  const rng = world.tickRng;
  const results = [];  // { buyer, seller, commodity, quantity, price }
  const failures = { bids: [], asks: [] };

  for (const commodity of COMMODITIES) {
    const cBids = bids.filter(b => b.commodity === commodity);
    const cAsks = asks.filter(a => a.commodity === commodity);

    rng.shuffle(cBids);
    rng.shuffle(cAsks);
    cBids.sort((a, b) => b.price - a.price);   // highest bid first
    cAsks.sort((a, b) => a.price - b.price);    // lowest ask first

    let bi = 0, ai = 0;
    while (bi < cBids.length && ai < cAsks.length) {
      const bid = cBids[bi];
      const ask = cAsks[ai];

      if (bid.price >= ask.price && bid.npc.id !== ask.npc.id) {
        const clearingPrice = (bid.price + ask.price) / 2;
        const tradeQty = Math.min(bid.quantity, ask.quantity);
        const totalCost = clearingPrice * tradeQty;
        const tax = totalCost * world.taxRate;

        // Check buyer can afford
        if (bid.npc.gold < totalCost) {
          bi++;
          continue;
        }

        // Execute trade
        bid.npc.gold -= totalCost;
        ask.npc.gold += totalCost - tax;
        world.treasury += tax;
        bid.npc.inventory[commodity] += tradeQty;
        ask.npc.inventory[commodity] -= tradeQty;

        results.push({
          buyer: bid.npc,
          seller: ask.npc,
          commodity,
          quantity: tradeQty,
          price: clearingPrice,
          tax,
        });

        bid.quantity -= tradeQty;
        ask.quantity -= tradeQty;
        if (bid.quantity <= 0) bi++;
        if (ask.quantity <= 0) ai++;
      } else {
        break;
      }
    }

    // Record failures
    for (let i = bi; i < cBids.length; i++) {
      if (cBids[i].quantity > 0) failures.bids.push(cBids[i]);
    }
    for (let i = ai; i < cAsks.length; i++) {
      if (cAsks[i].quantity > 0) failures.asks.push(cAsks[i]);
    }

    // Update price history
    const commodityTrades = results.filter(r => r.commodity === commodity);
    if (commodityTrades.length > 0) {
      const avgPrice = commodityTrades.reduce((s, t) => s + t.price, 0) / commodityTrades.length;
      world.market.lastClearingPrices[commodity] = avgPrice;
      world.market.lastTradeVolume[commodity] = commodityTrades.reduce((s, t) => s + t.quantity, 0);
      world.market.priceHistory[commodity].push(avgPrice);
      if (world.market.priceHistory[commodity].length > PRICE_HISTORY_LENGTH) {
        world.market.priceHistory[commodity].shift();
      }
    } else {
      world.market.lastTradeVolume[commodity] = 0;
    }
  }

  world.market.tradeLog = results.slice(-20);
  return { results, failures };
}

/**
 * Step 3: Update beliefs based on trade outcomes
 */
function updateBeliefs(world, tradeResults, failures) {
  const { results } = tradeResults;

  // Track which NPCs traded successfully per commodity
  const successfulTraders = new Map();  // npcId-commodity → clearingPrice
  for (const trade of results) {
    const bKey = `${trade.buyer.id}-${trade.commodity}`;
    const sKey = `${trade.seller.id}-${trade.commodity}`;
    successfulTraders.set(bKey, trade.price);
    successfulTraders.set(sKey, trade.price);
  }

  // Track failures
  const failedTraders = new Set();
  for (const bid of failures.bids) {
    failedTraders.add(`${bid.npc.id}-${bid.commodity}`);
  }
  for (const ask of failures.asks) {
    failedTraders.add(`${ask.npc.id}-${ask.commodity}`);
  }

  // Update beliefs for all participants
  for (const npc of world.npcs) {
    for (const commodity of COMMODITIES) {
      const key = `${npc.id}-${commodity}`;
      const belief = npc.priceBeliefs[commodity];
      if (!belief) continue;

      if (successfulTraders.has(key)) {
        // SUCCESS: narrow toward clearing price
        const clearingPrice = successfulTraders.get(key);
        belief.low += LEARNING_RATE * (clearingPrice - belief.low);
        belief.high -= LEARNING_RATE * (belief.high - clearingPrice);

        // Ensure minimum spread
        const mean = (belief.low + belief.high) / 2;
        if ((belief.high - belief.low) < MIN_SPREAD) {
          belief.low = mean - MIN_SPREAD / 2;
          belief.high = mean + MIN_SPREAD / 2;
        }
      } else if (failedTraders.has(key)) {
        // FAILURE: widen and shift toward market average
        const spread = belief.high - belief.low;
        belief.low -= WIDEN_RATE * spread;
        belief.high += WIDEN_RATE * spread;

        // Shift toward market consensus
        const marketAvg = world.market.lastClearingPrices[commodity];
        if (marketAvg !== null) {
          const mean = (belief.low + belief.high) / 2;
          const shift = SHIFT_RATE * (marketAvg - mean);
          belief.low += shift;
          belief.high += shift;
        }

        // Floor
        belief.low = Math.max(0.01, belief.low);
      }
    }
  }
}

/**
 * Step 4: Handle bankruptcy — role switch
 */
function handleBankruptcy(world) {
  const rng = world.tickRng;
  const bankruptcies = [];

  for (const npc of world.npcs) {
    if (npc.job === 'guard') continue;  // guards paid by treasury

    const totalInventory = COMMODITIES.reduce((s, c) => s + npc.inventory[c], 0);
    if (npc.gold <= 0 && totalInventory === 0) {
      // Bankrupt! Switch to most profitable job
      const jobWealth = {};
      for (const other of world.npcs) {
        if (!jobWealth[other.job]) jobWealth[other.job] = [];
        jobWealth[other.job].push(other.gold);
      }
      let bestJob = npc.job;
      let bestAvg = -Infinity;
      for (const [job, golds] of Object.entries(jobWealth)) {
        if (job === 'guard') continue;
        const avg = golds.reduce((a, b) => a + b, 0) / golds.length;
        if (avg > bestAvg) { bestAvg = avg; bestJob = job; }
      }

      const oldJob = npc.job;
      if (bestJob !== npc.job) {
        npc.job = bestJob;
        // Copy beliefs from a successful agent of same job
        const mentor = world.npcs.find(n => n.job === bestJob && n.gold > 5 && n.id !== npc.id);
        if (mentor) {
          for (const c of COMMODITIES) {
            npc.priceBeliefs[c] = { ...mentor.priceBeliefs[c] };
          }
        }
        // Update ideal inventory
        const ideal = IDEAL_INVENTORY[bestJob] || IDEAL_INVENTORY.guard;
        for (const c of COMMODITIES) {
          npc.idealInventory[c] = ideal[c] || 0;
        }
      }

      // Restart stipend from treasury
      const stipend = Math.min(5, world.treasury);
      world.treasury -= stipend;
      npc.gold = stipend;

      bankruptcies.push({ npc, oldJob, newJob: npc.job });
    }
  }

  return bankruptcies;
}

/**
 * Governance shock: if tax rate changed significantly, widen all beliefs
 */
function governanceShock(world, oldTaxRate) {
  if (Math.abs(world.taxRate - oldTaxRate) > 0.1) {
    for (const npc of world.npcs) {
      for (const commodity of COMMODITIES) {
        const belief = npc.priceBeliefs[commodity];
        const spread = belief.high - belief.low;
        belief.high += spread * 0.3;
        belief.low -= spread * 0.1;
        belief.low = Math.max(0.01, belief.low);
      }
    }
  }
}

module.exports = {
  COMMODITIES, COMMODITY_INFO, IDEAL_INVENTORY,
  initMarket, initNPCMarketData,
  generateOrders, clearMarket, updateBeliefs,
  handleBankruptcy, governanceShock,
  LEARNING_RATE, WIDEN_RATE, SHIFT_RATE, MIN_SPREAD,
};
