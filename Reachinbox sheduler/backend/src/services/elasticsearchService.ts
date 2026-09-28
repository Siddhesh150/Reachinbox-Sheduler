import { esClient, EMAILS_INDEX } from "../config/elasticsearch";
import { EmailRow } from "../types";

export async function indexEmail(email: EmailRow): Promise<void> {
  try {
    await esClient.index({
      index: EMAILS_INDEX,
      id: String(email.id),
      document: {
        id: email.id,
        campaignId: email.campaignId,
        senderId: email.senderId,
        recipient: email.recipient,
        subject: email.subject,
        body: email.body,
        status: email.status,
        scheduledAt: email.scheduledAt,
        sentAt: email.sentAt,
      },
    });
  } catch (err) {
    // Search indexing is best-effort - never block the send pipeline on it.
    // eslint-disable-next-line no-console
    console.error("[elasticsearch] index failed:", (err as Error).message);
  }
}

export async function searchEmails(ownerId: number, query: string) {
  const result = await esClient.search({
    index: EMAILS_INDEX,
    query: {
      bool: {
        must: [
          {
            multi_match: {
              query,
              fields: ["recipient^2", "subject", "body"],
            },
          },
        ],
      },
    },
    size: 50,
  });
  return result.hits.hits.map((h) => h._source);
}
