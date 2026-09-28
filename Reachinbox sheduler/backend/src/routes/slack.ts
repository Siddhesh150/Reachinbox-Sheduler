import { Router } from "express";
import axios from "axios";
import { env } from "../config/env";
import { pool } from "../config/db";
import { requireAuth } from "../middleware/auth";

export const slackRouter = Router();

/**
 * Step 1 of real Slack OAuth: redirect the browser to Slack's authorize
 * screen. `state` carries our internal user id (the "tenant") so the
 * callback knows whose integration to save - Slack echoes it back verbatim.
 */
slackRouter.get("/slack", requireAuth, (req, res) => {
  const state = String(req.user!.id);
  const params = new URLSearchParams({
    client_id: env.SLACK_CLIENT_ID,
    scope: "incoming-webhook",
    redirect_uri: env.SLACK_REDIRECT_URI,
    state,
  });
  res.redirect(`https://slack.com/oauth/v2/authorize?${params.toString()}`);
});

/** Step 2: Slack redirects back here with a one-time `code` + our `state`. */
slackRouter.get("/slack/callback", async (req, res) => {
  const { code, state } = req.query as { code?: string; state?: string };
  if (!code || !state) {
    return res.status(400).send("Missing code/state from Slack");
  }

  try {
    const tokenRes = await axios.post(
      "https://slack.com/api/oauth.v2.access",
      new URLSearchParams({
        client_id: env.SLACK_CLIENT_ID,
        client_secret: env.SLACK_CLIENT_SECRET,
        code,
        redirect_uri: env.SLACK_REDIRECT_URI,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const data = tokenRes.data;
    if (!data.ok) {
      throw new Error(data.error || "slack oauth exchange failed");
    }

    const accessToken = data.access_token as string;
    const webhookUrl = data.incoming_webhook?.url as string | undefined;
    const teamName = data.team?.name as string | undefined;

    await pool.query(
      `INSERT INTO slack_integrations (tenant_id, access_token, webhook_url, team_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id)
       DO UPDATE SET access_token = EXCLUDED.access_token, webhook_url = EXCLUDED.webhook_url, team_name = EXCLUDED.team_name`,
      [state, accessToken, webhookUrl, teamName]
    );

    res.redirect(`${env.FRONTEND_URL}/dashboard?slack=connected`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[slack] oauth callback failed:", err);
    res.redirect(`${env.FRONTEND_URL}/dashboard?slack=error`);
  }
});

slackRouter.get("/api/slack/status", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT team_name, created_at FROM slack_integrations WHERE tenant_id = $1",
      [String(req.user!.id)]
    );
    res.json({ connected: rows.length > 0, team: rows[0]?.team_name ?? null });
  } catch (err) {
    next(err);
  }
});
