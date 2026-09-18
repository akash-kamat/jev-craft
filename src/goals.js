import Vec3 from "vec3";
import {
  rememberShelter,
  rememberCraftingTable,
  rememberFurnace,
  rememberResource,
  rememberAnimalArea,
  rememberExploredArea,
  getMemory,
} from "./memory.js";

const UP = new Vec3(0, 1, 0);

async function placeOnGround(bot) {
  const pos = bot.entity.position.floored();
  const adjacentOffsets = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [-1, -1], [1, -1], [-1, 1],
  ];
  for (const [dx, dz] of adjacentOffsets) {
    const groundBlock = bot.blockAt(pos.offset(dx, -1, dz));
    if (!groundBlock || groundBlock.name === "air" || groundBlock.boundingBox !== "block") continue;

    const targetPos = pos.offset(dx, 0, dz);
    const targetBlock = bot.blockAt(targetPos);
    if (!targetBlock || targetBlock.name !== "air") continue;

    await bot.placeBlock(groundBlock, UP);
    await sleep(300);
    return targetPos;
  }
  return null;
}

const LOG_BLOCKS = new Set([
  "oak_log", "birch_log", "spruce_log", "jungle_log",
  "acacia_log", "dark_oak_log", "mangrove_log", "cherry_log",
]);

const PLANK_BLOCKS = new Set([
  "oak_planks", "birch_planks", "spruce_planks", "jungle_planks",
  "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks",
]);

const STONE_BLOCKS = new Set(["stone", "cobblestone", "deepslate", "cobbled_deepslate"]);

const ANIMAL_MOBS = new Set(["cow", "pig", "chicken", "sheep", "rabbit"]);

function countLogs(bot) {
  return bot.inventory.items()
    .filter((i) => LOG_BLOCKS.has(i.name))
    .reduce((sum, i) => sum + i.count, 0);
}

function countPlanks(bot) {
  return bot.inventory.items()
    .filter((i) => PLANK_BLOCKS.has(i.name))
    .reduce((sum, i) => sum + i.count, 0);
}

function countItem(bot, name) {
  return bot.inventory.items()
    .filter((i) => i.name === name)
    .reduce((sum, i) => sum + i.count, 0);
}

function countItems(bot, names) {
  return bot.inventory.items()
    .filter((i) => names.includes(i.name))
    .reduce((sum, i) => sum + i.count, 0);
}

function hasItem(bot, name) {
  return countItem(bot, name) > 0;
}

function hasAny(bot, names) {
  return names.some((n) => hasItem(bot, n));
}

export function findBlock(bot, names, maxDistance = 32) {
  const ids = [];
  for (const name of names) {
    const block = bot.registry.blocksByName[name];
    if (block) ids.push(block.id);
  }
  if (ids.length === 0) return null;
  return bot.findBlock({ matching: ids, maxDistance });
}

function findNearestAnimal(bot, maxDistance = 24) {
  let nearest = null;
  let nearestDist = Infinity;
  for (const entity of Object.values(bot.entities)) {
    if (entity === bot.entity) continue;
    if (!ANIMAL_MOBS.has(entity.name)) continue;
    const dist = bot.entity.position.distanceTo(entity.position);
    if (dist < nearestDist && dist <= maxDistance) {
      nearest = entity;
      nearestDist = dist;
    }
  }
  if (nearest) {
    rememberAnimalArea(nearest.position);
  }
  return nearest;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function navigateTo(bot, position) {
  const pf = await import("mineflayer-pathfinder");
  const { pathfinder, Movements } = pf.default;
  const { GoalNear } = pf.default.goals;

  if (!bot.pathfinder) {
    bot.loadPlugin(pathfinder);
  }

  const movements = new Movements(bot);
  movements.allowSprinting = true;
  bot.pathfinder.setMovements(movements);

  const goal = new GoalNear(position.x, position.y, position.z, 2);
  bot.pathfinder.setGoal(goal);

  await new Promise((resolve) => {
    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      bot.removeListener("goal_reached", onGoalReached);
      bot.removeListener("path_update", onPathUpdate);
      resolve();
    };

    const timeout = setTimeout(() => {
      bot.pathfinder.setGoal(null);
      done();
    }, 8000);

    const onGoalReached = () => done();
    const onPathUpdate = (result) => {
      if (result.status === "noPath") {
        bot.pathfinder.setGoal(null);
        done();
      }
    };

    bot.on("goal_reached", onGoalReached);
    bot.on("path_update", onPathUpdate);
  });
}

