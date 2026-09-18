import { TypeSafeClient, choice, score, noul } from "@typesafe-ai/sdk";
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
const STEP_FAIL_SKIP = 3;
const GOAL_ABANDON_THRESHOLD = 8;

let stepFailures = {};
let recentResults = [];
let totalGoalFailures = 0;
let goalPlan = null;

function resetProgress() {
  stepFailures = {};
  recentResults = [];
  totalGoalFailures = 0;
  goalPlan = null;
}

function isFailure(result) {
  if (!result || typeof result !== "string") return true;
  return /^(no |can't |cannot |failed|error|couldn't)/i.test(result);
}

function trackStepResult(stepName, result, success) {
  recentResults.push({ step: stepName, result, success, time: Date.now() });
  if (recentResults.length > 8) recentResults.shift();

  if (!success) {
    if (!stepFailures[stepName])
      stepFailures[stepName] = { count: 0, lastResult: "" };
    stepFailures[stepName].count++;
    stepFailures[stepName].lastResult = result;
    totalGoalFailures++;
  } else {
    if (stepFailures[stepName]) stepFailures[stepName].count = 0;
  }
}

export function getGoalProgress() {
  if (!currentGoalName) return null;
  const stuckSteps = Object.entries(stepFailures)
    .filter(([, v]) => v.count >= STEP_FAIL_SKIP)
    .map(([name, v]) => `${name} failed ${v.count}x: ${v.lastResult}`);

  return {
    goal: currentGoalName,
    time_on_goal: Math.round((Date.now() - goalStartedAt) / 1000),
    recent_results: recentResults.slice(-5).map((r) => `${r.step}: ${r.result}`),
    stuck_on: stuckSteps,
    total_failures: totalGoalFailures,
    plan: goalPlan,
  };
}

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
    onGoalComplete(currentGoalName);
    manualGoal = null;
    currentGoalName = null;
    currentStepIndex = 0;
    goalState = {};
    resetProgress();
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
  const progress = getGoalProgress();

  const progressContext = progress
    ? [
        `Goal "${progress.goal}" running for ${progress.time_on_goal}s.`,
        progress.total_failures > 0
          ? `Failed ${progress.total_failures} times.`
          : "",
        progress.stuck_on.length > 0
          ? `STUCK on: ${progress.stuck_on.join("; ")}.`
          : "",
        progress.recent_results.length > 0
          ? `Recent: ${progress.recent_results.slice(-3).join(", ")}.`
          : "",
      ]
        .filter(Boolean)
        .join(" ")
    : "";

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
    const reqs =
      goal.requires.length > 0
        ? ` (needs: ${goal.requires.join(", ")})`
        : "";
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
          memory.shelter
            ? `Shelter at: ${memory.shelter.x},${memory.shelter.y},${memory.shelter.z}.`
            : "No shelter built yet.",
          memory.furnace
            ? `Furnace at: ${memory.furnace.x},${memory.furnace.y},${memory.furnace.z}.`
            : "",
          memory.player_preferences.length > 0
            ? `Player preferences: ${memory.player_preferences.join("; ")}.`
            : "",
          `Bot is feeling ${mind.feeling}. Fear: ${mind.emotions.fear}, Urgency: ${mind.emotions.urgency}.`,
          mind.recalled_memory
            ? `Memories: ${mind.recalled_memory.join(" | ")}`
            : "",
          progressContext,
          progress && progress.total_failures >= 5
            ? `The bot is struggling with "${progress.goal}". Consider switching to a prerequisite goal or a completely different approach.`
            : "",
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
          progress && progress.total_failures >= 5
            ? `The current goal has failed ${progress.total_failures} times — switching is probably smart.`
            : "",
        ].join(" "),
        [
          "Low — current goal is fine, no reason to switch",
          "Medium — a better option exists but not urgent",
          "High — should switch now, situation demands it",
        ]
      ),
      approach: choice(
        [
          `If starting a new goal, what approach should the bot take?`,
          `Available resources: ${logCount} logs, ${plankCount} planks, ${cobble} cobblestone, ${ironIngots} iron.`,
          `Can do: ${deps.canDo.join(", ") || "none"}.`,
          memory.crafting_table
            ? `Crafting table remembered at ${memory.crafting_table.x},${memory.crafting_table.y},${memory.crafting_table.z}.`
            : "",
          memory.furnace
            ? `Furnace remembered at ${memory.furnace.x},${memory.furnace.y},${memory.furnace.z}.`
            : "",
        ].join(" "),
        {
          direct:
            "Start immediately — the bot has what it needs or can find it nearby",
          gather_first:
            "Gather prerequisite materials first — missing key resources for the goal",
          go_to_station:
            "Travel to a crafting table or furnace first — need a workstation",
          explore_first:
            "Explore to find resources — nothing useful nearby, need to move to a new area",
        }
      ),
    },
  });

  const newGoal = response.answers.goal.choice;
  const urgency = response.answers.urgency.score;
  const approach = response.answers.approach.choice;
  const isPlayerCommand = command !== null;

  const shouldSwitch =
    isPlayerCommand ||
    urgency >= config.thresholds.goalSwitchUrgency ||
    currentGoalName === null ||
    (progress && progress.total_failures >= GOAL_ABANDON_THRESHOLD);

  if (newGoal !== currentGoalName && shouldSwitch) {
    const oldGoal = currentGoalName;
    currentGoalName = newGoal;
    manualGoal = isPlayerCommand ? newGoal : null;
    currentStepIndex = 0;
    goalState = {};
    goalStartedAt = Date.now();
    resetProgress();
    goalPlan = approach;

    const prefix = isPlayerCommand ? `player said "${command}" → ` : "";
    const abandonNote =
      oldGoal && progress && progress.total_failures >= GOAL_ABANDON_THRESHOLD
        ? `(abandoned ${oldGoal} after ${progress.total_failures} failures) `
        : "";
    return {
      switched: true,
      message: `${prefix}${abandonNote}new goal: ${newGoal} (urgency: ${urgency.toFixed(1)}, approach: ${approach})`,
    };
  }

  return {
    switched: false,
    message: `staying on: ${currentGoalName} (${newGoal} urgency: ${urgency.toFixed(1)})`,
  };
}

