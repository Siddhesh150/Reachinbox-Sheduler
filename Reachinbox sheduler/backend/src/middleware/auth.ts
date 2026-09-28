import { Request, Response, NextFunction } from "express";
import { verifyGoogleIdToken, upsertUser } from "../services/googleAuth";

/**
 * Expects `Authorization: Bearer <google-id-token>` (the id_token NextAuth
 * gets back from Google on the frontend). We verify it against Google on
 * every request and upsert/attach the local user record - no separate
 * session store needed on the backend.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing bearer token" });
  }
  const idToken = header.slice("Bearer ".length);
  try {
    const profile = await verifyGoogleIdToken(idToken);
    req.user = await upsertUser(profile);
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
