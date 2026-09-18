export const config = {
  minecraft: {
    host: process.env.MC_HOST || "localhost",
    port: parseInt(process.env.MC_PORT || "25565"),
    username: process.env.MC_USERNAME || "JevBot",
    version: process.env.MC_VERSION || undefined,
  },
  jev: {
    model: "jev-latest",
    reactiveInterval: 600,
    tacticalInterval: 10000,
    minGoalTime: 15000,
  },
  thresholds: {
    eatHunger: 0.6,
    fleeConfidence: 0.5,
    fightConfidence: 0.6,
    goalSwitchUrgency: 2.0,
  },
};
