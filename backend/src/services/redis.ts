import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

// Main client for commands (GET, SET, XADD, etc.)
export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null, // ioredis recommends null when using stream blocking calls (XREADGROUP)
  showFriendlyErrorStack: true
});

// Pub/Sub client creators
export const createSubClient = () => {
  return new Redis(REDIS_URL, {
    maxRetriesPerRequest: null
  });
};

redis.on("connect", () => {
  console.log("📍 Redis connected successfully!");
});

redis.on("error", (err) => {
  console.error("❌ Redis connection error:", err);
});
