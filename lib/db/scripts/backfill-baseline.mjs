/**
 * One-time, idempotent backfill for projects created before the baseline
 * schedule columns existed. Freezes baseline to the best available current
 * committed date (active, then legacy) and recomputes schedule_drift_days.
 * Safe to re-run: only touches rows with a null baseline column.
 *
 * Run: pnpm --filter @workspace/db exec node scripts/backfill-baseline.mjs
 */
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const sql = `
  UPDATE projects
  SET
    baseline_start_date = COALESCE(baseline_start_date, active_start_date, start_date),
    baseline_delivery_date = COALESCE(baseline_delivery_date, active_delivery_date, delivery_date),
    schedule_drift_days = COALESCE(
      (COALESCE(active_delivery_date, delivery_date)::date
        - COALESCE(baseline_delivery_date, active_delivery_date, delivery_date)::date),
      0
    )
  WHERE baseline_start_date IS NULL OR baseline_delivery_date IS NULL
  RETURNING id, name, baseline_start_date, baseline_delivery_date, active_delivery_date, schedule_drift_days;
`;

try {
  const { rows } = await pool.query(sql);
  console.log(`Backfilled ${rows.length} project(s) with a null baseline:`);
  for (const r of rows) {
    console.log(
      `  #${r.id} ${r.name}: baselineStart=${r.baseline_start_date} baselineDelivery=${r.baseline_delivery_date} active=${r.active_delivery_date} drift=${r.schedule_drift_days}`,
    );
  }
  console.log("Backfill complete.");
} catch (err) {
  console.error("Backfill failed:", err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
