import fs from "fs";
import path from "path";
import { pool } from "../config/db";

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  // eslint-disable-next-line no-console
  console.log("[migrate] applying schema.sql ...");
  await pool.query(sql);
  // eslint-disable-next-line no-console
  console.log("[migrate] done.");
  await pool.end();
}

migrate().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[migrate] failed:", err);
  process.exit(1);
});
