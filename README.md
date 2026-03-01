# Living World

A deterministic social simulation — 25 NPCs, emergent politics, gossip, and memory.

## Phase 1: The Kernel ✅
- 25 NPCs with genomes (8 personality traits)
- Economic cycle: farming, milling, guarding, taxation
- Elections every 30 ticks — council sets tax rate
- Gossip spreads between NPCs
- Emergent factions (Tillers vs Shields)
- Deterministic replay via seeded RNG

## Phase 2: The Memory System ✅
- **NPC Memory** — Bounded 12-slot memory per NPC. Each memory: eventType, subject, value, fidelity (0-1), emotional valence, tick. Memories decay each tick (fidelity *= 0.995). Below 0.2 = forgotten.
- **Memory Formation** — Personal events create memories: tax changes, elections, food shortages, crises. Emotional events have higher initial fidelity.
- **Gossip Enhancement** — Gossip now transmits MEMORIES with ~20% fidelity loss per hop. Values drift ±20%. This is how misinformation emerges — no explicit lying system needed.
- **Memory-Based Opinions** — NPC opinions (tax sentiment, leader approval, satisfaction) are now DERIVED from their memories, not random walks. An NPC who remembers famine → anti-establishment opinions.
- **The Chronicle** — Append-only event log. Every significant event recorded with: tick, eventType, actors, outcome, significance (0-255). Queryable by type, actor, tick range, significance. It's the "newspaper" of the settlement.

## Running

```bash
npm install
node src/index.js          # Start WebSocket server on :3000
node test/run-100-ticks.js  # Phase 1 verification (6 proofs)
node test/run-200-ticks-phase2.js  # Phase 2 verification (7 proofs)
```

## Commands (WebSocket)

```
tick, t          Advance 1 tick
tick <n>         Advance n ticks
status, s        Settlement overview
map              ASCII map
people, p        List all NPCs
look <name>      Detailed NPC view (memories, genome, opinions)
factions         Political clusters
stats            Simulation statistics (includes memory stats)
history          Last 20 events
chronicle        The Chronicle of Millhaven
help             All commands
```

## Architecture

```
src/
  world.js       World creation + tick loop
  npc.js         NPC creation, genome, relationships
  memory.js      Phase 2: Memory system (formation, decay, opinion derivation)
  chronicle.js   Phase 2: Append-only event log
  economy.js     Production, consumption, taxation
  opinions.js    Memory-driven opinion formation + social influence
  gossip.js      Memory transmission with fidelity loss
  politics.js    Elections, granary checks, factions
  display.js     Text formatting for all views
  server.js      WebSocket server + command handler
  rng.js         Seeded PRNG
  names.js       NPC name generation
```

## Design Philosophy

From Sugarscape: simple rules, complex emergence. Each system is ~50-100 lines. The interesting behavior comes from system *interaction*:

- Tax hike → food shortage memories → negative opinions → anti-tax faction grows → election shifts council → tax lowered → positive memories → opinions stabilize
- Gossip transmits memories with drift → NPC A tells B about tax hike → B tells C with distortion → C's memory says taxes doubled when they only went up 5%

Total NPC state: ~720 bytes. 25 NPCs = ~18KB. Runs anywhere.
