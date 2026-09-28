# ReachInbox Scheduler

A production-grade **email job scheduler service + dashboard**, built for the ReachInbox
full-stack hiring assignment. BullMQ + Redis handle scheduling and rate limiting (no cron
anywhere), Postgres is the system of record, Elasticsearch makes every email searchable,
and Slack gets a real, live notification the moment a sender's hourly limit is hit.

## Stack

| Layer      | Choice |
|------------|--------|
| Backend    | Node.js, TypeScript, Express |
| Queue      | BullMQ (Redis-backed delayed jobs — **no cron**) |
| Database   | PostgreSQL (`pg`, raw SQL) |
| Search     | Elasticsearch |
| Mail       | Nodemailer over Ethereal Email (fake SMTP) |
| Auth       | Real Google OAuth (NextAuth on the frontend, ID-token verification on the backend) |
| Chat ops   | Real Slack OAuth v2 + Incoming Webhooks |
| Frontend   | Next.js (App Router), React, TypeScript, Tailwind CSS |
| Queue UI   | `@bull-board/express` — live dashboard at `/admin/queues` |

## Monorepo layout

```
reachinbox-scheduler/
├── docker-compose.yml        # redis, postgres, elasticsearch
├── backend/
│   └── src/
│       ├── config/           # env, db pool, redis connections, ES client
│       ├── db/                # schema.sql + migration runner
│       ├── queue/             # BullMQ queue, worker, Redis rate limiter
│       ├── services/          # mailer, slack notifier, ES indexing, google auth
│       ├── routes/            # auth, senders, emails, slack
│       ├── middleware/        # auth guard, error handler
│       └── server.ts          # Express app + bull-board mount
└── frontend/
    └── src/
        ├── app/                # login, dashboard, NextAuth route
        ├── components/         # Header, Tabs, ComposeModal, tables, ui/*
        └── lib/                # typed API client, shared types
```

## Getting started

### 1. Infra

```bash
docker compose up -d      # redis :6379, postgres :5432, elasticsearch :9200
```

### 2. Backend

```bash
cd backend
cp .env.example .env      # fill in GOOGLE_CLIENT_ID, SLACK_CLIENT_ID/SECRET
npm install
npm run migrate           # applies schema.sql
npm run dev               # Express API on :4000
```

In a **second terminal**, start the worker (it's a separate process on purpose —
this is what lets you scale queue consumers independently of the API):

```bash
npm run worker
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env.local   # NEXTAUTH_SECRET, GOOGLE_CLIENT_ID/SECRET
npm install
npm run dev                  # Next.js on :3000
```

Open `http://localhost:3000`, sign in with Google, and you land on the dashboard.

### 4. Ethereal Email

You don't need to sign up for anything: click **"+ New Ethereal sender"** on the
dashboard (or `POST /api/senders/ethereal`) and the backend calls
`nodemailer.createTestAccount()` to mint a disposable inbox + SMTP credentials on
the fly, stored as a `sender` row. Every send logs a `previewUrl` in the worker's
console — open it to see the actual rendered email.

### 5. Google OAuth setup

Google Cloud Console → APIs & Services → Credentials → **OAuth Client ID** (Web
application):
- Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
- Copy the Client ID into **both** `frontend/.env.local` and
  `backend/.env` (`GOOGLE_CLIENT_ID`) — the backend independently verifies the
  ID token against Google on every API call, it doesn't trust the frontend session.

### 6. Slack app setup

`https://api.slack.com/apps` → **Create New App** → OAuth & Permissions:
- Redirect URL: `http://localhost:4000/auth/slack/callback`
- Scope: `incoming-webhook`
- Copy Client ID/Secret into `backend/.env`

Then, from the dashboard, hit `GET /auth/slack` (wire a "Connect Slack" button to
this, or open it directly while logged in) to run the real OAuth authorize flow.
Once connected, the **first** job that hits an hourly rate limit for a sender
posts a live message to that Slack channel — verified via the incoming webhook,
not a log line.

## How scheduling works (no cron)

`POST /api/emails/schedule` writes one row per recipient into `emails`
(`status = 'scheduled'`), each with a computed `scheduled_at` (start time +
`index * delayMs`). Immediately after the DB transaction commits, each row is
pushed onto a single BullMQ `email-queue` with:

```ts
emailQueue.add("send-email", data, { delay: scheduledAt - now, jobId: `email-${id}` })
```

BullMQ stores that delayed job **in Redis**, not in an in-process `setTimeout`.
The worker is a long-running `Worker` instance subscribed to the same queue —
when a job's delay elapses, Redis surfaces it and the worker picks it up. There
is no polling loop and no OS/Node cron anywhere in the codebase.

## Persistence across restarts

- Redis runs with `--appendonly yes` (AOF), so the queue's contents (including
  every delayed job's fire time) survive a Redis restart.
- On a **server/worker restart**, the `Worker` simply reconnects to the same
  Redis queue and keeps consuming — BullMQ doesn't need to be told what was
  scheduled before, because the schedule *is* the Redis state.
- Before sending, the worker re-checks the Postgres row's `status`. If it's
  already `'sent'` (e.g. the process crashed right after sending but before
  BullMQ marked the job complete), the job is skipped instead of re-sent.
- `jobId = email-<id>` is passed to `queue.add`; BullMQ refuses to create a
  second job with an ID that's already active/waiting, so a duplicate
  `schedule` call (or an accidental re-enqueue) can't double-book a send.

## Rate limiting & concurrency

