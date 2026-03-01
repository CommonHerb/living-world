'use strict';

const { recordEvent } = require('./chronicle');
const { COMMODITIES } = require('./market');

/**
 * Inter-settlement trade routes.
 * 
 * Price differences between settlements drive trade.
 * Trade caravans buy low in one settlement, sell high in another.
 * Revenue goes to both treasuries (import/export tax).
 */

const TRADE_CHECK_INTERVAL = 5;       // check every N ticks
const MIN_PRICE_DIFF_RATIO = 1.3;     // prices must differ by 30% to trigger trade
const TRADE_VOLUME_PER_ROUTE = 3;     // units traded per commodity per route
const CARAVAN_TAX_RATE = 0.10;         // each settlement takes 10% of trade value

function tickTrade(world) {
  if (world.tick % TRADE_CHECK_INTERVAL !== 0) return;
  if (world.settlements.length < 2) return;

  const rng = world.tickRng;
  const trades = [];

  // Compare all settlement pairs
  for (let i = 0; i < world.settlements.length; i++) {
    for (let j = i + 1; j < world.settlements.length; j++) {
      const a = world.settlements[i];
      const b = world.settlements[j];

      for (const commodity of COMMODITIES) {
        const priceA = a.market.lastClearingPrices[commodity];
        const priceB = b.market.lastClearingPrices[commodity];

        if (priceA === null || priceB === null) continue;
        if (priceA <= 0 || priceB <= 0) continue;

        const ratio = Math.max(priceA, priceB) / Math.min(priceA, priceB);
        if (ratio < MIN_PRICE_DIFF_RATIO) continue;

        // Determine direction: buy from cheap, sell to expensive
        let seller, buyer;
        if (priceA < priceB) {
          seller = a;
          buyer = b;
        } else {
          seller = b;
          buyer = a;
        }

        const buyPrice = seller.market.lastClearingPrices[commodity];
        const sellPrice = buyer.market.lastClearingPrices[commodity];

        // Find sellers in cheap settlement who have surplus
        const sellerNPCs = seller.npcs.filter(n => 
          n.alive !== false && !n.isChild && 
          n.inventory[commodity] > (n.idealInventory[commodity] || 0) + 1
        );

        if (sellerNPCs.length === 0) continue;

        // Execute trade
        let totalTraded = 0;
        let totalCost = 0;

        for (const npc of sellerNPCs) {
          if (totalTraded >= TRADE_VOLUME_PER_ROUTE) break;
          const surplus = npc.inventory[commodity] - (npc.idealInventory[commodity] || 0);
          const qty = Math.min(surplus, TRADE_VOLUME_PER_ROUTE - totalTraded);
          if (qty <= 0) continue;

          const revenue = qty * sellPrice;
          const cost = qty * buyPrice;
          const profit = revenue - cost;
          const sellerTax = cost * CARAVAN_TAX_RATE;
          const buyerTax = revenue * CARAVAN_TAX_RATE;

          npc.inventory[commodity] -= qty;
          npc.gold += cost - sellerTax;  // seller gets paid at local price minus tax

          seller.treasury += sellerTax;
          buyer.treasury += buyerTax;

          // Add goods to buyer settlement's market (distribute to a needy NPC)
          const buyerNPCs = buyer.npcs.filter(n =>
            n.alive !== false && !n.isChild &&
            n.inventory[commodity] < (n.idealInventory[commodity] || 0)
          );
          if (buyerNPCs.length > 0) {
            const recipient = buyerNPCs[rng.int(0, buyerNPCs.length - 1)];
            recipient.inventory[commodity] += qty;
            recipient.gold -= Math.min(recipient.gold, revenue - buyerTax);
          }

          totalTraded += qty;
          totalCost += cost;
        }

        if (totalTraded > 0) {
          trades.push({
            commodity,
            from: seller,
            to: buyer,
            quantity: totalTraded,
            buyPrice,
            sellPrice,
          });
        }
      }
    }
  }

  // Record trade events
  for (const trade of trades) {
    const text = `Trade caravan: ${trade.quantity} ${trade.commodity} from ${trade.from.name} (${trade.buyPrice.toFixed(1)}g) to ${trade.to.name} (${trade.sellPrice.toFixed(1)}g)`;

    trade.from.events.push({ tick: world.tick, type: 'trade_export', text });
    trade.to.events.push({ tick: world.tick, type: 'trade_import', text });
    world.events.push({ tick: world.tick, type: 'trade', text });

    recordEvent(trade.from.chronicle, world.tick, 'trade',
      [{ id: -1, name: trade.to.name, role: 'trade_partner' }],
      `Exported ${trade.quantity} ${trade.commodity} to ${trade.to.name} at ${trade.buyPrice.toFixed(1)}g each.`,
      { affectedCount: 1 }
    );
    recordEvent(trade.to.chronicle, world.tick, 'trade',
      [{ id: -1, name: trade.from.name, role: 'trade_partner' }],
      `Imported ${trade.quantity} ${trade.commodity} from ${trade.from.name} at ${trade.sellPrice.toFixed(1)}g each.`,
      { affectedCount: 1 }
    );

    // Update relationship
    if (!trade.from.relationships[trade.to.id]) {
      trade.from.relationships[trade.to.id] = { trust: 0, tradeVolume: 0 };
    }
    if (!trade.to.relationships[trade.from.id]) {
      trade.to.relationships[trade.from.id] = { trust: 0, tradeVolume: 0 };
    }
    trade.from.relationships[trade.to.id].trust = Math.min(1, trade.from.relationships[trade.to.id].trust + 0.02);
    trade.from.relationships[trade.to.id].tradeVolume += trade.quantity;
    trade.to.relationships[trade.from.id].trust = Math.min(1, trade.to.relationships[trade.from.id].trust + 0.02);
    trade.to.relationships[trade.from.id].tradeVolume += trade.quantity;
  }

  return trades;
}

module.exports = { tickTrade, TRADE_CHECK_INTERVAL };
