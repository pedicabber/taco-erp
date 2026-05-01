# TODDCO ERP – TASK TEMPLATE DEPARTMENT REWORK PRD

## Module
Admin Settings → Task Templates

---

# Objective

Rework the existing Task Templates system to organize tasks by Department sections instead of the current task/subtask hierarchy.

The system should support:
- Department-based task organization
- Task-only templates (no subtasks)
- Existing add/edit/delete functionality
- Existing auto-populate functionality

This change should improve project template clarity and scalability for manufacturing workflow management.

---

# Current Behavior

The current Task Templates page:
- Displays template tasks
- Displays subtasks underneath tasks
- Allows add/edit/delete of tasks and subtasks
- Supports auto-populating tasks during project creation

Current structure:

Task
└── Subtasks

---

# Desired Behavior

The Task Templates page should display:

Department
└── Tasks

No subtasks should exist in the template structure.

Each department should appear as its own visual section/container with its associated tasks underneath.

Example:

Engineering
- Mechanical Design
- Electrical Design
- Controls Design

Purchasing
- Order Components
- Verify Lead Times

Production
- Fabrication
- Assembly
- Testing

---

# UI Requirements

## Keep Existing:
- Admin Settings location
- Task Templates tab
- Auto-populate toggle
- Add/Edit/Delete task functionality
- Existing page styling/theme

## New Requirements:
- Each department displayed as its own section
- Tasks displayed underneath department
- Ability to add/edit/delete tasks within each department
- Hover actions remain on right side of task rows
- Vertical scroll through department sections
- Clean industrial/minimal layout
- No subtasks displayed or created

---

# Database Requirements

Use the existing task template system/database structure whenever possible.

Required behavior:
- Template tasks must reference a department
- Departments act as parent grouping containers
- Existing task records should be reusable/migrated if possible
- Avoid unnecessary database rewrites

Do NOT redesign unrelated database systems.

---

# Auto-Populate Behavior

## If Auto-Populate is ENABLED:
When creating a project:
- Automatically copy all departments and their tasks into the project

## If Auto-Populate is DISABLED:
Before project finalization:
- Prompt user to select:
  - Departments to include
  - Tasks to include
  - Tasks/departments to remove
  - Additional tasks to add manually

---

# Workflow

1. User clicks Settings gear icon
2. User opens Task Templates tab
3. User scrolls through department sections
4. User manages tasks within each department
5. User optionally enables Auto-Populate
6. During project creation:
   - Auto-populate enabled:
     - All department tasks copied automatically
   - Auto-populate disabled:
     - User selects desired departments/tasks before finalizing project

---

# Technical Constraints

- Do NOT move the Task Templates section
- Do NOT remove Auto-Populate checkbox
- Do NOT remove add/edit/delete functionality
- Do NOT introduce subtasks
- Do NOT refactor unrelated systems
- Preserve existing styling/theme
- Minimize database changes
- Minimize component rewrites
- Reuse existing task logic whenever possible

---

# Success Criteria

- [ ] Departments display as top-level sections
- [ ] Tasks exist underneath departments
- [ ] No subtasks exist in templates
- [ ] Existing add/edit/delete actions work
- [ ] Auto-populate behavior remains functional
- [ ] Manual task/department selection works when auto-populate is disabled
- [ ] Existing Admin page layout remains intact
- [ ] Existing project creation flow remains stable