async function mineBlock(bot, blockNames) {
  const block = findBlock(bot, blockNames);
  if (!block) return false;

  await navigateTo(bot, block.position);

  const target = bot.blockAt(block.position);
  if (!target || target.name === "air") return false;

  const bestTool = bot.pathfinder
    ? bot.inventory.items().find((i) => i.name.includes("pickaxe"))
    : null;
  if (bestTool) {
    try { await bot.equip(bestTool, "hand"); } catch {}
  }

  try {
    await bot.dig(target);
    await sleep(200);
    return true;
  } catch {
    return false;
  }
}

function getFirstLogName(bot) {
  return bot.inventory.items().find((i) => LOG_BLOCKS.has(i.name))?.name;
}

function logToPlanks(logName) {
  return logName.replace("_log", "_planks");
}

function craftItem(bot, itemName, count = 1, useTable = false) {
  const itemId = bot.registry.itemsByName[itemName]?.id;
  if (!itemId) return null;

  if (useTable) {
    const table = findBlock(bot, ["crafting_table"], 6);
    if (!table) return null;
    const recipe = bot.recipesFor(itemId, null, 1, table)?.[0];
    return recipe ? { recipe, table, count } : null;
  }

  const recipe = bot.recipesFor(itemId)?.[0];
  return recipe ? { recipe, table: null, count } : null;
}

async function doCraft(bot, itemName, count = 1, useTable = false) {
  const result = craftItem(bot, itemName, count, useTable);
  if (!result) return `can't craft ${itemName}`;
  await bot.craft(result.recipe, result.count, result.table);
  return `crafted ${itemName}`;
}


