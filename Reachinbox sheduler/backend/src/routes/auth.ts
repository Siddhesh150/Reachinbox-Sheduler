import { Router } from "express";
import { requireAuth } from "../middleware/auth";

export const authRouter = Router();

/**
 * Frontend calls this right after NextAuth signs the user in with Google,
 * passing the Google id_token as a bearer header. requireAuth() verifies it,
 * upserts the user, and req.user is populated - we just echo it back so the
 * frontend can confirm the sync succeeded and cache the profile.
 */
authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});
