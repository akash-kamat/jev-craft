<div align="center">

# ⛏️ jev-craft

### A Minecraft survival bot that thinks with [Jev](https://typesafe.ai)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green?logo=node.js)](https://nodejs.org)
[![TypeSafe](https://img.shields.io/badge/Powered%20by-TypeSafe%20Jev-6366f1)](https://typesafe.ai)
[![Mineflayer](https://img.shields.io/badge/Built%20on-Mineflayer-brightgreen)](https://github.com/PrismarineJS/mineflayer)

jev-craft is a Minecraft survival bot powered by **[Jev](https://typesafe.ai)** — [TypeSafe](https://typesafe.ai)'s [System One](https://docs.typesafe.ai/concepts/system-one) AI model — instead of hardcoded rules. It perceives the world, feels emotions, remembers the past, and makes real decisions every 600ms.

</div>

---

<!-- DEMO -->
<div align="center">

## Demo

![Demo](screenrec.mp4)

</div>

---

## Why System One models change everything

Every Minecraft bot ever built is a state machine: `if hostile nearby → flee`. That works until reality gets complicated — what if you're hungry *and* being chased *and* it's night and you just died nearby? Priorities conflict, and hardcoded rules break.

**[System One models](https://docs.typesafe.ai/concepts/system-one)** from [TypeSafe](https://typesafe.ai) are a fundamentally different kind of AI. Named after Kahneman's *Thinking, Fast and Slow*, they make **fast, structured decisions that software can use directly** — returning typed answers and calibrated probabilities instead of generating text.

| | Traditional LLMs | System One ([Jev](https://typesafe.ai)) |
|---|---|---|
| Output | Free-form text you parse | Typed values your code uses directly |
| Uncertainty | Rarely expressed | Calibrated probabilities, always |
| Latency | Seconds | ~100ms — fast enough for real-time |
| Control flow | Model drives itself (agents) | Your code drives; model supplies judgment |
| Failures | Compound across loops | Isolated to the specific question |

The key insight: **code owns the workflow, Jev supplies the common sense**. This isn't an AI agent running loose — it's a primitive you call exactly where deterministic logic falls short. Every question returns a probability distribution over your defined options, so your code can act, escalate, or fall back with full confidence information.

That's what makes jev-craft possible: a bot that reads a complex, ambiguous game situation and makes a sensible call in under 100ms — not because someone wrote every `if` branch, but because Jev understands the situation.

---

## How it uses Jev

Every reactive tick (600ms), jev-craft sends its current world state to [Jev](https://typesafe.ai) and gets back four typed answers **in a single parallel API call**:

| Question | Primitive | What it decides |
|----------|-----------|-----------------|
| `threat_level` | [`Score`](https://docs.typesafe.ai/primitives/score) (5 levels) | How dangerous is the situation right now? |
| `action` | [`Choice`](https://docs.typesafe.ai/primitives/choice) | Fight, flee, eat, work on goal, or look around |
| `should_eat` | [`Noul`](https://docs.typesafe.ai/primitives/noul) (probability) | Is now a good time to eat? |
| `flee_direction` | [`Choice`](https://docs.typesafe.ai/primitives/choice) | Which direction to run if needed |

Every tactical tick (10s), it asks Jev to pick a goal from 13 options, assess urgency, and choose an approach — all in one more parallel call. When a goal gets stuck, Jev decides whether to retry or abandon it entirely.

No parsing. No prompt engineering. Just typed answers the bot acts on directly.

---

## Features

- **AI-driven decisions** — no hardcoded priority rules; Jev reads the full situation and decides
- **Emotional state** — four live emotions (fear, satisfaction, curiosity, urgency) that shape every question sent to Jev
- **Persistent memory** — remembers shelter, crafting stations, furnaces, death locations, animal areas, and player preferences across restarts
- **Selective recall** — relevant memories are surfaced contextually each tick (near a death site? Jev is warned)
- **Player commands** — type anything in chat; Jev reads it and picks the matching goal sequence
- **Failure awareness** — tracks per-step failures, asks Jev whether to retry or abandon a stuck goal
- **Full progression chain** — 13 goals from punching trees to iron tools, with dependency awareness

---

## How it works

```
Every 600ms (reactive loop)
  ┌─────────────────────────────────────────────────────────┐
  │  Extract game state  →  Update emotions  →  Ask Jev     │
  │                                                         │
  │  State: health, food, hostiles, position, time, goal    │
  │  Emotions: fear, satisfaction, curiosity, urgency       │
  │  Memory: recalled death sites, resources, shelter       │
  │                                                         │
  │  Jev answers (parallel):                                │
  │    threat_level · action · should_eat · flee_direction  │
  │                                                         │
  │  Execute: fight / flee / eat / goal step / look around  │
  └─────────────────────────────────────────────────────────┘

Every 10s (tactical loop)
  ┌─────────────────────────────────────────────────────────┐
  │  Build inventory + memory snapshot  →  Ask Jev          │
  │                                                         │
  │  Jev answers (parallel):                                │
  │    goal · urgency · approach                            │
  │                                                         │
  │  Switch goal if urgency >= 2.0 or player commanded      │
  └─────────────────────────────────────────────────────────┘
```

### Goal progression

```
gather_wood → craft_tools → mine_stone → upgrade_tools ──→ mine_iron → smelt_iron → craft_iron_tools
                                    └──→ craft_furnace ──→ cook_food
                                                     └──→ smelt_iron

+ get_food · build_shelter · go_to_shelter · explore
```

### Emotional system

Four continuous emotions (0–1) decay each tick and are injected into every Jev question as context:

| Emotion | Spikes when | Influences |
|---------|-------------|------------|
| **fear** | Damage, hostiles, low HP, night, near death sites | fight/flee thresholds |
| **satisfaction** | Goal completed, healing, eating | goal persistence |
| **curiosity** | Idle in same chunk, entering new areas | explore tendency |
| **urgency** | Low food/health, dusk, player chat | goal switching |

The dominant emotion becomes a label — *terrified*, *anxious*, *proud*, *content*, *eager*, *curious*, *desperate*, *focused*, or *calm* — sent with every Jev question.

---

## Getting started

### Prerequisites

- Node.js 18+ (or Bun)
- A running Minecraft server (local LAN works fine)
- A [TypeSafe API key](https://typesafe.ai)

### Install

```bash
git clone https://github.com/akash-kamat/jev-craft.git
cd jev-craft
npm install
```

### Configure

```bash
cp .env.example .env
```

Edit `.env`:

```env
TYPESAFE_API_KEY=your_api_key_here
MC_HOST=localhost
MC_PORT=25565        # LAN port shown in chat after "Open to LAN"
MC_USERNAME=JevBot
```

### Run

```bash
npm start
# or for hot-reload during development:
npm run dev
```

The bot connects, spawns, and immediately starts making decisions. You'll see a live log of its state, emotions, goals, and every action it takes.

---

## Chat commands

Type in Minecraft chat to control the bot in real time:

| Command | Effect |
|---------|--------|
| `status` | Bot replies with current goal, HP, food, and emotional state |
| `get wood` | Jev interprets it and switches to `gather_wood` |
| `I need iron` | Jev recognizes the dependency chain and starts working toward iron tools |
| `auto` | Cancel the current manual goal and return to autonomous mode |

Any natural language works — Jev reads it and picks the best matching goal.

---

## Project structure

```
src/
├── index.js        # Bot setup, event handlers, loop drivers
├── config.js       # Server connection, model, intervals, thresholds
├── state.js        # extractState() — game world snapshot each tick
├── decisions.js    # Reactive Jev call — threat + action + eat + flee
├── tactics.js      # Tactical Jev call — goal selection + step execution
├── goals.js        # All 13 goals with steps, canRun guards, isDone checks
├── actions.js      # doFight / doFlee / doEat / doLookAround
├── mind.js         # Emotional state, event log, selective memory recall
└── memory.js       # Persistent bot-memory.json — locations, deaths, prefs
```

---

## Roadmap

- [x] Phase 1 — Reactive survival (fight, flee, eat, look around)
- [x] Phase 2 — Tactical goals + player commands + persistent memory
- [x] Consciousness system — emotions, event log, selective recall
- [ ] Phase 3 — Universal primitives: let Jev sequence atomic actions instead of hardcoded steps
- [ ] Smarter mining — branch pattern, torch placement, gravel handling
- [ ] Async smelting — start furnace and do other things while waiting
- [ ] Jev-driven emotion updates — ask Jev how the bot should feel, not just formulas
- [ ] Emotional expression — bot says things in chat based on its emotional state

---

## Built with

- **[Jev](https://typesafe.ai)** by [TypeSafe](https://typesafe.ai) — [System One](https://docs.typesafe.ai/concepts/system-one) AI model for fast, typed decisions
- **[Mineflayer](https://github.com/PrismarineJS/mineflayer)** — Minecraft bot framework
- **[mineflayer-pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder)** — Navigation

---

## License

MIT
