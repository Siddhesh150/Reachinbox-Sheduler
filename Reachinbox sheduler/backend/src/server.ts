import express from "express";
import cors from "cors";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";

import { env } from "./config/env";
import { emailQueue } from "./queue/queue";
import { ensureEmailsIndex } from "./config/elasticsearch";
import { requestLogger } from "./utils/logger";
import { errorHandler } from "./middleware/errorHandler";

import { authRouter } from "./routes/auth";
import { sendersRouter } from "./routes/senders";
import { emailsRouter } from "./routes/emails";
import { slackRouter } from "./routes/slack";

const app = express();

app.use(cors({ origin: env.FRONTEND_URL, credentials: true }));
app.use(express.json({ limit: "5mb" }));
app.use(requestLogger);

// --- Live BullMQ dashboard (real-time queue visibility) ---
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/admin/queues");
createBullBoard({
  queues: [new BullMQAdapter(emailQueue)],
  serverAdapter,
});
app.use("/admin/queues", serverAdapter.getRouter());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRouter);
app.use("/", slackRouter); // exposes /auth/slack, /auth/slack/callback, /api/slack/status
app.use("/api/senders", sendersRouter);
app.use("/api/emails", emailsRouter);

app.use(errorHandler);

async function start() {
  await ensureEmailsIndex();
  app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[server] listening on http://localhost:${env.PORT}`);
    // eslint-disable-next-line no-console
    console.log(`[server] BullMQ dashboard: http://localhost:${env.PORT}/admin/queues`);
    // eslint-disable-next-line no-console
    console.log(`[server] remember to also run "npm run worker" in a separate process`);
  });
}

start();
