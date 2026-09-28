import IORedis from "ioredis";
import { env } from "./env";

// BullMQ requires maxRetriesPerRequest: null on connections it manages.
export const connection = new IORedis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  maxRetriesPerRequest: null,
});

// Separate connection for plain app-level Redis ops (rate-limit counters, dedupe flags).
export const redis = new IORedis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
});