**Concurrency** — `new Worker(..., { concurrency: WORKER_CONCURRENCY })`.
Configurable via env, default `5`. Safe under concurrency because every side
effect (rate-limit check, DB update) goes through atomic Redis ops / single-row
SQL updates.

**Minimum delay between sends** — implemented via BullMQ's built-in
[limiter](https://docs.bullmq.io/guide/rate-limiting) option:
`limiter: { max: 1, duration: MIN_DELAY_MS_BETWEEN_SENDS }` (default 2000ms).
This throttles the whole worker's throughput, mimicking provider throttling,
without any manual `setTimeout` inside the job.

**Emails-per-hour, per sender** — a Redis counter keyed
`rl:<senderId>:<YYYYMMDDHH>`, incremented atomically (`INCR`) with a 1-hour
`EXPIRE` set on first write. Because `INCR`/`EXPIRE` are atomic Redis
primitives, this is correct even with multiple worker processes/instances
pulling from the same queue — nothing relies on in-memory counts.

When a sender's hourly cap is exceeded:
1. The reserved slot is rolled back (`DECR`) since nothing was actually sent.
2. The job is pushed into the **next hour window** via
   `job.moveToDelayed(nextHourBoundary, token)` + `throw new DelayedError()`
   — BullMQ's documented pattern for a worker to re-delay a job it's actively
   processing. The job is never failed or dropped, and its position relative
   to other jobs for the same sender is preserved (FIFO by original
   `scheduled_at`).
3. The **first** throttled job in a given hour window triggers exactly one
   Slack notification (`SET rl:notified:<sender>:<hour> NX EX 3600`), so a
   burst of 1000 throttled jobs doesn't spam the channel 1000 times.

`MAX_EMAILS_PER_HOUR_PER_SENDER` is a configurable default; the dashboard also
lets each campaign set its own hourly limit, which is threaded straight
through the job payload — no code change needed to adjust it.

## Behavior under load (1000+ emails at once)

Scheduling 1000 rows for the same `startTime` just means 1000 BullMQ jobs with
staggered `delay` values (`i * delayMs`), all sitting in Redis. The worker
drains them at whatever pace `concurrency` + the limiter allow; anything that
would blow past the hourly cap is deferred to the next hour automatically by
the mechanism above, rather than sent late-and-bursty or dropped.

## Search (Elasticsearch)

Every status transition (`scheduled → sent` / `scheduled → failed`) upserts
the row into the `emails` index (`recipient`, `subject`, `body`, `status`,
timestamps). `GET /api/emails/search?q=...` runs a `multi_match` across
`recipient`/`subject`/`body`. Indexing is best-effort and never blocks the
send pipeline — if Elasticsearch is down, sends still succeed.

## Idempotency, end to end

1. `jobId = email-<id>` — BullMQ-level dedupe.
2. Worker checks `emails.status` before sending — DB-level dedupe.
3. `emails.job_id` has a `UNIQUE` constraint — defends against accidentally
   enqueuing the same row twice from the API layer.

## Auth model

- **Frontend**: NextAuth `GoogleProvider` handles the real OAuth consent
  screen. The Google `id_token` is kept in the NextAuth JWT/session.
- **Backend**: every API request carries `Authorization: Bearer <id_token>`.
  `requireAuth` middleware verifies it directly against Google
  (`google-auth-library`) on each request and upserts a local `users` row —
  there's no separate backend session store to keep in sync with the frontend.

## Assumptions, shortcuts & trade-offs

- No Figma link was included in the assignment brief handed to this repo, so
  the UI was built to match the **written** spec section-by-section (header
  with avatar/logout, tabs, compose modal, tables with loading/empty states)
  rather than pixel-matched to a design file. Swap in real Figma tokens under
  `tailwind.config.ts` if a file is provided later.
- Per-sender concurrency isn't split into separate BullMQ queues — all senders
  share one queue/worker pool, differentiated by the Redis rate-limit key.
  This was simpler to reason about and still meets the "per-sender" hourly cap
  requirement; splitting into one queue per sender would be the next step for
  true per-sender concurrency isolation.
- Slack notification uses an **Incoming Webhook** (`incoming-webhook` scope)
  rather than `chat:write` + channel ID lookup, since it needs zero extra
  configuration beyond the OAuth scope.
- CSV lead parsing happens client-side (PapaParse) purely for the "show number
  of addresses detected" UX; the backend still validates recipients server-side
  before creating rows.
- Ethereal accounts are created on demand via `nodemailer.createTestAccount()`
  rather than requiring the reviewer to sign up for real SMTP credentials.

## Feature checklist

**Backend**
- [x] API-driven scheduling, BullMQ delayed jobs, no cron
- [x] Restart-safe persistence (Redis AOF + DB status re-check + jobId dedupe)
- [x] Configurable worker concurrency
- [x] Configurable min delay between sends (BullMQ limiter)
- [x] Configurable, Redis-backed, multi-worker-safe hourly rate limit per sender
- [x] Rate-limited jobs rescheduled into next hour window, never dropped
- [x] Live Slack notification on rate-limit hit (real OAuth, real webhook call)
- [x] Elasticsearch indexing + search endpoint
- [x] Live BullMQ dashboard (`/admin/queues`)

**Frontend**
- [x] Real Google OAuth login, header with name/email/avatar, logout
- [x] Dashboard with Scheduled / Sent tabs
- [x] Compose modal: subject, body, CSV upload with detected-count, start time,
      delay, hourly limit
- [x] Scheduled + Sent tables with loading and empty states
- [x] Typed API client, reusable UI primitives (Button, Input, Modal, Table shells)
