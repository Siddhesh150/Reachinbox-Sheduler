import "dotenv/config";
import { Worker, Job, DelayedError } from "bullmq";
import { connection } from "../config/redis";
import { pool } from "../config/db";
import { env } from "../config/env";
import { EMAIL_QUEUE_NAME } from "./queue";
import { tryReserveSendSlot, nextHourBoundaryMs, markRateLimitNotified } from "./rateLimiter";
import { sendEmail } from "../services/mailer";
import { notifySlack } from "../services/slackNotifier";
import { indexEmail } from "../services/elasticsearchService";
import { ensureEmailsIndex } from "../config/elasticsearch";
import { EmailJobData, EmailRow, Sender } from "../types";

async function loadEmailAndSender(emailId: number, senderId: number) {
  const [emailRes, senderRes] = await Promise.all([
    pool.query("SELECT * FROM emails WHERE id = $1", [emailId]),
    pool.query("SELECT * FROM senders WHERE id = $1", [senderId]),
  ]);
  return { emailRow: emailRes.rows[0], senderRow: senderRes.rows[0] };
}

function toEmailRow(r: any): EmailRow {
  return {
    id: r.id,
    campaignId: r.campaign_id,
    senderId: r.sender_id,
    ownerId: r.owner_id,
    recipient: r.recipient,
    subject: r.subject,
    body: r.body,
    scheduledAt: r.scheduled_at,
    sentAt: r.sent_at,
    status: r.status,
    error: r.error,
    jobId: r.job_id,
  };
}

function toSender(r: any): Sender {
  return {
    id: r.id,
    ownerId: r.owner_id,
    name: r.name,
    email: r.email,
    smtpHost: r.smtp_host,
    smtpPort: r.smtp_port,
    smtpUser: r.smtp_user,
    smtpPass: r.smtp_pass,
  };
}

async function processor(job: Job<EmailJobData>, token?: string) {
  const { emailId, senderId, recipient, subject, body, hourlyLimit } = job.data;

  const { emailRow, senderRow } = await loadEmailAndSender(emailId, senderId);

  // --- Idempotency guard #1: DB status ---
  // Handles the case where a previous run already sent this email but the
  // process crashed before BullMQ could mark the job complete.
  if (!emailRow) {
    // eslint-disable-next-line no-console
    console.warn(`[worker] email ${emailId} no longer exists, skipping`);
    return { skipped: true };
  }
  if (emailRow.status === "sent") {
    return { skipped: true, reason: "already sent" };
  }
  if (!senderRow) {
    await pool.query("UPDATE emails SET status = 'failed', error = $2 WHERE id = $1", [
      emailId,
      "sender not found",
    ]);
    return { skipped: true, reason: "sender missing" };
  }

  // --- Hourly rate limit (Redis-backed, safe across multiple workers) ---
  const allowed = await tryReserveSendSlot(senderId, hourlyLimit);
  if (!allowed) {
    const shouldNotify = await markRateLimitNotified(senderId);
    if (shouldNotify) {
      await notifySlack(
        String(emailRow.owner_id),
        `:rotating_light: Hourly send limit (${hourlyLimit}) reached for sender *${senderRow.email}*. ` +
          `Remaining emails are being rescheduled into the next hour window.`
      );
    }

    // Push this job into the next hour window instead of failing/dropping it.
    // moveToDelayed + throwing DelayedError is BullMQ's supported pattern for
    // a worker to re-delay a job it is currently processing.
    const nextWindow = nextHourBoundaryMs() + Math.floor(Math.random() * 5000); // small jitter
    if (token) {
      await job.moveToDelayed(nextWindow, token);
    }
    throw new DelayedError();
  }

  // --- Send via Ethereal SMTP ---
  try {
    const result = await sendEmail(toSender(senderRow), recipient, subject, body);
    const { rows } = await pool.query(
      `UPDATE emails SET status = 'sent', sent_at = now(), error = NULL WHERE id = $1 RETURNING *`,
      [emailId]
    );
    await indexEmail(toEmailRow(rows[0]));
    // eslint-disable-next-line no-console
    console.log(`[worker] sent email ${emailId} to ${recipient} - preview: ${result.previewUrl}`);
    return { sent: true, previewUrl: result.previewUrl };
  } catch (err) {
    const message = (err as Error).message;
    const { rows } = await pool.query(
      `UPDATE emails SET status = 'failed', error = $2 WHERE id = $1 RETURNING *`,
      [emailId, message]
    );
    await indexEmail(toEmailRow(rows[0]));
    throw err; // let BullMQ's retry/backoff handle it
  }
}

async function main() {
  await ensureEmailsIndex();

  const worker = new Worker<EmailJobData>(EMAIL_QUEUE_NAME, processor, {
    connection,
    concurrency: env.WORKER_CONCURRENCY,
    // Global minimum spacing between sends (mimics real provider throttling).
    // "1 job per MIN_DELAY_MS_BETWEEN_SENDS" across this worker's concurrency.
    limiter: {
      max: 1,
      duration: env.MIN_DELAY_MS_BETWEEN_SENDS,
    },
  });

  worker.on("completed", (job) => {
    // eslint-disable-next-line no-console
    console.log(`[worker] job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    // eslint-disable-next-line no-console
    console.error(`[worker] job ${job?.id} failed:`, err.message);
  });

  // eslint-disable-next-line no-console
  console.log(
    `[worker] listening on "${EMAIL_QUEUE_NAME}" (concurrency=${env.WORKER_CONCURRENCY}, ` +
      `min delay=${env.MIN_DELAY_MS_BETWEEN_SENDS}ms)`
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[worker] fatal startup error:", err);
  process.exit(1);
});
