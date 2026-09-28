import { Queue } from "bullmq";
import { connection } from "../config/redis";
import { EmailJobData } from "../types";

export const EMAIL_QUEUE_NAME = "email-queue";

// Single BullMQ queue. Jobs are added with a delay (Date.now() - now) so they
// fire at the exact scheduled time - this is what gives us "no cron" scheduling
// that survives restarts: the job lives in Redis, not in an in-process timer.
export const emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { age: 60 * 60 * 24 * 7 }, // keep 7 days for dashboard/history
    removeOnFail: { age: 60 * 60 * 24 * 7 },
  },
});

/**
 * jobId = `email-<emailId>` is the idempotency key: BullMQ will not create a
 * second job with an id that already exists (and is not yet completed/removed),
 * and our worker double-checks DB status before sending as a second guard.
 */
export function jobIdForEmail(emailId: number): string {
  return `email-${emailId}`;
}

export async function enqueueEmail(data: EmailJobData, scheduledAtMs: number): Promise<string> {
  const delay = Math.max(0, scheduledAtMs - Date.now());
  const jobId = jobIdForEmail(data.emailId);
  await emailQueue.add("send-email", data, {
    delay,
    jobId,
  });
  return jobId;
}
