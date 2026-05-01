import { db, usersTable, departmentsTable, taskTemplatesTable, taskTemplateSubtasksTable, settingsTable } from "@workspace/db";
import { asc, eq, inArray, isNull } from "drizzle-orm";
import { DEPARTMENT_TASKS } from "./templateTasks";

export const BOOTSTRAP_ADMINS = [
  "davidjohnfrazier@gmail.com",
  "jferris@toddco.com",
  "jferris.toddco@gmail.com",
  "jayf6304@gmail.com",
];

const GLOBAL_DEPARTMENTS = DEPARTMENT_TASKS.map(d => ({ name: d.dept, color: d.color }));

export async function bootstrapAdmins() {
  try {
    await db.update(usersTable)
      .set({ role: "admin" })
      .where(inArray(usersTable.email, BOOTSTRAP_ADMINS));
  } catch {
    // silently skip if table not ready yet
  }
}

export async function bootstrapDepartments() {
  try {
    const existing = await db
      .select()
      .from(departmentsTable)
      .where(isNull(departmentsTable.projectId))
      .orderBy(asc(departmentsTable.id));
    const byName = new Map(existing.map(d => [d.name.toUpperCase(), d]));
    const reusable = existing.filter(d => !GLOBAL_DEPARTMENTS.some(g => g.name === d.name));

    for (let i = 0; i < GLOBAL_DEPARTMENTS.length; i++) {
      const dept = GLOBAL_DEPARTMENTS[i];
      const match = byName.get(dept.name);
      if (match) {
        if (match.color !== dept.color) {
          await db.update(departmentsTable).set({ color: dept.color }).where(eq(departmentsTable.id, match.id));
        }
        continue;
      }

      const slot = reusable.shift();
      if (slot) {
        await db.update(departmentsTable)
          .set({ name: dept.name, color: dept.color })
          .where(eq(departmentsTable.id, slot.id));
      } else {
        await db.insert(departmentsTable).values({ name: dept.name, color: dept.color, projectId: null });
      }
    }
  } catch {
    // silently skip if table not ready yet
  }
}

export async function bootstrapTaskTemplates() {
  try {
    const existing = await db.select().from(taskTemplatesTable);
    if (existing.length === 0) {
      const globalDepts = await db
        .select()
        .from(departmentsTable)
        .where(isNull(departmentsTable.projectId));
      const deptByName = new Map(globalDepts.map(d => [d.name.toUpperCase(), d]));

      let sortOrder = 0;
      for (const { dept: deptName, tasks } of DEPARTMENT_TASKS) {
        const deptRecord = deptByName.get(deptName.toUpperCase());
        if (!deptRecord) continue;
        for (const title of tasks) {
          await db.insert(taskTemplatesTable).values({
            title,
            departmentId: deptRecord.id,
            sortOrder: sortOrder++,
          });
        }
      }
    }

    const existingSettings = await db.select().from(settingsTable);
    const settingKeys = existingSettings.map(s => s.key);
    if (!settingKeys.includes("auto_populate_tasks")) {
      await db.insert(settingsTable).values({ key: "auto_populate_tasks", value: "true" });
    }
  } catch {
    // silently skip if table not ready yet
  }
}
