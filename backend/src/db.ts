import pg from "pg";
import { config } from "./config.js";
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 12,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  statement_timeout: 30000,
});
pool.on("error", () =>
  console.error(JSON.stringify({ event: "database_pool_error" })),
);
export async function initialize() {
  await pool.query(`CREATE TABLE IF NOT EXISTS housing.conversations (
    id uuid PRIMARY KEY, messages jsonb NOT NULL DEFAULT '[]', plan jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS housing.result_sets (
    id uuid PRIMARY KEY, conversation_id uuid REFERENCES housing.conversations(id),
    filters jsonb NOT NULL, listing_ids text[] NOT NULL, assessments jsonb NOT NULL DEFAULT '{}',
    plan jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours'
  );
  CREATE INDEX IF NOT EXISTS result_sets_expiry_idx ON housing.result_sets(expires_at);`);
}
