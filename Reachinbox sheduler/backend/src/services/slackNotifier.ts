import axios from "axios";
import { pool } from "../config/db";

/**
 * Looks up the caller's Slack webhook and posts a message. If the tenant has
 * never connected Slack, this silently no-ops (no crash). Because it reads
 * the DB fresh on every call, a tenant who connects Slack *after* the app is
 * already running starts getting notifications immediately - no redeploy.
 */
export async function notifySlack(tenantId: string, text: string): Promise<void> {
  const { rows } = await pool.query(
    "SELECT webhook_url FROM slack_integrations WHERE tenant_id = $1",
    [tenantId]
  );

  const webhookUrl: string | undefined = rows[0]?.webhook_url;
  if (!webhookUrl) return; // not connected - nothing to do

  try {
    await axios.post(webhookUrl, { text });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[slack] failed to deliver notification:", (err as Error).message);
  }
}
