import { OAuth2Client } from "google-auth-library";
import { env } from "../config/env";
import { pool } from "../config/db";
import { AuthedUser } from "../types";

const client = new OAuth2Client(env.GOOGLE_CLIENT_ID);

export interface GoogleProfile {
  googleId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

/**
 * Verifies a Google ID token (issued to the frontend by NextAuth's Google
 * provider) and returns the decoded profile. Throws if invalid/expired.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
  const ticket = await client.verifyIdToken({
    idToken,
    audience: env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload || !payload.sub || !payload.email) {
    throw new Error("Invalid Google token payload");
  }
  return {
    googleId: payload.sub,
    email: payload.email,
    name: payload.name ?? null,
    avatarUrl: payload.picture ?? null,
  };
}

/** Upserts the user row and returns our internal user record. */
export async function upsertUser(profile: GoogleProfile): Promise<AuthedUser> {
  const { rows } = await pool.query(
    `INSERT INTO users (google_id, email, name, avatar_url)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (google_id)
     DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url
     RETURNING id, google_id, email, name, avatar_url`,
    [profile.googleId, profile.email, profile.name, profile.avatarUrl]
  );
  const row = rows[0];
  return {
    id: row.id,
    googleId: row.google_id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url,
  };
}
