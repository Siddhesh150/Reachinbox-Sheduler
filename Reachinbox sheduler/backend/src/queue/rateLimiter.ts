import { redis } from "../config/redis";

/**
 * Redis-backed, multi-worker-safe hourly rate limiter.
 *
 * Key: rl:<senderId>:<hourWindow>   e.g. rl:12:2026092714
 * We INCR the key (atomic in Redis) and set a 1-hour TTL the first time it's
 * created. If the post-increment count exceeds the sender's hourly limit, we
 * roll the increment back (DECR) and report "not allowed" so the caller can
 * reschedule the job instead of sending it or dropping it.
 *
 * Because INCR/EXPIRE are atomic Redis primitives, this is safe even when
 * several worker processes / instances are pulling from the same queue.
 */

function currentHourWindow(date = new Date()): string {
  // YYYYMMDDHH, UTC, so all workers agree regardless of local timezone
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const h = String(date.getUTCHours()).padStart(2, "0");
  return `${y}${m}${d}${h}`;
}

function rateLimitKey(senderId: number, window: string): string {
  return `rl:${senderId}:${window}`;
}

export function nextHourBoundaryMs(from = new Date()): number {
  const next = new Date(from);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(next.getUTCHours() + 1);
  return next.getTime();
}

/**
 * Attempts to reserve one "send slot" for this sender in the current hour.
 * Returns true if allowed (and the slot is now reserved), false if the
 * sender's hourly limit has already been reached for this window.
 */
export async function tryReserveSendSlot(senderId: number, hourlyLimit: number): Promise<boolean> {
  const window = currentHourWindow();
  const key = rateLimitKey(senderId, window);

  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, 3600);
  }

  if (count > hourlyLimit) {
    await redis.decr(key); // give the slot back, we didn't actually send
    return false;
  }
  return true;
}

/**
 * Ensures we only fire one Slack notification per sender per hour-window,
 * instead of once per throttled job.
 */
export async function markRateLimitNotified(senderId: number): Promise<boolean> {
  const window = currentHourWindow();
  const key = `rl:notified:${senderId}:${window}`;
  const wasSet = await redis.set(key, "1", "EX", 3600, "NX");
  return wasSet === "OK"; // true only for the first caller in this window
}
