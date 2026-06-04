import cron from "node-cron";
import { and, eq, isNull } from "drizzle-orm";
import { db, tasksTable, taskTimerSessionsTable, timeEntryEditsTable } from "@workspace/db";
import { createNotification } from "../routes/notifications";
import { logger } from "./logger";

/**
 * End-of-day timeclock automation.
 *
 * Two cron jobs run in the America/Los_Angeles timezone:
 *   - 8:45 PM Pacific Time: warn every user who is still clocked in that their
 *     entries will be auto-closed at 9:00 PM.
 *   - 9:00 PM Pacific Time: force-close every still-open time entry, mark it as
 *     an automatic clock-out, record it in the immutable audit trail, recompute
 *     the affected task's labor totals, and notify the owner.
 *
 * NOTE: This assumes a single API-server instance (the standard Replit
 * deployment). If the server is ever scaled horizontally, these jobs would run
 * once per instance and would need a distributed lock.
 */

const PACIFIC_TZ = "America/Los_Angeles";
const PACIFIC_LABEL = "9:00 PM Pacific Time (America/Los_Angeles)";

/** Sum of all closed-session durations for a task (open sessions count as 0). */
async function recomputeTaskElapsedSeconds(taskId: number): Promise<number> {
  const rows = await db
    .select({ durationSeconds: taskTimerSessionsTable.durationSeconds })
    .from(taskTimerSessionsTable)
    .where(eq(taskTimerSessionsTable.taskId, taskId));
  return rows.reduce((acc, r) => acc + (r.durationSeconds ?? 0), 0);
}

/**
 * Close every open time entry as an automatic end-of-day clock-out. The job
 * fires AT 9:00 PM Pacific, so `new Date()` is the correct stop instant and we
 * avoid any manual timezone arithmetic.
 */
export async function runAutoClockOut(): Promise<number> {
  const openSessions = await db
    .select()
    .from(taskTimerSessionsTable)
    .where(isNull(taskTimerSessionsTable.stoppedAt));

  if (openSessions.length === 0) return 0;

  const stoppedAt = new Date();
  const affectedTaskIds = new Set<number>();

  for (const session of openSessions) {
    const durationSeconds = Math.max(
      0,
      Math.floor((stoppedAt.getTime() - session.startedAt.getTime()) / 1000),
    );

    // Capture originals exactly once (startedAt is NOT NULL, so a null
    // originalStartedAt reliably means "never captured").
    const neverCaptured = session.originalStartedAt === null;
    const originalStartedAt = neverCaptured ? session.startedAt : session.originalStartedAt;
    const originalStoppedAt = neverCaptured ? session.stoppedAt : session.originalStoppedAt;

    await db
      .update(taskTimerSessionsTable)
      .set({
        stoppedAt,
        durationSeconds,
        originalStartedAt,
        originalStoppedAt,
        autoClockedOut: true,
      })
      .where(eq(taskTimerSessionsTable.id, session.id));

    await db.insert(timeEntryEditsTable).values({
      sessionId: session.id,
      taskId: session.taskId,
      editedById: null,
      editType: "auto_clock_out",
      originalStartedAt,
      updatedStartedAt: session.startedAt,
      originalStoppedAt,
      updatedStoppedAt: stoppedAt,
      reason: "Automatic end-of-day clock-out at 9:00 PM Pacific Time (America/Los_Angeles)",
    });

    affectedTaskIds.add(session.taskId);

    await createNotification(
      session.startedById,
      session.taskId,
      "timer_alert",
      `Your time entry was automatically clocked out at ${PACIFIC_LABEL}.`,
    );
  }

  // Recompute aggregates and clear any task-level run locks for affected tasks.
  for (const taskId of affectedTaskIds) {
    const elapsedSeconds = await recomputeTaskElapsedSeconds(taskId);
    await db
      .update(tasksTable)
      .set({ elapsedSeconds, timerRunning: false, timerStartedAt: null })
      .where(eq(tasksTable.id, taskId));
  }

  logger.info(
    { count: openSessions.length, tasks: affectedTaskIds.size },
    "Auto clock-out completed",
  );
  return openSessions.length;
}

/**
 * Warn every user with an open time entry that auto clock-out is imminent.
 */
export async function runEndOfDayWarning(): Promise<number> {
  const openSessions = await db
    .select({
      startedById: taskTimerSessionsTable.startedById,
      taskId: taskTimerSessionsTable.taskId,
    })
    .from(taskTimerSessionsTable)
    .where(isNull(taskTimerSessionsTable.stoppedAt));

  // One warning per user (point them at one of their open entries).
  const byUser = new Map<number, number>();
  for (const s of openSessions) {
    if (!byUser.has(s.startedById)) byUser.set(s.startedById, s.taskId);
  }

  for (const [userId, taskId] of byUser) {
    await createNotification(
      userId,
      taskId,
      "timer_alert",
      `You are still clocked in. Your time entry will be automatically clocked out at ${PACIFIC_LABEL} if you do not stop it.`,
    );
  }

  if (byUser.size > 0) {
    logger.info({ users: byUser.size }, "End-of-day clock-out warnings sent");
  }
  return byUser.size;
}

let started = false;

/** Register the end-of-day timeclock cron jobs. Safe to call once at boot. */
export function startTimeclockScheduler(): void {
  if (started) return;
  started = true;

  // 8:45 PM Pacific — warning.
  cron.schedule(
    "45 20 * * *",
    () => {
      runEndOfDayWarning().catch((err) =>
        logger.error({ err }, "End-of-day warning job failed"),
      );
    },
    { timezone: PACIFIC_TZ },
  );

  // 9:00 PM Pacific — automatic clock-out.
  cron.schedule(
    "0 21 * * *",
    () => {
      runAutoClockOut().catch((err) =>
        logger.error({ err }, "Auto clock-out job failed"),
      );
    },
    { timezone: PACIFIC_TZ },
  );

  logger.info(
    { warningCron: "45 20 * * *", clockOutCron: "0 21 * * *", timezone: PACIFIC_TZ },
    "Timeclock scheduler started",
  );
}
