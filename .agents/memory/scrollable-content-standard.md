---
name: Scrollable content standard (dialogs/panels)
description: Conventions and non-obvious decisions for the shared overflow-safe container standard in tacot3 UI primitives.
---

# Scrollable content standard

`components/ui/scrollable.tsx` defines the canonical pattern + exported class constants
(`scrollableShellClass`, `scrollableHeaderClass`, `scrollableBodyClass`, `scrollableFooterClass`).
Pattern: fixed Header (`shrink-0`), scrollable Body (`min-h-0 flex-1 overflow-y-auto overscroll-contain`),
fixed Footer (`shrink-0`), shell capped at `max-h-[85vh]`. Any container that can exceed viewport
height should follow this so the footer/actions never scroll out of view.

## Non-obvious decisions

- **AlertDialogContent keeps `overflow-y-auto`, NOT `overflow-hidden`.**
  **Why:** alert dialogs are often used with content directly in the header (title+description) and
  no Body wrapper. With `overflow-hidden` + `shrink-0` header, long content would *clip* (worse than
  scrolling). Keeping `overflow-y-auto` is a graceful fallback: when `AlertDialogBody` is used the body
  scrolls and footer stays fixed; when it isn't, the whole content scrolls so nothing is ever clipped.
  **How to apply:** don't "tighten" AlertDialog to overflow-hidden to match Dialog — the fallback is intentional.

- **Sheet base (`sheetVariants` in `sheet.tsx`) must NOT carry `gap-4`.**
  **Why:** the mobile sidebar (`components/ui/sidebar.tsx`) renders `SheetContent` with `p-0`, an
  `sr-only` header, and its own full-height flex child. A global `gap-4` injected a 16px gap between the
  hidden header and content. Spacing belongs on Header/Body/Footer, not the shell.
  **How to apply:** keep shell-level cva strings layout-only (flex/overflow/position), not spacing.
