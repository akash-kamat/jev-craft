import { getMemory } from "./memory.js";

const DECAY_RATE = 0.92;
const MAX_EVENTS = 10;

const emotions = {
  fear: 0.1,
  satisfaction: 0.3,
  curiosity: 0.7,
  urgency: 0.2,
};

const eventLog = [];
let lastHealth = 20;
let lastFood = 20;
let ticksSinceGoalComplete = 0;
let ticksInSameArea = 0;
let lastAreaKey = null;
let recalledMemory = null;

export function getEmotions() {
  return { ...emotions };
}

export function getRecentEvents() {
  return eventLog.slice(-8);
}

export function getRecalledMemory() {
  const mem = recalledMemory;
  recalledMemory = null;
  return mem;
}

export function logEvent(event) {
  eventLog.push({
    event,
    time: Date.now(),
    ago: "0s",
  });
  if (eventLog.length > MAX_EVENTS) {
    eventLog.shift();
  }
  updateEventTimestamps();
}

function updateEventTimestamps() {
  const now = Date.now();
  for (const e of eventLog) {
    const seconds = Math.round((now - e.time) / 1000);
    e.ago = `${seconds}s`;
  }
}

export function updateEmotions(state) {
  const health = state.player.health ?? 20;
  const food = state.player.food ?? 20;
  const hostileCount = state.nearby_hostiles.length;
  const timeOfDay = state.time_of_day;

  // --- Fear ---
  emotions.fear *= DECAY_RATE;

  if (health < lastHealth) {
    const damage = lastHealth - health;
    emotions.fear += damage * 0.08;
    logEvent(`took ${damage} damage (HP: ${health})`);
  }

  if (hostileCount > 0) {
    const nearest = state.nearby_hostiles[0];
    const proximity = Math.max(0, 1 - nearest.distance / 16);
    emotions.fear += proximity * 0.15;

    if (nearest.name === "creeper" && nearest.distance < 8) {
      emotions.fear += 0.25;
    }
  }

  if (timeOfDay === "night") emotions.fear += 0.03;
  if (timeOfDay === "dusk") emotions.fear += 0.02;
  if (health <= 6) emotions.fear += 0.1;

  const mem = getMemory();
  const pos = state.player.position;
  for (const danger of mem.danger_zones || []) {
    const dist = Math.sqrt((danger.x - pos.x) ** 2 + (danger.z - pos.z) ** 2);
    if (dist < 20) {
      emotions.fear += 0.05 * (1 - dist / 20);
    }
  }

  // --- Satisfaction ---
  emotions.satisfaction *= DECAY_RATE;
  ticksSinceGoalComplete++;

  if (health > lastHealth) {
    emotions.satisfaction += 0.05;
  }
  if (food > lastFood) {
    emotions.satisfaction += 0.03;
  }

  // --- Curiosity ---
  emotions.curiosity *= DECAY_RATE;

  const areaKey = `${Math.floor(pos.x / 16)},${Math.floor(pos.z / 16)}`;
  if (areaKey === lastAreaKey) {
    ticksInSameArea++;
    if (ticksInSameArea > 30) {
      emotions.curiosity += 0.04;
    }
  } else {
    lastAreaKey = areaKey;
    ticksInSameArea = 0;
    emotions.curiosity += 0.02;
  }

  if (timeOfDay === "morning") emotions.curiosity += 0.01;

  // --- Urgency ---
  emotions.urgency *= DECAY_RATE;

  if (food <= 6) emotions.urgency += 0.1;
  if (health <= 10) emotions.urgency += 0.08;
  if (timeOfDay === "dusk") emotions.urgency += 0.06;
  if (timeOfDay === "night" && !mem.shelter) emotions.urgency += 0.08;
  if (hostileCount >= 2) emotions.urgency += 0.05;

  // --- Clamp all to [0, 1] ---
  for (const key of Object.keys(emotions)) {
    emotions[key] = Math.max(0, Math.min(1, emotions[key]));
  }

  lastHealth = health;
  lastFood = food;
}

