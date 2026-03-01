# The Constitution of Cudderland

*Ratified Year 1, Month 1, Day 1 — the founding of the first settlement in the living world.*

---

## Preamble

We, the citizens of Cudderland, in order to establish just governance, ensure the common welfare, and preserve the freedom of all who dwell here, do ordain and establish this Constitution for the settlement of Cudderland.

Let it be known that this document is the supreme law of the land — no ordinance, decree, or act of any council may contradict it. What is written here was forged not in comfort but in necessity, by those who chose to build rather than wander. May it endure as long as the settlement stands.

*The Preamble is immutable. It cannot be amended by any process.*

---

## Article I: Rights of the Citizens

These rights are **meta-rules**. They constrain what any law may do. A law that violates any right listed here is automatically **void** — the HERB VM will reject it at priority 1000 before it can take effect.

**Section 1 — Freedom of Speech.** No law shall abridge the freedom of speech. Any law containing censorship provisions is void upon passage.

**Section 2 — Right to Property.** Every citizen has the right to own and hold property. No law may authorize seizure of property without due process and just compensation.

**Section 3 — Right to Vote.** Every citizen of legal standing has the right to vote in all elections. No law may disenfranchise citizens except by conviction of treason.

**Section 4 — Right to Fair Trial.** Every citizen accused of a crime has the right to a fair trial by jury. No law may authorize punishment without trial.

---

## Article II: Structure of Government

**Section 1 — Elections.** Elections shall occur every 30 ticks. When the world tick counter reaches a multiple of 30, an election is triggered automatically.

**Section 2 — Council Composition.** The Council shall consist of exactly 5 members elected by the citizens. If the Council falls below 5 members, an emergency election is triggered.

**Section 3 — Term Limits.** No citizen may serve more than 3 consecutive terms on the Council. A term-limited member is removed from the Council and must sit out at least one full term before standing for election again.

**Section 4 — Passage of Laws.** Ordinary laws pass by simple majority vote of the Council (3 of 5 or more). Proposals that fail to achieve majority are rejected.

---

## Article III: Economic Protections

**Section 1 — Maximum Tax Rate.** No tax may exceed 40% of any transaction, income, or assessed value. Any tax law setting a rate above 40% is void.

**Section 2 — Essential Services Priority.** The Treasury must fund guards and the public granary before any other expenditure. Discretionary budget items are blocked while essential services remain underfunded.

**Section 3 — Emergency Rationing.** Emergency rationing measures require a 2/3 supermajority of the Council (4 of 5 votes). A simple majority is insufficient.

---

## Article IV: Justice and Due Process

**Section 1 — Publication Requirement.** No law may be enforced until it has been published in the Chronicle. Any enforcement action against a citizen under an unpublished law is blocked.

**Section 2 — No Retroactive Laws.** No law may be applied retroactively. A law cannot punish actions taken before its passage. Any retroactive law is void.

**Section 3 — Maximum Fine.** No fine may exceed 50% of the convicted citizen's total wealth. Fines exceeding this cap are automatically reduced to the maximum.

---

## Article V: Amendment Process

**Section 1 — Preamble Protection.** The Preamble shall not be amended under any circumstances. Any amendment targeting the Preamble is void.

**Section 2 — Supermajority Requirement.** Constitutional amendments require a 2/3 supermajority of the Council (4 of 5 votes). Amendments that fail to achieve this threshold are rejected.

---

## Machine Execution

This Constitution is implemented as a set of HERB tension files that the HERB VM executes as meta-rules:

| File | Purpose | Priority |
|------|---------|----------|
| `preamble.herb.json` | Immutable preamble text | N/A (declarative) |
| `article-1-rights.herb.json` | Constitutional guards for citizen rights | 1000 |
| `article-2-government.herb.json` | Government structure and election mechanics | 800–950 |
| `article-3-economy.herb.json` | Economic constraints and spending priorities | 950–1000 |
| `article-4-justice.herb.json` | Justice system constraints | 1000 |
| `article-5-amendment.herb.json` | Amendment process rules | 900–1000 |

Constitutional tensions run at **priority 1000** (rights guards) or **950** (structural guards), ensuring they fire before any ordinary law (typically priority 10–100). This is how the Constitution constrains legislation — not by preventing the Council from voting, but by voiding any law that violates it the moment it enters the system.

---

*So it is written. So it shall execute.*