async function askJevForStep(goalName, runnableSteps) {
  const stepOptions = {};
  for (const s of runnableSteps) {
    const failures = stepFailures[s.name]?.count || 0;
    const failInfo =
      failures > 0
        ? ` — has failed ${failures}x: "${stepFailures[s.name].lastResult}"`
        : "";
    stepOptions[s.name] = s.name + failInfo;
  }

  const recentContext =
    recentResults.length > 0
      ? `Recent attempts: ${recentResults.slice(-3).map((r) => `${r.step}: ${r.result}`).join(", ")}.`
      : "";

  const response = await client.systemOne({
    model: config.jev.model,
    state: { goal: goalName, plan: goalPlan },
    questions: {
      step: choice(
        [
          `The bot is working on "${goalName}" but struggling.`,
          `Which step should it try next?`,
          recentContext,
          goalPlan ? `Original approach: ${goalPlan}.` : "",
          `Pick the step most likely to make progress, avoiding ones that keep failing.`,
        ].join(" "),
        stepOptions
      ),
    },
  });

  const chosen = response.answers.step.choice;
  return runnableSteps.find((s) => s.name === chosen) || runnableSteps[0];
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
    resetProgress();
    return wasManual
      ? `goal complete: ${goalName} — back to autonomous`
      : `goal complete: ${goalName}`;
  }

  const steps = goal.steps;
  const runnableSteps = [];
  const skippedSteps = [];

  for (const s of steps) {
    if (s.canRun && !s.canRun(bot)) continue;
    const failures = stepFailures[s.name]?.count || 0;
    if (failures >= STEP_FAIL_SKIP) {
      skippedSteps.push(s);
      continue;
    }
    runnableSteps.push(s);
  }

  if (runnableSteps.length === 0) {
    if (skippedSteps.length > 0) {
      const response = await client.systemOne({
        model: config.jev.model,
        state: {
          goal: goalName,
          failures: totalGoalFailures,
          stuck: skippedSteps.map((s) => ({
            step: s.name,
            failures: stepFailures[s.name]?.count || 0,
            last_error: stepFailures[s.name]?.lastResult || "",
          })),
        },
        questions: {
          abandon: noul(
            [
              `The bot is stuck on goal "${goalName}".`,
              `All steps have failed repeatedly: ${skippedSteps.map((s) => `${s.name} (${stepFailures[s.name]?.count}x: "${stepFailures[s.name]?.lastResult}")`).join(", ")}.`,
              `Should the bot abandon this goal and try something else?`,
              `Abandoning lets the tactical layer pick a better goal. Retrying resets failure counts and tries again.`,
            ].join(" "),
            {
              true: "Yes — abandon and let the bot pick a more achievable goal",
              false: "No — retry, the steps might work now if conditions changed",
            }
          ),
        },
      });

      if (response.answers.abandon.noul > 0.5) {
        const msg = `abandoned ${goalName} — all steps failing (${totalGoalFailures} failures)`;
        manualGoal = null;
        currentGoalName = null;
        goalState = {};
        resetProgress();
        return msg;
      }

      stepFailures = {};
      totalGoalFailures = Math.floor(totalGoalFailures / 2);
      return `[${goalName}] retrying — reset failure counts`;
    }

    return `[${goalName}] blocked — no runnable steps (missing prerequisites)`;
  }

  let step;

  if (runnableSteps.length > 1 && totalGoalFailures >= 3) {
    step = await askJevForStep(goalName, runnableSteps);
  } else {
    step = runnableSteps[0];
  }

  currentStepIndex = steps.indexOf(step);

  try {
    const result = await step.run(bot, goalState);
    const failed = isFailure(result);
    trackStepResult(step.name, result, !failed);
    return `[${goalName}/${step.name}] ${result}`;
  } catch (err) {
    trackStepResult(step.name, err.message, false);
    return `[${goalName}/${step.name}] error: ${err.message}`;
  }
}
