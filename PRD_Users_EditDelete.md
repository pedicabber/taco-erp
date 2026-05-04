# TODDCO ERP – USER MANAGEMENT (EDIT / DELETE) PRD

## Module
Admin Settings → Users

---

# Objective

Allow admins to:
- Edit user accounts
- Assign departments (multiple)
- Update user details (role, photo, password)
- Delete users

All actions should be accessible from the Users list.

---

# Current Behavior

- Users are displayed in a list
- No way to click into a user
- No ability to edit or delete users

---

# Desired Behavior

## User Interaction

- Clicking a user row opens a modal popup
- Modal contains full editable user details

---

## Editable Fields

Inside modal:
- Name
- Email (if currently supported)
- Role
- Password (optional update)
- Profile photo
- Departments (multi-select)

---

## Department Selection

- Clicking “Departments” opens a secondary selection panel
- Displays all departments with checkboxes
- Allows multiple selections
- Saves selected departments back to user

---

## Delete User

- Trash icon at top of modal
- Clicking prompts confirmation
- On confirm → user is deleted

---

# UI Requirements

- Keep existing Users list layout
- Clicking anywhere on user row opens modal
- Modal styling consistent with existing dialogs
- Department selection UI:
  - Checkbox list
  - Scrollable if needed
- Delete icon visible but not intrusive (top right)

---

# Workflow

1. Admin clicks Settings (gear)
2. Lands on Users tab
3. Clicks a user
4. Modal opens
5. Admin edits:
   - role
   - departments
   - photo
   - password (optional)
6. Admin clicks Save
7. OR clicks delete icon → confirms → user removed

---

# Technical Constraints

- Do NOT redesign Users page layout
- Do NOT change authentication system
- Do NOT break login or session handling
- Reuse existing user API endpoints where possible
- Do NOT introduce new user schema unless required
- Department assignment must integrate with existing department system

---

# Assumptions

- Users table already exists
- Departments table already exists
- A user can belong to multiple departments (if not, extend safely)

---

# Success Criteria

- [ ] Clicking a user opens edit modal
- [ ] User fields can be updated and saved
- [ ] Departments can be multi-selected
- [ ] Changes persist correctly
- [ ] User can be deleted with confirmation
- [ ] No regression in login/auth behavior