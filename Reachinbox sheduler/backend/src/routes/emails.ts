import { Router } from "express";
import { pool } from "../config/db";
import { requireAuth } from "../middleware/auth";
import { enqueueEmail } from "../queue/queue";
import { searchEmails } from "../services/elasticsearchService";

export const emailsRouter = Router();
emailsRouter.use(requireAuth);

interface ScheduleBody {
  senderId: number;
  subject: string;
  body: string;
  recipients: string[];
  startTime: string; // ISO string
  delayMs?: number;
  hourlyLimit?: number;
}

/**
 * Schedules a batch of emails (e.g. parsed from an uploaded CSV of leads).
 * Each recipient is staggered by `delayMs` starting at `startTime`, and every
 * row becomes its own BullMQ delayed job (jobId = email-<id>) so the queue -
 * not an in-process timer - is the source of truth for "when does this send".
 */
emailsRouter.post("/schedule", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const {
      senderId,
      subject,
      body,
      recipients,
      startTime,
      delayMs = 2000,
      hourlyLimit = 200,
    } = req.body as ScheduleBody;

    if (!senderId || !subject || !body || !Array.isArray(recipients) || recipients.length === 0 || !startTime) {
      return res.status(400).json({ error: "senderId, subject, body, recipients[] and startTime are required" });
    }

    const senderCheck = await pool.query("SELECT id FROM senders WHERE id = $1 AND owner_id = $2", [
      senderId,
      req.user!.id,
    ]);
    if (senderCheck.rowCount === 0) {
      return res.status(404).json({ error: "Sender not found" });
    }

    await client.query("BEGIN");

    const campaignRes = await client.query(
      `INSERT INTO campaigns (owner_id, sender_id, subject, body, delay_ms, hourly_limit, start_time)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [req.user!.id, senderId, subject, body, delayMs, hourlyLimit, startTime]
    );
    const campaignId = campaignRes.rows[0].id;

    const startMs = new Date(startTime).getTime();
    const created: { id: number; scheduledAt: number; recipient: string }[] = [];

    for (let i = 0; i < recipients.length; i++) {
      const scheduledAtMs = startMs + i * delayMs;
      const emailRes = await client.query(
        `INSERT INTO emails (campaign_id, sender_id, owner_id, recipient, subject, body, scheduled_at, status)
         VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0), 'scheduled')
         RETURNING id`,
        [campaignId, senderId, req.user!.id, recipients[i], subject, body, scheduledAtMs]
      );
      created.push({ id: emailRes.rows[0].id, scheduledAt: scheduledAtMs, recipient: recipients[i] });
    }

    await client.query("COMMIT");

    // Enqueue after commit so we never enqueue a job for a row that didn't persist.
    for (const row of created) {
      const jobId = await enqueueEmail(
        {
          emailId: row.id,
          senderId,
          recipient: row.recipient,
          subject,
          body,
          hourlyLimit,
        },
        row.scheduledAt
      );
      await pool.query("UPDATE emails SET job_id = $1 WHERE id = $2", [jobId, row.id]);
    }

    res.status(201).json({ campaignId, scheduled: created.length });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
});

emailsRouter.get("/scheduled", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, recipient, subject, scheduled_at, status FROM emails
       WHERE owner_id = $1 AND status = 'scheduled'
       ORDER BY scheduled_at ASC LIMIT 200`,
      [req.user!.id]
    );
    res.json({ emails: rows });
  } catch (err) {
    next(err);
  }
});

emailsRouter.get("/sent", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, recipient, subject, sent_at, status, error FROM emails
       WHERE owner_id = $1 AND status IN ('sent', 'failed')
       ORDER BY sent_at DESC NULLS LAST LIMIT 200`,
      [req.user!.id]
    );
    res.json({ emails: rows });
  } catch (err) {
    next(err);
  }
});

emailsRouter.get("/search", async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json({ results: [] });
    const results = await searchEmails(req.user!.id, q);
    res.json({ results });
  } catch (err) {
    next(err);
  }
});