export function onGoalComplete(goalName) {
  emotions.satisfaction += 0.2;
  ticksSinceGoalComplete = 0;
  logEvent(`completed goal: ${goalName}`);
}

export function onDeath() {
  emotions.fear = 0.9;
  emotions.satisfaction *= 0.3;
  logEvent("died and respawned");
}

export function onPlayerChat(message) {
  emotions.urgency += 0.1;
  logEvent(`player said: "${message}"`);
}

export function onKill(mobName) {
  emotions.satisfaction += 0.1;
  emotions.fear *= 0.7;
  logEvent(`killed ${mobName}`);
}

export function searchMemory(state) {
  const mem = getMemory();
  const pos = state.player.position;
  const candidates = [];

  for (const death of mem.death_locations || []) {
    const dist = Math.sqrt((death.x - pos.x) ** 2 + (death.z - pos.z) ** 2);
    if (dist < 30) {
      candidates.push({
        relevance: 1 - dist / 30,
        memory: `I died near here at (${death.x}, ${death.y}, ${death.z}). Cause: ${death.cause}. I should be careful.`,
      });
    }
  }

  for (const [type, loc] of Object.entries(mem.resource_locations || {})) {
    const dist = Math.sqrt((loc.x - pos.x) ** 2 + (loc.z - pos.z) ** 2);
    if (dist < 100 && dist > 10) {
      candidates.push({
        relevance: 0.5,
        memory: `I found ${type} at (${loc.x}, ${loc.y}, ${loc.z}), about ${Math.round(dist)} blocks away.`,
      });
    }
  }

  if (mem.shelter) {
    const dist = Math.sqrt(
      (mem.shelter.x - pos.x) ** 2 + (mem.shelter.z - pos.z) ** 2
    );
    if (state.time_of_day === "dusk" || state.time_of_day === "night") {
      candidates.push({
        relevance: 0.8,
        memory: `My shelter is at (${mem.shelter.x}, ${mem.shelter.y}, ${mem.shelter.z}), ${Math.round(dist)} blocks away.`,
      });
    }
  }

  for (const animal of mem.last_known_animals || []) {
    if (state.player.food <= 14 || !state.has_food) {
      const dist = Math.sqrt(
        (animal.x - pos.x) ** 2 + (animal.z - pos.z) ** 2
      );
      if (dist < 80) {
        candidates.push({
          relevance: 0.4,
          memory: `I saw animals near (${animal.x}, ${animal.y}, ${animal.z}), about ${Math.round(dist)} blocks away.`,
        });
      }
    }
  }

  for (const pref of mem.player_preferences || []) {
    candidates.push({
      relevance: 0.6,
      memory: `The player told me: "${pref}"`,
    });
  }

  if (candidates.length === 0) return;

  candidates.sort((a, b) => b.relevance - a.relevance);
  recalledMemory = candidates.slice(0, 3).map((c) => c.memory);
}

export function getEmotionLabel() {
  const dominant = Object.entries(emotions).sort((a, b) => b[1] - a[1])[0];
  const [name, value] = dominant;

  if (value < 0.2) return "calm";

  const labels = {
    fear: value > 0.6 ? "terrified" : "anxious",
    satisfaction: value > 0.6 ? "proud" : "content",
    curiosity: value > 0.6 ? "eager" : "curious",
    urgency: value > 0.6 ? "desperate" : "focused",
  };

  return labels[name] || "neutral";
}

export function getMindState() {
  updateEventTimestamps();
  return {
    emotions: {
      fear: Math.round(emotions.fear * 100) / 100,
      satisfaction: Math.round(emotions.satisfaction * 100) / 100,
      curiosity: Math.round(emotions.curiosity * 100) / 100,
      urgency: Math.round(emotions.urgency * 100) / 100,
    },
    feeling: getEmotionLabel(),
    recent_events: getRecentEvents(),
    recalled_memory: recalledMemory,
  };
}
