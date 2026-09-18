import { TypeSafeClient, choice, score, noul } from "@typesafe-ai/sdk";
import { config } from "./config.js";
import { getCurrentGoal } from "./tactics.js";
import { getMindState, searchMemory } from "./mind.js";

const client = new TypeSafeClient();

export async function decide(state) {
  const hasHostiles = state.nearby_hostiles.length > 0;
  const currentGoal = getCurrentGoal();
  const mind = getMindState();

  searchMemory(state);

  const hostileContext = hasHostiles
    ? state.nearby_hostiles
        .slice(0, 3)
        .map((h) => `${h.name} ${h.distance}m ${h.direction}`)
        .join(", ")
    : "none";

  const recallContext = mind.recalled_memory
    ? `Recalled memories: ${mind.recalled_memory.join(" | ")}`
    : "";

  const emotionContext = `Feeling: ${mind.feeling} (fear:${mind.emotions.fear} satisfaction:${mind.emotions.satisfaction} curiosity:${mind.emotions.curiosity} urgency:${mind.emotions.urgency}).`;

  const recentContext =
    mind.recent_events.length > 0
      ? `Recent: ${mind.recent_events.map((e) => `${e.event} (${e.ago})`).join(", ")}.`
      : "";

  const cleanState = {
    player: state.player,
    time_of_day: state.time_of_day,
    nearby_hostiles: state.nearby_hostiles.slice(0, 3),
    nearby_entities: state.nearby_entities.slice(0, 3),
    has_food: state.has_food,
    current_goal: currentGoal,
    emotions: mind.emotions,
    feeling: mind.feeling,
  };

  const response = await client.systemOne({
    model: config.jev.model,
    state: cleanState,
    questions: {
      threat_level: score(
        [
          `How dangerous is the bot's situation?`,
          `Hostiles: ${hostileContext}.`,
          `HP: ${state.player.health}/20. Time: ${state.time_of_day}.`,
          emotionContext,
          recallContext,
        ].join(" "),
        [
          "Safe — no threats, good health, feeling calm",
          "Caution — minor threat, night approaching, or slightly anxious",
          "Moderate danger — hostile nearby but manageable",
          "High danger — close hostile, low health, or multiple threats",
          "Critical — immediate death likely without action",
        ]
      ),

      action: choice(
        [
          `What should the bot do right now?`,
          `Hostiles: ${hostileContext}. HP: ${state.player.health}/20, Hunger: ${state.player.food}/20.`,
          `Time: ${state.time_of_day}. Has food: ${state.has_food}.`,
          currentGoal ? `Working on: ${currentGoal}.` : "No active goal.",
          emotionContext,
          recentContext,
          recallContext,
        ].join(" "),
        {
          fight:
            "Attack the nearest hostile — when one is nearby, health is okay, and bot isn't too scared",
          flee: "Run away — when outmatched, scared, low health, or near a creeper",
          eat: "Eat food — when hungry and food available",
          continue_goal:
            "Keep working on current goal — when safe and there's something to do",
          look_around:
            "Survey surroundings — when uncertain or curious about the area",
        }
      ),

      should_eat: noul(
        [
          `Should the bot eat now?`,
          `Hunger: ${state.player.food}/20. Has food: ${state.has_food}.`,
          `Food items: ${state.food_items.join(", ") || "none"}.`,
          `In combat: ${hasHostiles && state.nearby_hostiles[0].distance < 6 ? "yes" : "no"}.`,
        ].join(" "),
        {
          true: "Should eat — hunger is getting low and food is available",
          false: "No need — hunger is fine, no food, or in active combat",
        }
      ),

      flee_direction: choice(
        [
          `Which way should the bot flee?`,
          `Hostiles: ${hostileContext}.`,
          `Position: x:${state.player.position.x} z:${state.player.position.z}.`,
          recallContext,
        ].join(" "),
        {
          north: "Run north — away from threats to the south",
          south: "Run south — away from threats to the north",
          east: "Run east — away from threats to the west",
          west: "Run west — away from threats to the east",
        }
      ),
    },
  });

  return {
    threatLevel: response.answers.threat_level,
    action: response.answers.action,
    shouldEat: response.answers.should_eat,
    fleeDirection: response.answers.flee_direction,
  };
}