export const GOALS = {
  gather_wood: {
    description: "Chop trees to collect wood logs",
    requires: [],
    unlocks: ["craft_tools", "build_shelter"],
    isDone: (bot) => countLogs(bot) >= 8,
    steps: [
      {
        name: "find and mine log",
        async run(bot) {
          const mined = await mineBlock(bot, [...LOG_BLOCKS]);
          if (mined) {
            rememberResource("trees", bot.entity.position);
            rememberExploredArea(bot.entity.position);
            return "mined a log";
          }
          const angle = Math.random() * Math.PI * 2;
          const target = bot.entity.position.offset(
            Math.cos(angle) * 20,
            0,
            Math.sin(angle) * 20
          );
          await navigateTo(bot, target);
          rememberExploredArea(bot.entity.position);
          return "no logs nearby — walking to search";
        },
      },
    ],
  },

  craft_tools: {
    description: "Craft wooden pickaxe and sword",
    requires: ["logs >= 4"],
    unlocks: ["mine_stone", "get_food (better with sword)"],
    isDone: (bot) => hasItem(bot, "wooden_pickaxe") && hasItem(bot, "wooden_sword"),
    steps: [
      {
        name: "craft planks",
        canRun: (bot) => countLogs(bot) >= 1 && countPlanks(bot) < 8,
        async run(bot) {
          const logName = getFirstLogName(bot);
          if (!logName) return "no logs";
          return doCraft(bot, logToPlanks(logName), 2);
        },
      },
      {
        name: "craft sticks",
        canRun: (bot) => countPlanks(bot) >= 2 && countItem(bot, "stick") < 4,
        async run(bot) {
          return doCraft(bot, "stick", 1);
        },
      },
      {
        name: "craft crafting table",
        canRun: (bot) => countPlanks(bot) >= 4 && !hasItem(bot, "crafting_table") && !findBlock(bot, ["crafting_table"], 8) && !getMemory().crafting_table,
        async run(bot) {
          return doCraft(bot, "crafting_table", 1);
        },
      },
      {
        name: "place crafting table",
        canRun: (bot) => hasItem(bot, "crafting_table") && !findBlock(bot, ["crafting_table"], 8) && !getMemory().crafting_table,
        async run(bot) {
          const tableItem = bot.inventory.items().find((i) => i.name === "crafting_table");
          await bot.equip(tableItem, "hand");
          const placed = await placeOnGround(bot);
          if (!placed) return "no suitable ground to place on";
          rememberCraftingTable(placed);
          return "placed crafting table";
        },
      },
      {
        name: "go to crafting table",
        canRun: (bot) => !findBlock(bot, ["crafting_table"], 6) && (getMemory().crafting_table || findBlock(bot, ["crafting_table"], 32)),
        async run(bot) {
          const mem = getMemory();
          const nearby = findBlock(bot, ["crafting_table"], 32);
          if (nearby) {
            await navigateTo(bot, nearby.position);
            return "walked to crafting table";
          }
          if (mem.crafting_table) {
            await navigateTo(bot, mem.crafting_table);
            return "walked to remembered crafting table";
          }
          return "no crafting table found";
        },
      },
      {
        name: "craft wooden pickaxe",
        canRun: (bot) => !hasItem(bot, "wooden_pickaxe") && countPlanks(bot) >= 3 && countItem(bot, "stick") >= 2,
        async run(bot) {
          return doCraft(bot, "wooden_pickaxe", 1, true);
        },
      },
      {
        name: "craft wooden sword",
        canRun: (bot) => !hasItem(bot, "wooden_sword") && countPlanks(bot) >= 1 && countItem(bot, "stick") >= 1,
        async run(bot) {
          return doCraft(bot, "wooden_sword", 1, true);
        },
      },
    ],
  },

  mine_stone: {
    description: "Mine cobblestone with a pickaxe",
    requires: ["wooden_pickaxe or better"],
    unlocks: ["craft_furnace", "upgrade_tools"],
    isDone: (bot) => countItem(bot, "cobblestone") >= 12,
    steps: [
      {
        name: "mine stone",
        canRun: (bot) => hasAny(bot, ["wooden_pickaxe", "stone_pickaxe", "iron_pickaxe"]),
        async run(bot) {
          const pickaxe = bot.inventory.items().find((i) => i.name.includes("pickaxe"));
          if (pickaxe) await bot.equip(pickaxe, "hand");
          const mined = await mineBlock(bot, [...STONE_BLOCKS]);
          if (mined) rememberResource("stone", bot.entity.position);
          return mined ? "mined stone" : "no stone found nearby";
        },
      },
    ],
  },

  craft_furnace: {
    description: "Craft and place a furnace",
    requires: ["cobblestone >= 8"],
    unlocks: ["cook_food", "smelt_iron"],
    isDone: (bot, goalState) => goalState.furnacePlaced === true,
    steps: [
      {
        name: "craft furnace",
        canRun: (bot) => countItem(bot, "cobblestone") >= 8 && !hasItem(bot, "furnace"),
        async run(bot) {
          return doCraft(bot, "furnace", 1, true);
        },
      },
      {
        name: "place furnace",
        canRun: (bot) => hasItem(bot, "furnace"),
        async run(bot, goalState) {
          const item = bot.inventory.items().find((i) => i.name === "furnace");
          await bot.equip(item, "hand");
          const placed = await placeOnGround(bot);
          if (!placed) return "no suitable ground to place on";
          rememberFurnace(placed);
          goalState.furnacePlaced = true;
          return "placed furnace";
        },
      },
    ],
  },

  cook_food: {
    description: "Cook raw meat in a furnace",
    requires: ["furnace", "raw meat", "fuel (logs or planks)"],
    unlocks: [],
    isDone: (bot) => {
      const cooked = countItems(bot, [
        "cooked_beef", "cooked_porkchop", "cooked_chicken",
        "cooked_mutton", "cooked_rabbit", "cooked_cod", "cooked_salmon",
      ]);
      return cooked >= 4;
    },
    steps: [
      {
        name: "smelt at furnace",
        async run(bot) {
          const mem = getMemory();
          let furnaceBlock = findBlock(bot, ["furnace"], 32);

          if (!furnaceBlock && mem.furnace) {
            await navigateTo(bot, mem.furnace);
            furnaceBlock = findBlock(bot, ["furnace"], 6);
          }
          if (!furnaceBlock) return "no furnace found";

          await navigateTo(bot, furnaceBlock.position);
          const furnace = await bot.openFurnace(furnaceBlock);

          const rawMeat = bot.inventory.items().find((i) =>
            ["raw_beef", "raw_porkchop", "raw_chicken", "raw_mutton",
             "raw_rabbit", "raw_cod", "raw_salmon"].includes(i.name)
          );
          if (!rawMeat) { furnace.close(); return "no raw food to cook"; }

          const fuel = bot.inventory.items().find((i) =>
            LOG_BLOCKS.has(i.name) || PLANK_BLOCKS.has(i.name) ||
            i.name === "coal" || i.name === "charcoal" || i.name === "stick"
          );
          if (!fuel) { furnace.close(); return "no fuel"; }

          await furnace.putFuel(fuel.type, null, Math.min(fuel.count, 4));
          await furnace.putInput(rawMeat.type, null, Math.min(rawMeat.count, 4));
          await sleep(12000);
          await furnace.takeOutput();
          furnace.close();
          return "cooked food";
        },
      },
    ],
  },

  upgrade_tools: {
    description: "Craft stone pickaxe and stone sword",
    requires: ["cobblestone >= 5", "sticks >= 4", "crafting_table"],
    unlocks: ["mine_iron"],
    isDone: (bot) => hasItem(bot, "stone_pickaxe") && hasItem(bot, "stone_sword"),
    steps: [
      {
        name: "ensure sticks",
        canRun: (bot) => countItem(bot, "stick") < 4 && countPlanks(bot) >= 2,
        async run(bot) {
          return doCraft(bot, "stick", 2);
        },
      },
      {
        name: "go to crafting table",
        canRun: (bot) => !findBlock(bot, ["crafting_table"], 6),
        async run(bot) {
          const mem = getMemory();
          if (mem.crafting_table) {
            await navigateTo(bot, mem.crafting_table);
            return "walked to remembered crafting table";
          }
          const table = findBlock(bot, ["crafting_table"], 32);
          if (table) {
            await navigateTo(bot, table.position);
            return "walked to crafting table";
          }
          return "no crafting table found";
        },
      },
      {
        name: "craft stone pickaxe",
        canRun: (bot) => !hasItem(bot, "stone_pickaxe") && countItem(bot, "cobblestone") >= 3 && countItem(bot, "stick") >= 2,
        async run(bot) {
          return doCraft(bot, "stone_pickaxe", 1, true);
        },
      },
      {
        name: "craft stone sword",
        canRun: (bot) => !hasItem(bot, "stone_sword") && countItem(bot, "cobblestone") >= 2 && countItem(bot, "stick") >= 1,
        async run(bot) {
          return doCraft(bot, "stone_sword", 1, true);
        },
      },
    ],
  },

  mine_iron: {
    description: "Mine iron ore underground",
    requires: ["stone_pickaxe or better"],
    unlocks: ["smelt_iron"],
    isDone: (bot) => countItems(bot, ["raw_iron", "iron_ingot"]) >= 6,
    steps: [
      {
        name: "dig down to find iron",
        canRun: (bot) => hasAny(bot, ["stone_pickaxe", "iron_pickaxe"]),
        async run(bot) {
          const pickaxe = bot.inventory.items().find((i) => i.name.includes("pickaxe"));
          if (pickaxe) await bot.equip(pickaxe, "hand");

          const ironBlock = findBlock(bot, ["iron_ore", "deepslate_iron_ore"], 32);
          if (ironBlock) {
            await navigateTo(bot, ironBlock.position);
            const target = bot.blockAt(ironBlock.position);
            if (target && target.name !== "air") {
              await bot.dig(target);
              rememberResource("iron_ore", ironBlock.position);
              return "mined iron ore";
            }
          }

          const pos = bot.entity.position;
          if (pos.y > 40) {
            const below = bot.blockAt(pos.offset(0, -1, 0));
            if (below && below.name !== "air") {
              await bot.dig(below);
              return "digging down to find iron";
            }
          }

          const forward = bot.blockAt(
            pos.offset(Math.cos(bot.entity.yaw), 0, Math.sin(bot.entity.yaw))
          );
          if (forward && forward.name !== "air") {
            await bot.dig(forward);
            return "mining tunnel forward";
          }

          return "looking for iron ore";
        },
      },
    ],
  },

  smelt_iron: {
    description: "Smelt raw iron into ingots",
    requires: ["furnace", "raw_iron", "fuel"],
    unlocks: ["craft_iron_tools"],
    isDone: (bot) => countItem(bot, "iron_ingot") >= 6,
    steps: [
      {
        name: "smelt at furnace",
        async run(bot) {
          const mem = getMemory();
          let furnaceBlock = findBlock(bot, ["furnace"], 32);
          if (!furnaceBlock && mem.furnace) {
            await navigateTo(bot, mem.furnace);
            furnaceBlock = findBlock(bot, ["furnace"], 6);
          }
          if (!furnaceBlock) return "no furnace found";

          await navigateTo(bot, furnaceBlock.position);
          const furnace = await bot.openFurnace(furnaceBlock);

          const rawIron = bot.inventory.items().find((i) => i.name === "raw_iron");
          if (!rawIron) { furnace.close(); return "no raw iron"; }

          const fuel = bot.inventory.items().find((i) =>
            i.name === "coal" || i.name === "charcoal" ||
            LOG_BLOCKS.has(i.name) || PLANK_BLOCKS.has(i.name)
          );
          if (!fuel) { furnace.close(); return "no fuel"; }

          await furnace.putFuel(fuel.type, null, Math.min(fuel.count, 6));
          await furnace.putInput(rawIron.type, null, Math.min(rawIron.count, 6));
          await sleep(15000);
          await furnace.takeOutput();
          furnace.close();
          return "smelted iron";
        },
      },
    ],
  },

  craft_iron_tools: {
    description: "Craft iron pickaxe and iron sword",
    requires: ["iron_ingot >= 5", "sticks >= 4", "crafting_table"],
    unlocks: ["mine_diamond"],
    isDone: (bot) => hasItem(bot, "iron_pickaxe") && hasItem(bot, "iron_sword"),
    steps: [
      {
        name: "ensure sticks",
        canRun: (bot) => countItem(bot, "stick") < 4 && countPlanks(bot) >= 2,
        async run(bot) {
          return doCraft(bot, "stick", 2);
        },
      },
      {
        name: "go to crafting table",
        canRun: (bot) => !findBlock(bot, ["crafting_table"], 6),
        async run(bot) {
          const mem = getMemory();
          if (mem.crafting_table) {
            await navigateTo(bot, mem.crafting_table);
            return "walked to remembered crafting table";
          }
          return "no crafting table found";
        },
      },
      {
        name: "craft iron pickaxe",
        canRun: (bot) => !hasItem(bot, "iron_pickaxe") && countItem(bot, "iron_ingot") >= 3 && countItem(bot, "stick") >= 2,
        async run(bot) {
          return doCraft(bot, "iron_pickaxe", 1, true);
        },
      },
      {
        name: "craft iron sword",
        canRun: (bot) => !hasItem(bot, "iron_sword") && countItem(bot, "iron_ingot") >= 2 && countItem(bot, "stick") >= 1,
        async run(bot) {
          return doCraft(bot, "iron_sword", 1, true);
        },
      },
    ],
  },

  get_food: {
    description: "Hunt animals for food",
    requires: [],
    unlocks: ["cook_food"],
    isDone: (bot) => {
      return countItems(bot, [
        "raw_beef", "raw_porkchop", "raw_chicken", "raw_mutton", "raw_rabbit",
        "cooked_beef", "cooked_porkchop", "cooked_chicken", "cooked_mutton", "cooked_rabbit",
      ]) >= 4;
    },
    steps: [
      {
        name: "hunt animal",
        async run(bot) {
          const animal = findNearestAnimal(bot);
          if (!animal) return "no animals nearby";

          await navigateTo(bot, animal.position);
          const sword = bot.inventory.items().find((i) => i.name.includes("sword"));
          if (sword) await bot.equip(sword, "hand");

          for (let i = 0; i < 5; i++) {
            const target = bot.nearestEntity((e) => e.id === animal.id);
            if (!target) break;
            const dist = bot.entity.position.distanceTo(target.position);
            if (dist > 4) {
              await bot.lookAt(target.position.offset(0, target.height, 0));
              bot.setControlState("forward", true);
              await sleep(300);
              bot.setControlState("forward", false);
            } else {
              await bot.lookAt(target.position.offset(0, target.height, 0));
              bot.attack(target);
              await sleep(500);
            }
          }
          return `hunted ${animal.name}`;
        },
      },
    ],
  },

  build_shelter: {
    description: "Build a small dirt shelter",
    requires: [],
    unlocks: [],
    isDone: (_bot, goalState) => goalState.shelterBuilt === true,
    steps: [
      {
        name: "gather dirt if needed",
        canRun: (bot) => countItem(bot, "dirt") < 16,
        async run(bot) {
          const mined = await mineBlock(bot, ["dirt", "grass_block"]);
          return mined ? "gathered dirt" : "no dirt nearby";
        },
      },
      {
        name: "build walls",
        canRun: (bot) => countItem(bot, "dirt") >= 12,
        async run(bot, goalState) {
          const base = bot.entity.position.floored();
          const wallPositions = [
            [0, 0, 2], [1, 0, 2], [2, 0, 2],
            [2, 0, 1], [2, 0, 0],
            [0, 0, 0], [0, 0, 1],
            [0, 1, 2], [1, 1, 2], [2, 1, 2],
            [2, 1, 1], [2, 1, 0],
          ];

          const dirtItem = bot.inventory.items().find((i) => i.name === "dirt");
          if (!dirtItem) return "no dirt to build with";
          await bot.equip(dirtItem, "hand");

          let placed = 0;
          for (const [dx, dy, dz] of wallPositions) {
            const pos = base.offset(dx, dy, dz);
            const existing = bot.blockAt(pos);
            if (existing && existing.name !== "air") continue;
            const below = bot.blockAt(pos.offset(0, -1, 0));
            if (!below || below.name === "air") continue;
            try {
              await bot.placeBlock(below, UP);
              placed++;
              await sleep(200);
            } catch {}
          }

          if (placed > 0) {
            rememberShelter(base);
          }
          goalState.shelterBuilt = placed > 0;
          return `placed ${placed} blocks for shelter`;
        },
      },
    ],
  },

  go_to_shelter: {
    description: "Return to the shelter location",
    requires: ["shelter exists in memory"],
    unlocks: [],
    isDone: (bot) => {
      const mem = getMemory();
      if (!mem.shelter) return true;
      const dist = Math.sqrt(
        (bot.entity.position.x - mem.shelter.x) ** 2 +
        (bot.entity.position.z - mem.shelter.z) ** 2
      );
      return dist < 5;
    },
    steps: [
      {
        name: "navigate to shelter",
        async run(bot) {
          const mem = getMemory();
          if (!mem.shelter) return "no shelter in memory";
          await navigateTo(bot, mem.shelter);
          return "heading to shelter";
        },
      },
    ],
  },

  explore: {
    description: "Wander and discover the area",
    requires: [],
    unlocks: [],
    isDone: () => false,
    steps: [
      {
        name: "walk in a direction",
        async run(bot) {
          rememberExploredArea(bot.entity.position);
          const angle = Math.random() * Math.PI * 2;
          const target = bot.entity.position.offset(
            Math.cos(angle) * 20, 0, Math.sin(angle) * 20
          );
          await bot.lookAt(target);
          bot.setControlState("forward", true);
          bot.setControlState("sprint", true);
          await sleep(3000);
          bot.setControlState("forward", false);
          bot.setControlState("sprint", false);
          return "exploring";
        },
      },
    ],
  },
};

