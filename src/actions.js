import { FOOD_ITEMS } from "./state.js";
import { config } from "./config.js";
import { runGoalStep } from "./tactics.js";
import { logEvent } from "./mind.js";

const DIRECTION_VECTORS = {
  north: { x: 0, z: -1 },
  south: { x: 0, z: 1 },
  east: { x: 1, z: 0 },
  west: { x: -1, z: 0 },
};

function findNearestHostile(bot) {
  let nearest = null;
  let nearestDist = Infinity;

  for (const entity of Object.values(bot.entities)) {
    if (entity === bot.entity) continue;
    if (entity.type !== "mob") continue;

    const dist = bot.entity.position.distanceTo(entity.position);
    if (dist < nearestDist) {
      nearest = entity;
      nearestDist = dist;
    }
  }
  return nearest;
}

async function doFight(bot) {
  const sword = bot.inventory.items().find((i) => i.name.includes("sword"));
  if (sword) {
    try {
      await bot.equip(sword, "hand");
    } catch {}
  }

  const target = findNearestHostile(bot);
  if (!target) return "no target found";

  const dist = bot.entity.position.distanceTo(target.position);
  if (dist > 4) {
    bot.setControlState("forward", true);
    await bot.lookAt(target.position.offset(0, target.height, 0));
    await sleep(300);
    bot.setControlState("forward", false);
  } else {
    await bot.lookAt(target.position.offset(0, target.height, 0));
    bot.attack(target);
  }

  const name = target.name || "mob";
  logEvent(`fighting ${name}`);
  return `attacking ${name}`;
}

async function doFlee(bot, direction) {
  const vec = DIRECTION_VECTORS[direction] || DIRECTION_VECTORS.north;
  const target = bot.entity.position.offset(vec.x * 20, 0, vec.z * 20);

  await bot.lookAt(target);
  bot.setControlState("forward", true);
  bot.setControlState("sprint", true);

  await sleep(1500);

  bot.setControlState("forward", false);
  bot.setControlState("sprint", false);

  logEvent(`fled ${direction}`);
  return `fled ${direction}`;
}

async function doEat(bot) {
  const foodItem = bot.inventory
    .items()
    .find((item) => FOOD_ITEMS.has(item.name));
  if (!foodItem) return "no food available";

  try {
    await bot.equip(foodItem, "hand");
    bot.activateItem();
    await sleep(1800);
    bot.deactivateItem();
    logEvent(`ate ${foodItem.name}`);
    return `ate ${foodItem.name}`;
  } catch (err) {
    return `failed to eat: ${err.message}`;
  }
}

async function doLookAround(bot) {
  const yaw = bot.entity.yaw + Math.PI / 2;
  await bot.look(yaw, 0);
  return "looked around";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeAction(bot, decisions) {
  const { action, shouldEat, fleeDirection, threatLevel } = decisions;

  if (shouldEat.noul > config.thresholds.eatHunger && action.choice !== "fight") {
    return doEat(bot);
  }

  switch (action.choice) {
    case "fight":
      if (action.confidence >= config.thresholds.fightConfidence) {
        return doFight(bot);
      }
      return doLookAround(bot);

    case "flee":
      if (action.confidence >= config.thresholds.fleeConfidence) {
        return doFlee(bot, fleeDirection.choice);
      }
      return doLookAround(bot);

    case "eat":
      return doEat(bot);

    case "continue_goal":
      return runGoalStep(bot);

    case "look_around":
      return doLookAround(bot);

    default:
      return runGoalStep(bot);
  }
}
