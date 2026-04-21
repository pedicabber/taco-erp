# TacoTracker3 (TacoT3) - Workspace

## Overview

pnpm workspace monorepo using TypeScript. Engineering project management app for TODDCO (internal). ClickUp-style with Projects → Departments → Tasks structure.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle for API server)
- **Auth**: Clerk (via `@clerk/express` server-side + `@clerk/react` frontend)
- **Storage**: Replit Object Storage (presigned URL uploads)
- **PDF parsing**: `pdf-parse`

## Apps / Artifacts

### `artifacts/tacot3` (React + Vite, port 19801, path `/`)
Main frontend - TacoTracker3 project management app.
- Clerk auth with Google OAuth
- Dark/light/system theme
- Pages: Dashboard, Projects, Project Detail, Tasks, Task Detail, Kanban Board, Calendar/Gantt, Notifications

### `artifacts/api-server` (Express, port 8080, path `/api`)
REST API server.
- All routes under `/api`
- Clerk JWT validation via `clerkMiddleware()`
- PDF scraping at `POST /api/projects/parse-pdf`

## Libraries

- `lib/db` — Drizzle ORM schema + db connection (PostgreSQL)
- `lib/api-spec` — OpenAPI spec (`openapi.yaml`)
- `lib/api-zod` — Generated Zod schemas from OpenAPI spec
- `lib/api-client-react` — Generated React Query hooks (from orval)
- `lib/object-storage-web` — Object storage client for frontend

## Database Schema

- `users` — Clerk-synced users with roles (admin/member) + department linkage
- `projects` — Customer projects (PDF-scraped or manual)
- `departments` — Department groups per project with color
- `tasks` — Tasks with 5 statuses, 4 priorities, timer tracking
- `task_relations` — Task dependency links
- `task_attachments` — Object storage file references
- `notifications` — User notifications (overdue/assigned/timer_alert/etc.)
- `activity_log` — Audit log of task actions
- `inventory_items` / `inventory_allocations` — Inventory quantities and project allocations; allocations are removed when a project is deleted so parts become available again

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Features

- **Projects**: Create from PDF (scrapes company, quote no, part number, description, date) or manually
- **Departments**: Color-coded per project, assign tasks to departments
- **Tasks**: 5 statuses (backlog/in_progress/in_review/blocked/complete), 4 priorities
- **Timer**: Start/stop/edit per task; live elapsed counter; clock-in sessions record who started each timer; warn when over expected hours
- **Kanban Board**: Drag-and-drop between status columns; filter by project/department
- **Calendar**: Monthly view showing task start/due dates; Gantt view with dual bars (expected vs actual)
- **Notifications**: Overdue, assigned, timer alerts; mark read/all read
- **File Uploads**: Attach files to tasks via object storage presigned URLs
- **Project Attachments**: Project-level files, including quote PDFs, stored via object storage and visible alongside task attachments
- **Inventory**: Allocations are computed from live allocation rows and released automatically when projects are deleted
- **Followers**: Follow tasks to receive notifications
- **Activity Feed**: Recent actions dashboard

## Important Design Decisions

- NO emojis anywhere; icons only (lucide-react)
- Adaptive dark/light/system mode stored in `localStorage`
- Mobile-friendly responsive layout with collapsible sidebar
- Timer: `elapsedSeconds` stored in DB + `timerStartedAt` timestamp for live compute
- New projects auto-create five task templates for each global department: ENGINEERING, MANUFACTURING, CONTROLS, INSTALL, PROJECT MANAGEMENT, and OFFICE/ADMIN
- Task notes are stored in the `tasks.notes` column and edited on the task detail page between time tracking and attachments
- User sync: Clerk users auto-synced to `users` table on first request via `syncUserFromClerk()`
- Vite dev proxy forwards `/api` to port 8080 and `/__clerk` for Clerk proxy
