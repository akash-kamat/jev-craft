# Jev Minecraft Bot — Phases

## Phase 1: Reactive Survival Bot

### What it does
Every 600ms, extracts game state and asks Jev 4 questions in a single parallel API call to make an immediate survival decision.

### State sent to Jev
```json
{
  "player": { "health": 18, "food": 16, "position": { "x": 100, "y": 64, "z": -200 }, "on_ground": true },
  "time_of_day": "night",
  "nearby_hostiles": [{ "name": "zombie", "distance": 6.2, "direction": "north", "hostile": true }],
  "nearby_entities": [{ "name": "cow", "distance": 12, "direction": "south" }],
  "has_food": true,
  "food_items": ["raw_beef"],
  "inventory_summary": { "wooden_sword": 1, "oak_log": 3 },
  "nearby_blocks": ["oak_log", "dirt", "stone"],
  "current_goal": "gather_wood"
}
```

### Jev questions (all asked in parallel, one API call)

| Question ID | Type | What it asks | Options/Levels |
|-------------|------|-------------|----------------|
| `threat_level` | Score (5 levels) | How dangerous is the situation? | Safe → Caution → Moderate danger → High danger → Critical |
| `action` | Choice | What should the bot do right now? | fight, flee, eat, continue_goal, look_around |
| `should_eat` | Noul (yes/no probability) | Should the bot eat now? | true: hunger is low + food available, false: not needed |
| `flee_direction` | Choice (speculative) | Which way to run if fleeing? | north, south, east, west |

### How decisions map to code
- `fight` + confidence >= 0.6 → equip sword, attack nearest hostile
- `flee` + confidence >= 0.5 → sprint in chosen direction for 1.5s
- `eat` or `should_eat > 0.6` → equip food, eat it
- `continue_goal` → run next step of current tactical goal (Phase 2)
- `look_around` → rotate view 90 degrees
- Low confidence on fight/flee → fallback to look_around

