import { Client } from "@elastic/elasticsearch";
import { env } from "./env";

export const esClient = new Client({ node: env.ELASTICSEARCH_URL });

export const EMAILS_INDEX = "emails";

export async function ensureEmailsIndex(): Promise<void> {
  try {
    const exists = await esClient.indices.exists({ index: EMAILS_INDEX });
    if (!exists) {
      await esClient.indices.create({
        index: EMAILS_INDEX,
        mappings: {
          properties: {
            id: { type: "integer" },
            campaignId: { type: "integer" },
            senderId: { type: "integer" },
            recipient: { type: "keyword" },
            subject: { type: "text" },
            body: { type: "text" },
            status: { type: "keyword" },
            scheduledAt: { type: "date" },
            sentAt: { type: "date" },
          },
        },
      });
      // eslint-disable-next-line no-console
      console.log(`[elasticsearch] created index "${EMAILS_INDEX}"`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[elasticsearch] could not ensure index (is ES running?):", (err as Error).message);
  }
}
