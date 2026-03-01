# living-world

**A living political simulation that runs forever.**

---

## What is this?

Twenty-five people wake up in a settlement called Millhaven. They farm. They mill grain. They guard the walls. They pay taxes to a council they elected. They gossip about each other. They form opinions — not because we told them to, but because they *remember things that happened to them.*

There is no script. There is no story engine. There is no AI generating dialogue. There are just rules — small, legible rules about how people work, how food flows, how memory degrades, how rumors drift. The simulation runs, and politics *happens.* Factions form around taxation policy. Leaders rise on the back of public memory. Misinformation spreads because gossip loses fidelity with every retelling, and by the time a tax hike rumor reaches the fifth NPC, they think the council tripled the rate when it went up 5%.

This is a world that doesn't need you. You can connect, watch, poke at it. But it will keep going whether you're there or not. The NPCs don't know you exist. They're busy remembering the famine from tick 47 and deciding how to vote.

The goal is not to build a game. The goal is to build a *civilization* — one that grows, remembers, forgets, fractures, and reforms. Text-only, because text scales. Deterministic, because reproducibility matters more than spectacle. Tiny, because a world that fits in 18KB of RAM can run on anything, forever.

---

## What happens when you run it?

You start the server. Twenty-five NPCs are generated with unique genomes — eight personality traits each, ranging from greed to empathy to aggression. They're placed on a grid. The tick loop begins.

**Tick 1-10:** NPCs take jobs. Farmers grow food. Millers process it. Guards protect the settlement. The granary fills. Taxes are collected. It looks like a spreadsheet.

**Tick 10-30:** The first election happens. NPCs vote based on their opinions — which are derived from their *memories*, not dice rolls. An NPC who remembers food scarcity votes differently from one who doesn't. A council forms. Tax policy is set. Some NPCs are unhappy about it. They remember being unhappy about it.

**Tick 30-100:** Gossip starts compounding. NPC A tells NPC B about the tax hike. B tells C, but the memory loses 20% fidelity and the value drifts ±20%. By the time it reaches NPC E, the story has mutated. E is now furious about a tax policy that doesn't match reality. E votes accordingly. *Nobody lied.* The system just models how information actually degrades.

**Tick 100+:** Two political factions have crystallized — the Tillers and the Shields. They weren't designed. No one wrote `createFaction()`. They emerged from the interaction of memory, gossip, opinion formation, and elections. The simulation has produced politics from arithmetic.

Nobody designed them.

---

## The numbers

| Metric | Value |
|---|---|
| Lines of code | **1,321** |
| Source files | **13** |
| Dependencies | **2** (WebSocket + SQLite) |
| NPC state | **~720 bytes each** |
| Total world state | **~18KB** |
| Memory slots per NPC | **12** |
| Memory decay rate | **0.5% per tick** |
| Gossip fidelity loss | **~20% per hop** |
| Election cycle | **Every 30 ticks** |
| Forget threshold | **Fidelity < 0.2** |
| Target server cost | **$5/month** |

The entire simulation — every NPC, every memory, every opinion, every faction — fits in less RAM than this README.

---

## The roadmap

What's built:

- [x] **The Kernel** — 25 NPCs, economy, elections, factions, deterministic replay
- [x] **The Memory System** — Bounded memory, decay, gossip-as-memory-transmission, opinion derivation from lived experience, the Chronicle

What's next:

- [ ] **Mythology** — When memories are shared enough, they calcify into settlement-wide beliefs. The famine of tick 47 becomes "The Great Hunger." Facts become legends. Legends become identity.
- [ ] **Religion** — Shared mythology + existential pressure = belief systems. NPCs don't need gods written into the code. They need pattern-matching on suffering and deliverance.
- [ ] **Language drift** — Settlements that split carry shared vocabulary. Over time, words shift. Reunited groups find they can't quite understand each other anymore.
- [ ] **Multi-settlement** — Millhaven sends out colonists. Trade routes form. Wars happen. Diplomacy happens. Cultural exchange happens. Each settlement runs independently, interacting at the edges.
- [ ] **Civilizational cycles** — Growth, stagnation, collapse, rebirth. Not scripted. Emergent from resource pressure, institutional decay, and generational memory loss.

The long game: run it for 10,000 simulated years and find out what's universal about civilization. What patterns always emerge? What always collapses? What survives?

---

## Philosophy

**Why text?**

Every ambitious "living world" project in history made the same mistake: they tried to simulate complex social behavior *and* render it in 3D at 60fps. They fought two wars and lost both. We chose to fight one war. Text means a civilization fits in 18KB. Text means you can run a thousand settlements on a Raspberry Pi. Text means the bottleneck is the *ideas*, not the polycount.

**Why no LLMs?**

Because LLMs are expensive, nondeterministic, slow, and fragile. An LLM-driven NPC costs cents per interaction and can't be replayed. Our NPCs cost *nothing* per tick and produce the exact same history from the same seed, every time. Emergent behavior from simple rules is more interesting than scripted-sounding prose from a language model. We're not simulating *the appearance* of intelligence. We're simulating the *conditions* that produce complex social behavior.

**Why deterministic?**

Because if you can't reproduce it, you can't study it. Same seed, same world, same history. You can rewind. You can branch. You can ask "what if the tax rate had been 2% lower?" and get a real answer. This isn't a toy. It's an instrument.

---

## Try it

```bash
git clone https://github.com/CommonHerb/living-world.git
cd living-world
npm install
node src/index.js
```

Connect any WebSocket client to `ws://localhost:3000`. Type `help`.

```
> status          # Settlement overview
> tick 100        # Advance 100 ticks
> factions        # See what emerged
> look Aldric     # Read one NPC's memories, opinions, genome
> chronicle       # The history of Millhaven, as it happened
```

Or run the tests to see the proofs:

```bash
node test/run-100-ticks.js          # Phase 1: 6 structural proofs
node test/run-200-ticks-phase2.js   # Phase 2: 7 memory system proofs
```

---

## The thesis

Simple rules. Complex emergence. No AI. Just math. And time.

---

*Built by [CommonHerb](https://github.com/CommonHerb). MIT License.*
