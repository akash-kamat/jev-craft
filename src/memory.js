import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const MEMORY_FILE = join(process.cwd(), "bot-memory.json");
const MAX_ENTRIES_PER_TYPE = 20;

const defaultMemory = {
  shelter: null,
  crafting_table: null,
  furnace: null,
  death_locations: [],
  resource_locations: {},
  danger_zones: [],
  player_preferences: [],
  explored_chunks: [],
  last_known_animals: [],
  episodes: [],
};

let memory = loadMemory();

function loadMemory() {
  try {
    if (existsSync(MEMORY_FILE)) {
      return JSON.parse(readFileSync(MEMORY_FILE, "utf8"));
    }
  } catch {}
  return { ...defaultMemory };
}

function save() {
  try {
    writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
  } catch {}
}

export function getMemory() {
  return memory;
}

export function rememberShelter(position) {
  memory.shelter = {
    x: Math.round(position.x),
    y: Math.round(position.y),
    z: Math.round(position.z),
    built_at: Date.now(),
  };
  save();
}

export function rememberCraftingTable(position) {
  memory.crafting_table = {
    x: Math.round(position.x),
    y: Math.round(position.y),
    z: Math.round(position.z),
  };
  save();
}

export function rememberFurnace(position) {
  memory.furnace = {
    x: Math.round(position.x),
    y: Math.round(position.y),
    z: Math.round(position.z),
  };
  save();
}

export function rememberDeath(position, cause) {
  memory.death_locations.push({
    x: Math.round(position.x),
    y: Math.round(position.y),
    z: Math.round(position.z),
    cause,
    time: Date.now(),
  });
  if (memory.death_locations.length > MAX_ENTRIES_PER_TYPE) {
    memory.death_locations.shift();
  }
  save();
}

export function rememberResource(type, position) {
  memory.resource_locations[type] = {
    x: Math.round(position.x),
    y: Math.round(position.y),
    z: Math.round(position.z),
    found_at: Date.now(),
  };
  save();
}

export function rememberDanger(position, reason) {
  const existing = memory.danger_zones.find(
    (d) =>
      Math.abs(d.x - position.x) < 10 &&
      Math.abs(d.z - position.z) < 10
  );
  if (existing) return;

  memory.danger_zones.push({
    x: Math.round(position.x),
    y: Math.round(position.y),
    z: Math.round(position.z),
    reason,
  });
  if (memory.danger_zones.length > MAX_ENTRIES_PER_TYPE) {
    memory.danger_zones.shift();
  }
  save();
}

export function rememberPlayerPreference(text) {
  if (memory.player_preferences.includes(text)) return;
  memory.player_preferences.push(text);
  if (memory.player_preferences.length > 10) {
    memory.player_preferences.shift();
  }
  save();
}

export function rememberAnimalArea(position) {
  const existing = memory.last_known_animals.find(
    (a) =>
      Math.abs(a.x - position.x) < 20 &&
      Math.abs(a.z - position.z) < 20
  );
  if (existing) {
    existing.x = Math.round(position.x);
    existing.z = Math.round(position.z);
    existing.seen_at = Date.now();
  } else {
    memory.last_known_animals.push({
      x: Math.round(position.x),
      y: Math.round(position.y),
      z: Math.round(position.z),
      seen_at: Date.now(),
    });
    if (memory.last_known_animals.length > 5) {
      memory.last_known_animals.shift();
    }
  }
  save();
}

export function rememberExploredArea(position) {
  const chunkX = Math.floor(position.x / 32);
  const chunkZ = Math.floor(position.z / 32);
  const key = `${chunkX},${chunkZ}`;

  if (!memory.explored_chunks.includes(key)) {
    memory.explored_chunks.push(key);
    if (memory.explored_chunks.length > 50) {
      memory.explored_chunks.shift();
    }
    save();
  }
}

export function getMemoryForState(playerPosition) {
  const relevant = {
    shelter: memory.shelter,
    crafting_table: memory.crafting_table,
    furnace: memory.furnace,
    player_preferences: memory.player_preferences,
  };

  if (memory.death_locations.length > 0) {
    relevant.recent_deaths = memory.death_locations.slice(-3);
  }

  const nearbyResources = {};
  for (const [type, loc] of Object.entries(memory.resource_locations)) {
    const dist = Math.sqrt(
      (loc.x - playerPosition.x) ** 2 + (loc.z - playerPosition.z) ** 2
    );
    if (dist < 200) {
      nearbyResources[type] = { ...loc, distance: Math.round(dist) };
    }
  }
  if (Object.keys(nearbyResources).length > 0) {
    relevant.nearby_resources = nearbyResources;
  }

  const nearbyDangers = memory.danger_zones.filter((d) => {
    const dist = Math.sqrt(
      (d.x - playerPosition.x) ** 2 + (d.z - playerPosition.z) ** 2
    );
    return dist < 50;
  });
  if (nearbyDangers.length > 0) {
    relevant.danger_zones = nearbyDangers;
  }

  relevant.explored_area_count = memory.explored_chunks.length;

  return relevant;
}

export function rememberEpisode(summary, tags, position) {
  const episode = {
    summary,
    tags,
    x: Math.round(position.x),
    y: Math.round(position.y),
    z: Math.round(position.z),
    time: Date.now(),
  };
  if (!memory.episodes) memory.episodes = [];
  memory.episodes.push(episode);
  if (memory.episodes.length > 30) {
    memory.episodes.shift();
  }
  save();
}

export function searchEpisodes(tags, position, maxDist = 100) {
  if (!memory.episodes) return [];
  return memory.episodes
    .filter((ep) => {
      const hasTag = tags.some((t) => ep.tags.includes(t));
      if (!hasTag) return false;
      if (!position) return true;
      const dist = Math.sqrt(
        (ep.x - position.x) ** 2 + (ep.z - position.z) ** 2
      );
      return dist < maxDist;
    })
    .slice(-5);
}

export function resetMemory() {
  memory = { ...defaultMemory };
  save();
}
