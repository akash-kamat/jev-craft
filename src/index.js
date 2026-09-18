import "dotenv/config";
import mineflayer from "mineflayer";
import { config } from "./config.js";
import { extractState } from "./state.js";
import { decide } from "./decisions.js";
import { executeAction } from "./actions.js";
import { pickGoal, setPlayerCommand, getCurrentGoal } from "./tactics.js";
import { rememberDeath, rememberDanger } from "./memory.js";
import { updateEmotions, onDeath, onPlayerChat, onKill, getEmotionLabel } from "./mind.js";
import {
  logState,
  logDecision,
  logGoal,
  logAction,
  logChat,
  logError,
  logMind,
} from "./logger.js";

let running = false;
let loopsStarted = false;
let lastDeathPos = null;

function createBot() {
  console.log(
    `Connecting to ${config.minecraft.host}:${config.minecraft.port} as ${config.minecraft.username}...`
  );

  const bot = mineflayer.createBot({
    host: config.minecraft.host,
    port: config.minecraft.port,
    username: config.minecraft.username,
    version: config.minecraft.version,
    auth: "offline",
  });

  bot.on("spawn", () => {
    console.log("Bot spawned.\n");
    running = true;
    if (!loopsStarted) {
      loopsStarted = true;
      console.log("Starting survival loops...\n");
      reactiveLoop(bot);
      tacticalLoop(bot);
    }
  });

  bot.on("chat", (username, message) => {
    if (username === bot.username) return;
    const sysPatterns = /^\[.*\]$|^teleported |^summoned |^set |^killed |^gave /i;
    if (sysPatterns.test(message.trim())) {
      logChat(username, `(system) ${message}`);
      return;
    }
    logChat(username, message);
    onPlayerChat(message);
    handleChat(bot, username, message);
  });

  bot.on("death", () => {
    console.log("\n*** BOT DIED — respawning ***\n");
    onDeath();
    if (lastDeathPos) {
      rememberDeath(lastDeathPos, "unknown");
      rememberDanger(lastDeathPos, "died here");
    }
  });

  bot.on("health", () => {
    lastDeathPos = bot.entity?.position?.clone();
    if (bot.health <= 4) {
      console.log(`\n*** LOW HEALTH WARNING: ${bot.health}/20 ***\n`);
    }
  });

  bot.on("entityDead", (entity) => {
    if (entity.type === "mob" && entity !== bot.entity) {
      const dist = bot.entity.position.distanceTo(entity.position);
      if (dist < 6) {
        onKill(entity.name || "mob");
      }
    }
  });

  bot.on("entityHurt", (entity) => {
    if (entity === bot.entity) {
      lastDeathPos = bot.entity.position.clone();
    }
  });

  bot.on("kicked", (reason) => {
    running = false;
    console.log("Kicked:", reason);
  });

  bot.on("error", (err) => {
    logError("Bot error", err);
  });

  bot.on("end", () => {
    running = false;
    console.log("Disconnected.");
  });

  return bot;
}

function handleChat(bot, username, message) {
  const msg = message.trim().toLowerCase();

  if (msg === "status") {
    const goal = getCurrentGoal();
    const feeling = getEmotionLabel();
    bot.chat(`Goal: ${goal || "none"} | HP: ${bot.health} | Food: ${bot.food} | Feeling: ${feeling}`);
    return;
  }

  const result = setPlayerCommand(msg);
  bot.chat(result);
  logGoal(`chat: "${msg}" → ${result}`);
}

async function reactiveLoop(bot) {
  while (running) {
    try {
      const state = extractState(bot);
      updateEmotions(state);
      logState(state);
      logMind();

      const decisions = await decide(state);
      logDecision(decisions);

      const result = await executeAction(bot, decisions);
      logAction(result);
    } catch (err) {
      logError("Reactive tick failed", err);
    }

    await new Promise((resolve) =>
      setTimeout(resolve, config.jev.reactiveInterval)
    );
  }
}

async function tacticalLoop(bot) {
  await new Promise((resolve) => setTimeout(resolve, 2000));

  while (running) {
    try {
      const state = extractState(bot);
      const result = await pickGoal(state);
      logGoal(result.message);
    } catch (err) {
      logError("Tactical tick failed", err);
    }

    await new Promise((resolve) =>
      setTimeout(resolve, config.jev.tacticalInterval)
    );
  }
}

createBot();
