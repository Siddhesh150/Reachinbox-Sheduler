import dotenv from "dotenv";
dotenv.config();

function get(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const env = {
  PORT: Number(process.env.PORT || 4000),
  FRONTEND_URL: get("FRONTEND_URL", "http://localhost:3000"),

  DATABASE_URL: get("DATABASE_URL", "postgres://reachinbox:reachinbox@localhost:5432/reachinbox"),

  REDIS_HOST: get("REDIS_HOST", "localhost"),
  REDIS_PORT: Number(process.env.REDIS_PORT || 6379),

  ELASTICSEARCH_URL: get("ELASTICSEARCH_URL", "http://localhost:9200"),

  WORKER_CONCURRENCY: Number(process.env.WORKER_CONCURRENCY || 5),
  MIN_DELAY_MS_BETWEEN_SENDS: Number(process.env.MIN_DELAY_MS_BETWEEN_SENDS || 2000),
  MAX_EMAILS_PER_HOUR_PER_SENDER: Number(process.env.MAX_EMAILS_PER_HOUR_PER_SENDER || 200),

  GOOGLE_CLIENT_ID: get("GOOGLE_CLIENT_ID"),

  SLACK_CLIENT_ID: get("SLACK_CLIENT_ID"),
  SLACK_CLIENT_SECRET: get("SLACK_CLIENT_SECRET"),
  SLACK_REDIRECT_URI: get("SLACK_REDIRECT_URI", "http://localhost:4000/auth/slack/callback"),
};
