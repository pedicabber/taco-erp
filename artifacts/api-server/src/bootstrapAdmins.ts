import { db, usersTable, departmentsTable, taskTemplatesTable, taskTemplateSubtasksTable, settingsTable } from "@workspace/db";
import { inArray, isNull } from "drizzle-orm";
import { TEMPLATE_TASKS } from "./templateTasks";

export const BOOTSTRAP_ADMINS = [
  "davidjohnfrazier@gmail.com",
  "jferris@toddco.com",
  "jferris.toddco@gmail.com",
  "jayf6304@gmail.com",
];

const GLOBAL_DEPARTMENTS = [
  { name: "Mechanical Engineering", color: "#3B82F6" },
  { name: "Electrical Engineering", color: "#F59E0B" },
  { name: "Controls & Software", color: "#8B5CF6" },
  { name: "Project Management", color: "#10B981" },
  { name: "Manufacturing", color: "#EF4444" },
  { name: "Quality Assurance", color: "#06B6D4" },
  { name: "Design & Drafting", color: "#EC4899" },
  { name: "Field Services", color: "#F97316" },
  { name: "Safety & Compliance", color: "#84CC16" },
  { name: "Procurement", color: "#A78BFA" },
];

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
    const existing = await db.select().from(departmentsTable).where(isNull(departmentsTable.projectId));
    if (existing.length === 0) {
      await db.insert(departmentsTable).values(
        GLOBAL_DEPARTMENTS.map(d => ({ name: d.name, color: d.color, projectId: null }))
      );
    }
  } catch {
    // silently skip if table not ready yet
  }
}

export async function bootstrapTaskTemplates() {
  try {
    const existing = await db.select().from(taskTemplatesTable);
    if (existing.length === 0) {
      for (let i = 0; i < TEMPLATE_TASKS.length; i++) {
        const tmpl = TEMPLATE_TASKS[i];
        const [row] = await db.insert(taskTemplatesTable).values({
          title: tmpl.title,
          sortOrder: i,
        }).returning();
        for (let j = 0; j < tmpl.subtasks.length; j++) {
          await db.insert(taskTemplateSubtasksTable).values({
            taskTemplateId: row.id,
            title: tmpl.subtasks[j].title,
            sortOrder: j,
          });
        }
      }
    }
    // Bootstrap default settings
    const existingSettings = await db.select().from(settingsTable);
    const settingKeys = existingSettings.map(s => s.key);
    if (!settingKeys.includes("auto_populate_tasks")) {
      await db.insert(settingsTable).values({ key: "auto_populate_tasks", value: "true" });
    }
  } catch {
    // silently skip if table not ready yet
  }
}
