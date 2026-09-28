import { Router } from "express";
import { pool } from "../config/db";
import { requireAuth } from "../middleware/auth";
import { createEtherealAccount } from "../services/mailer";

export const sendersRouter = Router();
sendersRouter.use(requireAuth);

sendersRouter.get("/", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, name, email, smtp_host, smtp_port, created_at FROM senders WHERE owner_id = $1 ORDER BY created_at DESC",
      [req.user!.id]
    );
    res.json({ senders: rows });
  } catch (err) {
    next(err);
  }
});

/**
 * Creates a new sender backed by a freshly generated Ethereal test account,
 * so a candidate/demo can spin up "multiple senders" with zero manual setup.
 */
sendersRouter.post("/ethereal", async (req, res, next) => {
  try {
    const { name } = req.body as { name?: string };
    const account = await createEtherealAccount();
    const { rows } = await pool.query(
      `INSERT INTO senders (owner_id, name, email, smtp_host, smtp_port, smtp_user, smtp_pass)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, email, smtp_host, smtp_port, created_at`,
      [req.user!.id, name || "Ethereal Sender", account.user, account.host, account.port, account.user, account.pass]
    );
    res.status(201).json({ sender: rows[0] });
  } catch (err) {
    next(err);
  }
});

/** Bring-your-own-SMTP sender (e.g. a real mailbox) if you don't want Ethereal. */
sendersRouter.post("/", async (req, res, next) => {
  try {
    const { name, email, smtpHost, smtpPort, smtpUser, smtpPass } = req.body;
    if (!name || !email || !smtpHost || !smtpPort || !smtpUser || !smtpPass) {
      return res.status(400).json({ error: "Missing required sender fields" });
    }
    const { rows } = await pool.query(
      `INSERT INTO senders (owner_id, name, email, smtp_host, smtp_port, smtp_user, smtp_pass)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, email, smtp_host, smtp_port, created_at`,
      [req.user!.id, name, email, smtpHost, smtpPort, smtpUser, smtpPass]
    );
    res.status(201).json({ sender: rows[0] });
  } catch (err) {
    next(err);
  }
});
