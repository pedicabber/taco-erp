# TODDCO ERP – TASKS TAB DEFAULT VIEW PRD

## Module
Tasks Tab

---

# Objective

Improve the Tasks tab so users immediately see their own assigned tasks without requiring manual filtering.

The goal is to make the Tasks tab usable as a daily work dashboard for each employee.

---

# Current Behavior

- Tasks tab shows no tasks by default
- User must manually apply filters to see tasks
- No default employee selection
- Tasks are not grouped by department

---

# Desired Behavior

## Default View

When a user opens the Tasks tab:

- The logged-in user is automatically selected in the employee filter
- All tasks assigned to that user are displayed immediately
- No manual filtering required

---

## Task Organization

Tasks should be grouped by department.

Structure:

Department (collapsible)
- Task 1
- Task 2
- Task 3

If a user belongs to multiple departments:
- Each department is shown as its own section
- Each section can be expanded/collapsed independently

---

## Employee Filter Behavior

- Add an Employee dropdown filter
- Position: between search bar and existing filters
- Default selection = logged-in user
- Changing selection updates task list dynamically

---

## UI Requirements

- Maintain existing Tasks tab layout and styling
- Add Employee filter dropdown in top filter row
- Department sections should:
  - Display department name as header
  - Be collapsible
  - Show tasks underneath
- Task rows behave exactly as they do currently
- No redesign of task detail view

---

# Workflow

1. User logs in
2. User opens Tasks tab
3. System automatically:
   - selects logged-in user in employee filter
   - displays all tasks assigned to them
4. Tasks are grouped by department
5. User can:
   - expand/collapse departments
   - click tasks to open
   - change employee filter to view others’ tasks

---

# Technical Constraints

- Do NOT change task data structure unless required
- Do NOT modify task creation logic
- Do NOT modify project/task relationships
- Do NOT break existing filters
- Reuse existing task query logic where possible
- Minimize additional API calls

---

# Assumptions

- Tasks already have:
  - assigned user
  - department association

If not:
- derive department via project or task grouping logic

---

# Success Criteria

- [ ] Tasks display immediately on opening Tasks tab
- [ ] Logged-in user is auto-selected in filter
- [ ] Tasks grouped by department
- [ ] Departments are collapsible
- [ ] Switching employee updates task list
- [ ] No regressions in existing task functionality