export function getDependencyInfo(bot) {
  const inv = {};
  for (const item of bot.inventory.items()) {
    inv[item.name] = (inv[item.name] || 0) + item.count;
  }

  const logCount = Object.entries(inv).filter(([k]) => k.includes("_log")).reduce((s, [, v]) => s + v, 0);
  const plankCount = Object.entries(inv).filter(([k]) => k.includes("_planks")).reduce((s, [, v]) => s + v, 0);
  const cobble = inv.cobblestone || 0;
  const iron = inv.iron_ingot || 0;
  const rawIron = inv.raw_iron || 0;
  const sticks = inv.stick || 0;
  const mem = getMemory();

  const canDo = [];
  const blocked = [];

  if (logCount < 4) blocked.push("craft_tools needs 4+ logs");
  else canDo.push("craft_tools");

  if (!hasAny(bot, ["wooden_pickaxe", "stone_pickaxe", "iron_pickaxe"]))
    blocked.push("mine_stone needs a pickaxe");
  else canDo.push("mine_stone");

  if (cobble < 8) blocked.push("craft_furnace needs 8 cobblestone");
  else canDo.push("craft_furnace");

  if (cobble < 5) blocked.push("upgrade_tools needs 5 cobblestone");
  else if (sticks < 4 && plankCount < 2) blocked.push("upgrade_tools needs sticks or planks");
  else canDo.push("upgrade_tools");

  if (!hasAny(bot, ["stone_pickaxe", "iron_pickaxe"]))
    blocked.push("mine_iron needs stone pickaxe or better");
  else canDo.push("mine_iron");

  if (iron < 5 && rawIron < 5) blocked.push("craft_iron_tools needs 5 iron ingots");
  else canDo.push("craft_iron_tools");

  if (!mem.furnace && !findBlock(bot, ["furnace"], 32))
    blocked.push("cook_food and smelt_iron need a furnace");

  return { canDo, blocked };
}

export { LOG_BLOCKS, PLANK_BLOCKS };
