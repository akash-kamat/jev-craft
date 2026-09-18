const HOSTILE_MOBS = new Set([
  "zombie",
  "skeleton",
  "creeper",
  "spider",
  "enderman",
  "witch",
  "slime",
  "phantom",
  "drowned",
  "husk",
  "stray",
  "cave_spider",
  "zombified_piglin",
  "piglin_brute",
  "warden",
  "pillager",
  "vindicator",
  "ravager",
  "evoker",
  "blaze",
  "ghast",
  "magma_cube",
  "hoglin",
  "zoglin",
]);

const FOOD_ITEMS = new Set([
  "bread",
  "cooked_beef",
  "cooked_porkchop",
  "cooked_chicken",
  "cooked_mutton",
  "cooked_salmon",
  "cooked_cod",
  "cooked_rabbit",
  "baked_potato",
  "golden_apple",
  "enchanted_golden_apple",
  "apple",
  "melon_slice",
  "sweet_berries",
  "golden_carrot",
  "carrot",
  "potato",
  "beetroot",
  "dried_kelp",
  "raw_beef",
  "raw_porkchop",
  "raw_chicken",
  "raw_mutton",
  "raw_salmon",
  "raw_cod",
  "raw_rabbit",
  "mushroom_stew",
  "rabbit_stew",
  "beetroot_soup",
  "suspicious_stew",
  "cookie",
  "pumpkin_pie",
  "cake",
]);

function getTimeOfDay(bot) {
  const time = bot.time.timeOfDay;
  if (time < 6000) return "morning";
  if (time < 12000) return "afternoon";
  if (time < 13000) return "dusk";
  if (time < 23000) return "night";
  return "dawn";
}

function getNearbyEntities(bot, radius = 16) {
  const entities = [];
  for (const entity of Object.values(bot.entities)) {
    if (entity === bot.entity) continue;
    const dist = bot.entity.position.distanceTo(entity.position);
    if (dist > radius) continue;

    const dx = entity.position.x - bot.entity.position.x;
    const dz = entity.position.z - bot.entity.position.z;
    const angle = Math.atan2(dz, dx) * (180 / Math.PI);

    let direction;
    if (angle >= -45 && angle < 45) direction = "east";
    else if (angle >= 45 && angle < 135) direction = "south";
    else if (angle >= -135 && angle < -45) direction = "north";
    else direction = "west";

    const name = entity.name || entity.username || "unknown";
    entities.push({
      name,
      type: entity.type,
      hostile: HOSTILE_MOBS.has(name),
      distance: Math.round(dist * 10) / 10,
      direction,
      health: entity.health ?? null,
    });
  }

  entities.sort((a, b) => a.distance - b.distance);
  return entities.slice(0, 8);
}

function getInventorySummary(bot) {
  const items = {};
  for (const item of bot.inventory.items()) {
    const name = item.name;
    items[name] = (items[name] || 0) + item.count;
  }
  return items;
}

function getFoodInInventory(bot) {
  return bot.inventory.items().filter((item) => FOOD_ITEMS.has(item.name));
}

function getSurroundingBlocks(bot) {
  const pos = bot.entity.position.floored();
  const blocks = new Set();

  for (let dx = -3; dx <= 3; dx++) {
    for (let dz = -3; dz <= 3; dz++) {
      for (let dy = -1; dy <= 2; dy++) {
        const block = bot.blockAt(pos.offset(dx, dy, dz));
        if (block && block.name !== "air") {
          blocks.add(block.name);
        }
      }
    }
  }
  return [...blocks];
}

export function extractState(bot) {
  const nearbyEntities = getNearbyEntities(bot);
  const hostiles = nearbyEntities.filter((e) => e.hostile);
  const food = getFoodInInventory(bot);
  const inv = getInventorySummary(bot);

  const hasWoodenTools =
    Object.keys(inv).some((k) => k.includes("wooden_pickaxe")) &&
    Object.keys(inv).some((k) => k.includes("wooden_sword"));
  const hasStoneTools =
    Object.keys(inv).some((k) => k.includes("stone_pickaxe")) &&
    Object.keys(inv).some((k) => k.includes("stone_sword"));
  const hasIronTools =
    Object.keys(inv).some((k) => k.includes("iron_pickaxe")) &&
    Object.keys(inv).some((k) => k.includes("iron_sword"));

  const state = {
    player: {
      health: bot.health,
      food: bot.food,
      position: {
        x: Math.round(bot.entity.position.x),
        y: Math.round(bot.entity.position.y),
        z: Math.round(bot.entity.position.z),
      },
      on_ground: bot.entity.onGround,
    },
    time_of_day: getTimeOfDay(bot),
    nearby_hostiles: hostiles,
    nearby_entities: nearbyEntities.filter((e) => !e.hostile),
    has_food: food.length > 0,
    food_items: food.map((f) => f.name),
    inventory_summary: inv,
    nearby_blocks: getSurroundingBlocks(bot),
    has_wooden_tools: hasWoodenTools,
    has_stone_tools: hasStoneTools,
    has_iron_tools: hasIronTools,
    _bot: bot,
  };

  return state;
}

export { FOOD_ITEMS };
