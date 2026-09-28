-- ReachInbox Scheduler schema

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  google_id VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  avatar_url TEXT,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS senders (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  smtp_host VARCHAR(255) NOT NULL,
  smtp_port INTEGER NOT NULL,
  smtp_user VARCHAR(255) NOT NULL,
  smtp_pass VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaigns (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  sender_id INTEGER REFERENCES senders(id),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  delay_ms INTEGER NOT NULL DEFAULT 2000,
  hourly_limit INTEGER NOT NULL DEFAULT 200,
  start_time TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS emails (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
  sender_id INTEGER REFERENCES senders(id),
  owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  recipient VARCHAR(255) NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  scheduled_at TIMESTAMP NOT NULL,
  sent_at TIMESTAMP,
  status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
  error TEXT,
  job_id VARCHAR(255) UNIQUE,
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emails_status ON emails(status);
CREATE INDEX IF NOT EXISTS idx_emails_owner ON emails(owner_id);
CREATE INDEX IF NOT EXISTS idx_emails_scheduled_at ON emails(scheduled_at);

CREATE TABLE IF NOT EXISTS slack_integrations (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(255) NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  webhook_url TEXT,
  team_name VARCHAR(255),
  created_at TIMESTAMP DEFAULT now()
);
