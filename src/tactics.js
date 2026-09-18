import { TypeSafeClient, choice, score } from "@typesafe-ai/sdk";
import { config } from "./config.js";
import { GOALS, getDependencyInfo } from "./goals.js";
import { getMemoryForState } from "./memory.js";
import { getMindState, onGoalComplete } from "./mind.js";

const client = new TypeSafeClient();

let currentGoalName = null;
let currentStepIndex = 0;
let goalStartedAt = 0;
let goalState = {};
let manualGoal = null;
let playerCommand = null;
let playerCommandAt = 0;

const COMMAND_EXPIRY = 30000;

export function getCurrentGoal() {
  return manualGoal || currentGoalName;
}

export function getGoalState() {
  return goalState;
}

export function setPlayerCommand(message) {
  if (message === "auto") {
    playerCommand = null;
    manualGoal = null;
    return "autonomous mode";
  }
  playerCommand = message;
  playerCommandAt = Date.now();
  return `got it: "${message}"`;
}

function consumePlayerCommand() {
  if (!playerCommand) return null;
  if (Date.now() - playerCommandAt > COMMAND_EXPIRY) {
    playerCommand = null;
    return null;
  }
  const cmd = playerCommand;
  playerCommand = null;
  return cmd;
}

export async function pickGoal(state) {
  const command = consumePlayerCommand();

  if (!command) {
    const timeSinceGoalStart = Date.now() - goalStartedAt;
    if (
      currentGoalName &&
      GOALS[currentGoalName] &&
      timeSinceGoalStart < config.jev.minGoalTime &&
      !GOALS[currentGoalName].isDone(state._bot, goalState)
    ) {
      return { switched: false, message: `continuing: ${currentGoalName}` };
    }
  }

  if (currentGoalName && GOALS[currentGoalName]?.isDone(state._bot, goalState)) {
    manualGoal = null;
    currentGoalName = null;
    currentStepIndex = 0;
    goalState = {};
  }

  const inv = state.inventory_summary;
  const logCount = Object.entries(inv)
    .filter(([k]) => k.includes("_log"))
    .reduce((s, [, v]) => s + v, 0);
  const plankCount = Object.entries(inv)
    .filter(([k]) => k.includes("_planks"))
    .reduce((s, [, v]) => s + v, 0);
  const cobble = inv.cobblestone || 0;
  const ironIngots = inv.iron_ingot || 0;
  const rawIron = inv.raw_iron || 0;

  const hasPickaxe = Object.keys(inv).some((k) => k.includes("pickaxe"));
  const hasSword = Object.keys(inv).some((k) => k.includes("sword"));
  const hasStoneTools = Object.keys(inv).some((k) => k.startsWith("stone_"));
  const hasIronTools = Object.keys(inv).some((k) => k.startsWith("iron_"));

  const deps = getDependencyInfo(state._bot);
  const memory = getMemoryForState(state.player.position);
  const mind = getMindState();

  const tacticalState = {
    time_of_day: state.time_of_day,
    health: state.player.health,
    food: state.player.food,
    logs: logCount,
    planks: plankCount,
    cobblestone: cobble,
    iron_ingots: ironIngots,
    raw_iron: rawIron,
    has_pickaxe: hasPickaxe,
    has_sword: hasSword,
    has_stone_tools: hasStoneTools,
    has_iron_tools: hasIronTools,
    has_food: state.has_food,
    nearby_blocks: state.nearby_blocks.slice(0, 10),
    current_goal: currentGoalName,
    hostile_count: state.nearby_hostiles.length,
    player_command: command || null,
    can_do: deps.canDo,
    blocked: deps.blocked,
    memory,
    feeling: mind.feeling,
    emotions: mind.emotions,
  };

  const commandInstruction = command
    ? `The player just said: "${command}". This is a direct instruction — pick the goal that best matches what the player is asking for. Override the current goal to follow the player's request.`
    : "";

  const goalDescriptions = {};
  for (const [name, goal] of Object.entries(GOALS)) {
    const reqs = goal.requires.length > 0 ? ` (needs: ${goal.requires.join(", ")})` : "";
    goalDescriptions[name] = goal.description + reqs;
  }

  const response = await client.systemOne({
    model: config.jev.model,
    state: tacticalState,
    questions: {
      goal: choice(
        [
          `What should the bot prioritize?`,
          commandInstruction,
          `Logs: ${logCount}, Planks: ${plankCount}, Cobblestone: ${cobble}, Iron: ${ironIngots}, Raw iron: ${rawIron}.`,
          `Has pickaxe: ${hasPickaxe}, Has sword: ${hasSword}, Stone tools: ${hasStoneTools}, Iron tools: ${hasIronTools}.`,
          `Food level: ${state.player.food}/20, Has food items: ${state.has_food}.`,
          `Time: ${state.time_of_day}. Hostiles nearby: ${state.nearby_hostiles.length}.`,
          `Current goal: ${currentGoalName || "none"}.`,
          `Can do now: ${deps.canDo.join(", ") || "none"}.`,
          `Blocked: ${deps.blocked.join("; ") || "none"}.`,
          memory.shelter ? `Shelter at: ${memory.shelter.x},${memory.shelter.y},${memory.shelter.z}.` : "No shelter built yet.",
          memory.furnace ? `Furnace at: ${memory.furnace.x},${memory.furnace.y},${memory.furnace.z}.` : "",
          memory.player_preferences.length > 0 ? `Player preferences: ${memory.player_preferences.join("; ")}.` : "",
          `Bot is feeling ${mind.feeling}. Fear: ${mind.emotions.fear}, Urgency: ${mind.emotions.urgency}.`,
          mind.recalled_memory ? `Memories: ${mind.recalled_memory.join(" | ")}` : "",
        ].join(" "),
        goalDescriptions
      ),
      urgency: score(
        [
          `How urgently should the bot switch to a new goal?`,
          command
            ? `The player gave a direct command: "${command}". Player commands are always high urgency.`
            : "",
          `Current goal: ${currentGoalName || "none"}.`,
          `Time: ${state.time_of_day}. Health: ${state.player.health}/20.`,
        ].join(" "),
        [
          "Low — current goal is fine, no reason to switch",
          "Medium — a better option exists but not urgent",
          "High — should switch now, situation demands it",
        ]
      ),
    },
  });

  const newGoal = response.answers.goal.choice;
  const urgency = response.answers.urgency.score;
  const isPlayerCommand = command !== null;

  if (
    newGoal !== currentGoalName &&
    (isPlayerCommand || urgency >= config.thresholds.goalSwitchUrgency || currentGoalName === null)
  ) {
    currentGoalName = newGoal;
    manualGoal = isPlayerCommand ? newGoal : null;
    currentStepIndex = 0;
    goalState = {};
    goalStartedAt = Date.now();
    const prefix = isPlayerCommand ? `player said "${command}" → ` : "";
    return { switched: true, message: `${prefix}new goal: ${newGoal} (urgency: ${urgency.toFixed(1)})` };
  }

  return { switched: false, message: `staying on: ${currentGoalName} (${newGoal} urgency: ${urgency.toFixed(1)})` };
}

export async function runGoalStep(bot) {
  const goalName = getCurrentGoal();
  if (!goalName || !GOALS[goalName]) {
    return "no active goal";
  }

  const goal = GOALS[goalName];

  if (goal.isDone(bot, goalState)) {
    const wasManual = manualGoal === goalName;
    onGoalComplete(goalName);
    manualGoal = null;
    currentGoalName = null;
    currentStepIndex = 0;
    goalState = {};
    return wasManual
      ? `goal complete: ${goalName} — back to autonomous`
      : `goal complete: ${goalName}`;
  }

  const steps = goal.steps;
  let step = null;

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.canRun && !s.canRun(bot)) continue;
    step = s;
    currentStepIndex = i;
    break;
  }

  if (!step) {
    step = steps[steps.length - 1];
  }

  try {
    const result = await step.run(bot, goalState);
    return `[${goalName}/${step.name}] ${result}`;
  } catch (err) {
    return `[${goalName}/${step.name}] error: ${err.message}`;
  }
}