### Limitations
- No memory between ticks — each decision is independent
- Can only see entities within 16 blocks
- First tick has undefined HP/food (Mineflayer hasn't loaded player data yet)
- `flee_direction` is always asked even when not fleeing (speculative fan-out — costs no extra latency but wastes a few tokens)

### Possible improvements
- Add `should_fight` as separate Noul for creepers (they explode — fighting them is usually bad)
- Add shield/blocking support for skeleton arrows
- Add jump/sprint as separate actions for better movement
- Track recent damage sources to flee smarter


---


## Phase 2: Tactical Goal Layer + Memory + Dependencies

### What it does
Every 10 seconds, asks Jev to pick a goal for the bot to work toward. Goals are multi-step objectives with dependency awareness. The reactive layer (Phase 1) interrupts goals for threats. Bot has persistent memory that survives restarts.

When the player types in Minecraft chat, the message is stored and included in the next tactical state as `player_command`. Jev reads it and picks the matching goal. Player commands always override the current goal. After a manual goal completes, the bot returns to autonomous mode. Typing "auto" cancels a manual goal immediately.

### State sent to Jev (tactical)
```json
{
  "time_of_day": "afternoon",
  "health": 20,
  "food": 18,
  "logs": 3,
  "planks": 0,
  "cobblestone": 12,
  "iron_ingots": 0,
  "raw_iron": 3,
  "has_pickaxe": true,
  "has_sword": true,
  "has_stone_tools": false,
  "has_iron_tools": false,
  "has_food": true,
  "nearby_blocks": ["oak_log", "dirt", "stone", "iron_ore"],
  "current_goal": "mine_stone",
  "hostile_count": 0,
  "player_command": null,
  "can_do": ["mine_stone", "craft_furnace", "upgrade_tools"],
  "blocked": ["mine_iron needs stone pickaxe or better", "craft_iron_tools needs 5 iron ingots"],
  "memory": {
    "shelter": { "x": 100, "y": 64, "z": -200, "built_at": 1726704000000 },
    "crafting_table": { "x": 102, "y": 64, "z": -198 },
    "furnace": null,
    "player_preferences": [],
    "recent_deaths": [{ "x": 80, "y": 30, "z": -180, "cause": "unknown" }],
    "nearby_resources": { "iron_ore": { "x": 85, "y": 20, "z": -190, "distance": 45 } },
    "danger_zones": [{ "x": 80, "y": 30, "z": -180, "reason": "died here" }],
    "explored_area_count": 12
  }
}
```

### Jev questions (tactical, one API call)

| Question ID | Type | What it asks | Options/Levels |
|-------------|------|-------------|----------------|
| `goal` | Choice | What should the bot prioritize? If `player_command` is set, follow it. Considers dependencies (can_do/blocked) and memory. | gather_wood, craft_tools, mine_stone, craft_furnace, cook_food, upgrade_tools, mine_iron, smelt_iron, craft_iron_tools, get_food, build_shelter, go_to_shelter, explore |
| `urgency` | Score (3 levels) | How urgently should the bot switch goals? Player commands = always high. | Low → Medium → High |

### All goals (13 total)

#### Progression chain
```
gather_wood → craft_tools → mine_stone → upgrade_tools ──→ mine_iron → smelt_iron → craft_iron_tools
                                    └──→ craft_furnace ──→ cook_food
                                                     └──→ smelt_iron
```

| Goal | Done when | Requires | Steps |
|------|-----------|----------|-------|
| **gather_wood** | 8+ logs | nothing | find log → walk to it → mine it → repeat |
| **craft_tools** | wooden pickaxe + sword | 4+ logs | planks → sticks → table → place table → pickaxe → sword |
| **mine_stone** | 12+ cobblestone | any pickaxe | equip pickaxe → find stone → mine it → repeat |
| **craft_furnace** | furnace placed | 8 cobblestone + crafting table | craft furnace → place it (remembers location) |
| **cook_food** | 4+ cooked meat | furnace + raw meat + fuel | find furnace (checks memory) → put fuel + meat → wait → take output |
| **upgrade_tools** | stone pickaxe + sword | 5 cobblestone + sticks + crafting table | ensure sticks → go to table (checks memory) → stone pickaxe → stone sword |
| **mine_iron** | 6+ raw iron/ingots | stone pickaxe or better | find iron ore → mine it; if none visible, dig down or tunnel forward |
| **smelt_iron** | 6+ iron ingots | furnace + raw iron + fuel | find furnace (checks memory) → put fuel + iron → wait → take output |
| **craft_iron_tools** | iron pickaxe + sword | 5 iron ingots + sticks + crafting table | ensure sticks → go to table (checks memory) → iron pickaxe → iron sword |
| **get_food** | 4+ meat items | nothing (better with sword) | find animal → walk to it → equip sword → hit 5 times |
| **build_shelter** | walls placed | nothing (needs dirt) | gather 16 dirt → place 3x3x2 walls (remembers location) |
| **go_to_shelter** | within 5 blocks of shelter | shelter in memory | navigate to remembered shelter position |
| **explore** | never (fallback) | nothing | walk random direction for 3 seconds |

### Dependency awareness
The tactical state includes `can_do` and `blocked` fields computed from the bot's inventory. Jev sees things like:
- `can_do: ["mine_stone", "craft_furnace"]`
- `blocked: ["mine_iron needs stone pickaxe or better"]`

This tells Jev what's achievable now vs what needs prerequisite goals first. Jev can use this to make smart sequencing decisions without hardcoded priority logic.

### Memory system
Persists to `bot-memory.json` on disk. Survives bot restarts.

| Memory type | When saved | How used |
|-------------|-----------|----------|
| **shelter** | When walls are built | go_to_shelter navigates here; shown in tactical state |
| **crafting_table** | When table is placed | upgrade_tools and craft_iron_tools walk here instead of searching |
| **furnace** | When furnace is placed | cook_food and smelt_iron walk here instead of searching |
| **death_locations** | On bot death | Shown in tactical state as recent_deaths; danger zones created |
| **resource_locations** | When bot finds trees, stone, iron | Shown if within 200 blocks; bot knows where to find things |
| **danger_zones** | On death, near lava | Included if within 50 blocks; Jev can avoid them |
| **player_preferences** | When player gives instructions | Included in tactical state so Jev respects them |
| **explored_chunks** | While exploring/mining | Count shown so Jev knows how much area is mapped |
| **animal_areas** | When animals are spotted | Bot knows where to find animals for food |

### Goal switching rules
- Minimum 15 seconds on a goal before Jev can switch
- New goal must have urgency >= 2.0 to override current goal
- Player commands bypass both rules — always switch immediately
- Completed manual goals return to autonomous mode

### Chat command flow
```
Player types "I need iron" in Minecraft chat
  → stored as player_command = "i need iron"
  → next tactical tick (up to 10s later)
  → Jev sees player_command in state + blocked: ["mine_iron needs stone pickaxe"]
  → Jev picks: upgrade_tools (because it knows mining iron needs stone tools first)
  → Bot crafts stone tools → done → Jev picks mine_iron on next tick
  → Eventually: back to autonomous
```

### Limitations (current)
- **Hardcoded goal steps** — every physical action (mine, place, craft) is a coded sequence. Jev picks WHICH goal, but code decides HOW to do it. The bot can't do anything that isn't pre-programmed.
- **13 goals is still limited** — can't farm, breed animals, enchant, build structures, use redstone, go to nether, etc.
- **Shelter is still primitive** — 3 dirt walls, no roof, no door, no torch
- **Chat delay** — up to 10 seconds between player message and goal change
- **Mining iron is basic** — just digs down or forward, no smart strip mining
- **No tool durability awareness** — doesn't know when tools are about to break
- **Furnace smelting blocks** — waits 12-15 seconds synchronously during cook/smelt

### Possible improvements
- **Universal primitives (Phase 3)** — replace hardcoded goal steps with ~10 atomic actions that Jev sequences on its own. No more adding goals manually.
- **Immediate chat response** — trigger tactical tick immediately on player command
- **Smarter mining** — branch mining pattern, torch placement, gravel handling
- **Tool durability tracking** — switch to spare tools or craft replacements
- **Async smelting** — start furnace and do other things while waiting


---


## Phase 3: Universal Primitives (NOT BUILT)

### What it will do
Replace hardcoded goal steps with ~10 atomic primitives that Jev sequences each tick. Instead of coding "gather_wood = find tree → walk → mine → repeat", we define the primitives once and Jev figures out the order.

### The primitives
| Primitive | What it does | Code |
|-----------|-------------|------|
| `go_to(target)` | Walk to a position or named target | mineflayer-pathfinder |
| `mine(block_type)` | Mine a specific block type | bot.dig() |
| `place(block_type)` | Place a block from inventory | bot.placeBlock() |
| `craft(item_name)` | Craft an item (auto-finds crafting table if needed) | bot.craft() |
| `smelt(item_name)` | Put item in furnace with fuel | bot.openFurnace() |
| `attack(entity)` | Hit nearest entity of type | bot.attack() |
| `equip(item)` | Hold an item | bot.equip() |
| `eat()` | Eat food from inventory | bot.activateItem() |
| `pick_up()` | Walk to nearest dropped item | pathfinder to item entity |
| `look_at(target)` | Look in a direction | bot.lookAt() |

### How Jev would use them
Each tick, Jev gets:
- Current objective (from tactical layer or player command)
- Inventory
- Nearby blocks, entities, items on ground
- Available primitives with valid targets

Jev answers two Choice questions:
1. "Which primitive to execute?" → picks from the 10
2. "What is the target?" → picks from available targets for that primitive

### What this unlocks
- Bot can attempt ANY task without pre-programming
- Player says "build a house" → Jev sequences: mine logs → craft planks → place planks in a pattern
- New Minecraft updates don't need code changes — just new block/item names in state
- Emergent behavior — Jev might discover strategies we didn't think of

### Tradeoffs
- More Jev calls per tick (2 questions per tick for primitives + reactive questions)
- Jev might make bad sequences (try to craft without materials)
- Need to include "what's craftable" and "available targets" in state — larger state = more tokens
- May need to include Minecraft crafting knowledge in state or question context

### Open questions
- How to give Jev enough crafting knowledge without making state huge?
- Should primitives have a "plan" mode where Jev outputs a sequence, or tick-by-tick only?
- How to handle multi-tick primitives (mining takes time, walking takes time)?
- What's the token cost of including all available targets each tick?


---


## Consciousness-Like Memory System (Built into Phase 1 & 2)

### What it does
Adds an emotional state, event log, and selective memory recall to the bot. Instead of being a stateless decision-maker, Jev now receives the bot's "inner state" — how it's feeling, what just happened, and what it remembers about the current situation. This makes decisions contextual: a bot that just died is fearful and cautious, a bot that's been idle is curious and wants to explore.

### Components

#### Emotional State (src/mind.js)
Four emotions, each a float 0–1, updated every reactive tick (600ms):

| Emotion | Increases when | Decreases |
|---------|---------------|-----------|
| **fear** | Takes damage, hostiles nearby (especially creepers), low HP, night, near death locations | Decays at 0.92/tick, reduced on kill |
| **satisfaction** | Completes a goal, heals, eats | Decays at 0.92/tick, drops sharply on death |
| **curiosity** | Stays in same area too long, enters new area, morning time | Decays at 0.92/tick |
| **urgency** | Low food, low health, dusk/night without shelter, multiple hostiles, player chat | Decays at 0.92/tick |

The dominant emotion becomes a label: **terrified**, **anxious**, **proud**, **content**, **eager**, **curious**, **desperate**, **focused**, or **calm** (if all below 0.2).

#### Event Log (RAM only)
Rolling buffer of last 10 events with relative timestamps:
- `"took 4 damage (HP: 16)"` (3s ago)
- `"fled north"` (8s ago)
- `"completed goal: gather_wood"` (22s ago)
- `"player said: 'get iron'"` (15s ago)
- `"killed zombie"` (5s ago)
- `"ate cooked_beef"` (12s ago)

Events are logged by actions.js (fight, flee, eat), mind.js (damage, death, kills, goal completion, chat).

#### Selective Recall (RAM, triggered per tick)
Instead of dumping all memory into state, `searchMemory(state)` finds up to 3 relevant memories based on:
- **Proximity to death locations** (within 30 blocks) → "I died near here"
- **Nearby known resources** (10–100 blocks) → "I found iron_ore at ..."
- **Shelter location** (at dusk/night) → "My shelter is at ..."
- **Animal areas** (when hungry/no food) → "I saw animals near ..."
- **Player preferences** (always) → "The player told me: ..."

Recalled memories are consumed once per tick — they appear in the Jev question, then clear.

#### Episodic Memory (persistent, bot-memory.json)
Stores tagged episodes: `{ summary, tags, position, time }`. Searchable by tag and distance. Used for longer-term recall across sessions.

### How it flows into Jev

#### Reactive layer (decisions.js)
State sent to Jev now includes:
```json
{
  "player": { ... },
  "emotions": { "fear": 0.45, "satisfaction": 0.12, "curiosity": 0.30, "urgency": 0.65 },
  "feeling": "focused",
  ...
}
```

Questions include emotion and recall context as natural language:
- `"Feeling: focused (fear:0.45 satisfaction:0.12 curiosity:0.30 urgency:0.65)."`
- `"Recent: took 4 damage (3s), fled north (8s)."`
- `"Recalled memories: I died near here at (80, 30, -180). I should be careful."`

#### Tactical layer (tactics.js)
Goal selection state includes `feeling` and `emotions`. The goal question mentions the bot's emotional state and any recalled memories, so Jev can factor fear into shelter decisions, curiosity into exploration, etc.

### What this changes behaviorally
- **After death**: fear spikes to 0.9, satisfaction drops — bot becomes cautious, more likely to flee, seek shelter
- **Near death site**: memories recall "I died here" — Jev sees the warning, avoids or proceeds carefully
- **Idle in one area**: curiosity rises — bot more likely to explore or look around
- **Player gives command**: urgency bumps — bot prioritizes the request
- **Completes a goal**: satisfaction rises — bot feels "proud", stays calm
- **Night without shelter**: urgency climbs — drives go_to_shelter or build_shelter goals
- **After killing a mob**: fear drops, satisfaction rises — bot regains confidence

### Limitations
- Emotions are code-driven formulas, not learned — the decay rate and boost values are hand-tuned
- No long-term emotional patterns (can't learn "I always die in caves")
- Recall is position/time based, not semantic — can't recall "what happened last time I tried mining iron"
- Event log is RAM-only, lost on restart (episodic memory persists but needs explicit saves)
- Emotion labels are coarse (8 labels for 4 continuous dimensions)

### Possible improvements
- **Jev-driven emotion updates** — ask Jev "how should the bot feel about this?" instead of formula
- **Semantic recall** — use episode tags + Jev Noul to decide which memories are relevant
- **Personality drift** — long-term emotion averages shape a "personality" (cautious bot vs brave bot)
- **Emotional expression** — bot says things in chat based on emotions ("I'm scared", "that was satisfying")
- **Dream/reflection** — during idle time, review episodes and consolidate learnings
