// lib/redis.ts
import { createClient } from "redis";

const redis = createClient({
  url: process.env.REDIS_URL, // or use host/port config
});

redis.on("error", (err) => console.error("Redis Client Error", err));

(async () => {
  if (!redis.isOpen) await redis.connect();
})();

export default redis;
