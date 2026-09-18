import { getEmotions, getEmotionLabel, getRecentEvents } from "./mind.js";
import { getGoalProgress } from "./tactics.js";

const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
};

function timestamp() {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

export function logState(state) {
  const { player, time_of_day, nearby_hostiles } = state;
  const hostileStr =
    nearby_hostiles.length > 0
      ? nearby_hostiles
          .map((h) => `${h.name}(${h.distance}m ${h.direction})`)
          .join(", ")
      : "none";

  console.log(
    `${COLORS.dim}[${timestamp()}]${COLORS.reset} ` +
      `${COLORS.cyan}HP:${player.health}${COLORS.reset} ` +
      `${COLORS.green}Food:${player.food}${COLORS.reset} ` +
      `${COLORS.yellow}Time:${time_of_day}${COLORS.reset} ` +
      `${COLORS.red}Hostiles:${hostileStr}${COLORS.reset}`
  );
}

export function logMind() {
  const emotions = getEmotions();
  const feeling = getEmotionLabel();
  const events = getRecentEvents();

  const emotionBar = (val) => {
    const filled = Math.round(val * 5);
    return "█".repeat(filled) + "░".repeat(5 - filled);
  };

  console.log(
    `${COLORS.dim}[${timestamp()}]${COLORS.reset} ` +
      `${COLORS.magenta}Mind:${feeling}${COLORS.reset} ` +
      `fear:${emotionBar(emotions.fear)} ` +
      `sat:${emotionBar(emotions.satisfaction)} ` +
      `cur:${emotionBar(emotions.curiosity)} ` +
      `urg:${emotionBar(emotions.urgency)}`
  );

  if (events.length > 0) {
    const latest = events[events.length - 1];
    console.log(
      `${COLORS.dim}[${timestamp()}]${COLORS.reset} ` +
        `${COLORS.dim}Latest: ${latest.event} (${latest.ago})${COLORS.reset}`
    );
  }

  const progress = getGoalProgress();
  if (progress && progress.total_failures > 0) {
    const stuckStr =
      progress.stuck_on.length > 0
        ? ` ${COLORS.red}STUCK:${progress.stuck_on.join("; ")}${COLORS.reset}`
        : "";
    console.log(
      `${COLORS.dim}[${timestamp()}]${COLORS.reset} ` +
        `${COLORS.yellow}Progress:${COLORS.reset} ` +
        `${progress.goal} ${progress.time_on_goal}s ` +
        `fails:${progress.total_failures}` +
        `${progress.plan ? ` plan:${progress.plan}` : ""}` +
        stuckStr
    );
  }
}

export function logDecision(decisions) {
  const { action, threatLevel, shouldEat } = decisions;
  const threatScore = threatLevel.score.toFixed(1);
  const threatLabel = threatLevel.legend[String(Math.round(threatLevel.score))];

  console.log(
    `${COLORS.dim}[${timestamp()}]${COLORS.reset} ` +
      `${COLORS.blue}Action:${action.choice}${COLORS.reset}` +
      `(${(action.confidence * 100).toFixed(0)}%) ` +
      `Threat:${threatScore}/${threatLabel || "?"} ` +
      `Eat:${(shouldEat.noul * 100).toFixed(0)}%`
  );
}

export function logGoal(message) {
  console.log(
    `${COLORS.dim}[${timestamp()}]${COLORS.reset} ` +
      `${COLORS.magenta}GOAL: ${message}${COLORS.reset}`
  );
}

export function logAction(result) {
  console.log(
    `${COLORS.dim}[${timestamp()}]${COLORS.reset} ` +
      `${COLORS.white}=> ${result}${COLORS.reset}`
  );
}

export function logChat(username, message) {
  console.log(
    `${COLORS.dim}[${timestamp()}]${COLORS.reset} ` +
      `${COLORS.cyan}<${username}>${COLORS.reset} ${message}`
  );
}

export function logError(msg, err) {
  console.error(
    `${COLORS.red}[${timestamp()}] ERROR: ${msg}${COLORS.reset}`,
    err?.message || ""
  );
}
