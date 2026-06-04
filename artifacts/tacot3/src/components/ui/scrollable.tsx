import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Scrollable Content Standard
 * --------------------------------------------------------------------------
 * Any UI container that can display content larger than the visible viewport
 * (dialogs, modals, drawers, sheets, slide-over panels, detail views,
 * create/edit forms, multi-step wizards, and future reusable containers)
 * MUST follow this layout so users never have to zoom the browser to reach
 * content or action buttons:
 *
 *   Shell  -> capped height, vertical flex stack, clips overflow
 *   Header -> fixed, always visible (title / description / close)
 *   Body   -> the single scroll region (form fields, tables, notes, etc.)
 *   Footer -> fixed, always visible (Save / Cancel / Delete / Approve / ...)
 *
 * Compose with the <ScrollableShell> / <ScrollableHeader> / <ScrollableBody> /
 * <ScrollableFooter> components, or apply the exported class constants to your
 * own elements. The Dialog, Sheet, Drawer, and AlertDialog primitives are all
 * built on this same standard.
 */

export const scrollableShellClass =
  "flex max-h-[85vh] flex-col overflow-hidden"

export const scrollableHeaderClass = "shrink-0"

export const scrollableBodyClass =
  "min-h-0 flex-1 overflow-y-auto overscroll-contain"

export const scrollableFooterClass = "shrink-0"

const ScrollableShell = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn(scrollableShellClass, className)} {...props} />
))
ScrollableShell.displayName = "ScrollableShell"

const ScrollableHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn(scrollableHeaderClass, className)} {...props} />
))
ScrollableHeader.displayName = "ScrollableHeader"

const ScrollableBody = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn(scrollableBodyClass, className)} {...props} />
))
ScrollableBody.displayName = "ScrollableBody"

const ScrollableFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn(scrollableFooterClass, className)} {...props} />
))
ScrollableFooter.displayName = "ScrollableFooter"

export {
  ScrollableShell,
  ScrollableHeader,
  ScrollableBody,
  ScrollableFooter,
}
