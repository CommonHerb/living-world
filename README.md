# Living World

A living political simulation that runs forever. Text-only. Simple rules, complex emergence. 25 NPCs forming governments, spreading rumors, and building a civilization — whether anyone is watching or not.

## What Is This?

**Millhaven** is a village of 25 souls. They farm, they eat, they gossip, they vote. A council of 3 sets the tax rate. Every 30 days, there's an election. Every day, opinions shift based on lived experience, whispered rumors, and the cold arithmetic of hunger.

No AI. No language models. No scripts. Just 8-parameter personality genomes, a gossip engine with fidelity decay, and the iron feedback loop:

**Economy → Opinions → Gossip → Elections → Policy → Economy**

Same seed, same history. Deterministic. Reproducible. Alive.

## Quick Start

```bash
npm install
npm start
```

Connect via WebSocket on `ws://localhost:3000`. Send commands:

| Command | Description |
|---------|-------------|
| `tick` / `t` | Advance 1 day |
| `tick 10` | Advance 10 days |
| `run` | Auto-advance (1/sec) |
| `stop` | Pause |
| `status` / `s` | Settlement overview |
| `map` | ASCII map |
| `people` / `p` | List all NPCs |
| `look <name>` | Inspect one NPC |
| `factions` | Political clusters |
| `stats` | Gini coefficient, averages |
| `history` | Recent events |
| `seed` | Current seed |
| `help` | All commands |

## The Emergent Proofs

Run 100 ticks with no input. Watch for:

1. **Emergent factions** — NPCs cluster into political groups without being assigned
2. **Gossip distortion** — NPCs hold false beliefs about tax rates
3. **Policy feedback loops** — Elections → policy → consequences → backlash elections
4. **Geographic opinion bubbles** — Proximity-based gossip creates local consensus
5. **Personality-driven behavior** — Identical conditions, different votes (genomes differ)
6. **Deterministic replay** — Same seed = identical 100-tick history

```bash
npm test  # Runs 100 ticks and verifies all proofs
```

## Architecture

```
src/
  index.js      — Entry point
  server.js     — WebSocket server, command dispatch
  world.js      — World state, tick orchestration
  npc.js        — NPC creation, genome, memory, relationships
  economy.js    — Production, consumption, taxation
  opinions.js   — Opinion update, social influence
  gossip.js     — Gossip transmission with fidelity decay
  memory.js     — Memory decay system
  politics.js   — Elections, council, faction detection
  display.js    — Text formatting, map, status displays
  rng.js        — Seeded PRNG (Mulberry32)
  names.js      — NPC name generation
```

## Dependencies

- `ws` — WebSocket server
- `better-sqlite3` — (reserved for persistence, Phase 2)

That's it. No frameworks. No LLMs. No magic.

## The Design

Each NPC has an 8-parameter genome:

| Parameter | Range | Effect |
|-----------|-------|--------|
| Vision | 1-4 | How far they see neighbors |
| Metabolism | 1-3 | Food consumed per tick |
| Risk Tolerance | 0-1 | (Future use) |
| Agreeableness | 0-1 | Susceptibility to social influence |
| Assertiveness | 0-1 | Likelihood of gossiping |
| Fairness Sensitivity | 0-1 | How much inequality bothers them |
| Stubbornness | 0-1 | Resistance to opinion change |
| Credulity | 0-1 | Believes gossip vs. skeptical |

Every tick runs 7 phases:
1. **Production** — Farmers produce, millers convert, guards draw stipends
2. **Consumption** — Everyone eats (metabolism determines how much)
3. **Opinion Update** — Wealth, neighbors, and experience shape tax sentiment
4. **Gossip** — Assertive NPCs spread memories with ±20% distortion
5. **Memory Decay** — Memories fade (~23-tick half-life)
6. **Elections** — Every 30 ticks, candidates emerge, votes are cast, policy changes
7. **Granary Check** — Low granary = crisis, high = surplus mood boost

## License

MIT
