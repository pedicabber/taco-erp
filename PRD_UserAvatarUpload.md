# TODDCO ERP – USER AVATAR UPLOAD PRD

## Module
Admin Settings → Users → Edit User Modal

---

# Objective

Replace the avatar URL input with a simple image upload button that stores images in cloud storage and automatically sets the avatar.

---

# Current Behavior

- Avatar is set via manual URL input
- No upload or browse capability

---

# Desired Behavior

## Upload Flow

- User clicks "Upload Image" button
- File picker opens
- User selects an image
- Image uploads to cloud storage
- System returns URL
- Avatar preview updates automatically
- URL is saved to avatarUrl field

---

## UI Requirements

- Remove avatar URL text input
- Add:
  - "Upload Image" button
  - Image preview (existing or newly uploaded)
- Button placed where avatar field currently exists
- No drag-and-drop required

---

# File Requirements

- Accept standard image types (jpg, png, webp)
- Max size: standard (~5MB)
- Reject invalid formats with error message

---

# Storage Requirements

- Use cloud storage (no local file storage)
- Return a public URL after upload
- Store URL in existing avatarUrl field

---

# Workflow

1. Admin opens user edit modal
2. Clicks "Upload Image"
3. Selects file
4. Upload occurs
5. Preview updates immediately
6. Admin clicks Save
7. Avatar persists

---

# Technical Constraints

- Do NOT modify user authentication
- Do NOT change user schema
- Reuse avatarUrl field
- Minimize backend complexity
- Use existing API patterns where possible

---

# Implementation Guidance

- Add a single upload endpoint (POST /upload/avatar)
- Handle upload → return URL
- Frontend handles preview + save

---

# Success Criteria

- [ ] Image upload works via file picker
- [ ] Uploaded image displays immediately
- [ ] URL saved correctly to avatarUrl
- [ ] No page reload required
- [ ] No impact to other user functionality