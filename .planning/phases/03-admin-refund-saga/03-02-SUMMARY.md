---
phase: 03-admin-refund-saga
plan: 02
subsystem: admin-ui
tags: [next.js, server-action, stripe, admin-dashboard, error-handling]

# Dependency graph
requires:
  - phase: 03-01
    provides: POST /api/admin/refund-booking Express endpoint returning { success, action } or { error }
provides:
  - Admin dashboard refund button wired to backend saga (no longer DB-only)
  - Inline red error display in RefundButton on Stripe or backend failure
affects:
  - Human verifier (Task 2 checkpoint awaiting approval)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Server action proxies to Express backend with X-Admin-Secret header (same pattern as admin/lib/whatsapp.ts)
    - Return typed union { success: true; action: string } | { error: string } — never throw from server action
    - useState for inline error message; dialog stays open on failure for retry

key-files:
  created: []
  modified:
    - admin/app/(dashboard)/bookings/actions.ts
    - admin/app/(dashboard)/bookings/refund-button.tsx

key-decisions:
  - "Server action delegates entirely to backend endpoint — no Supabase or Stripe calls in Next.js layer"
  - "Server action catches fetch errors and returns { error } instead of throwing, per RESEARCH.md Pitfall 4"
  - "RefundButton clears errorMessage on dialog re-open to avoid stale error display"
  - "revalidatePath('/bookings') called only on success — prevents stale list after successful refund"

patterns-established:
  - "Pattern: Admin server actions as thin fetch proxies to Express backend (refund joins cancel-trip pattern)"
  - "Pattern: Inline error display below DialogFooter for non-blocking failure UX"

requirements-completed: [RFND-01, RFND-04]

# Metrics
duration: 5min
completed: 2026-03-31
---

# Phase 03 Plan 02: Admin Refund Saga Frontend Summary

**Thin-proxy server action wires RefundButton to the backend saga endpoint; inline red error shown on failure with dialog kept open for retry**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-31
- **Completed:** 2026-03-31
- **Tasks:** 1 of 2 auto-executed (Task 2 is checkpoint:human-verify — awaiting human approval)
- **Files modified:** 2

## Accomplishments

- Replaced DB-only refundBooking() server action with a thin fetch proxy to `EXPRESS_BOT_URL/api/admin/refund-booking`
- Removed `createServerSupabase` and `sendWhatsAppTemplate` imports — backend owns both Stripe and notification logic
- Added `errorMessage` state to RefundButton with inline `text-red-600` display inside DialogContent
- Dialog stays open and button stays enabled on failure — user can retry without reopening
- Error clears when dialog is re-opened (clean UX for fresh attempt)
- TypeScript compiles cleanly in admin directory

## Task Commits

1. **Task 1: Replace server action and add RefundButton error state** - `5991cef` (feat)

## Files Created/Modified

- `admin/app/(dashboard)/bookings/actions.ts` — Replaced entire file: removed DB calls, added fetch proxy with X-Admin-Secret header
- `admin/app/(dashboard)/bookings/refund-button.tsx` — Added errorMessage state, updated handleConfirm, added error display, cleared error on open

## Decisions Made

- Server action returns typed union `{ success: true; action: string } | { error: string }` matching the backend response contract exactly
- `err instanceof Error` check used instead of `err: any` to satisfy TypeScript strict mode while extracting message safely
- Error display placed after DialogFooter (not inside it) to avoid disrupting button layout

## Deviations from Plan

### Minor Adjustment

**1. [Rule 2 - TypeScript] Replaced `err: any` with `err: unknown` + instanceof guard**

- **Found during:** Task 1 implementation
- **Issue:** Plan template used `err: any` in catch block — CLAUDE.md prohibits unsafe `any` types in production code
- **Fix:** `catch (err: unknown)` with `err instanceof Error ? err.message : 'Network error...'`
- **Files modified:** admin/app/(dashboard)/bookings/actions.ts
- **Commit:** 5991cef

## Known Stubs

None — server action fully wired to live backend endpoint. No hardcoded values or placeholders in the data path.

## Checkpoint: Task 2 Awaiting

Task 2 is a `checkpoint:human-verify` gate. The verifier should:

1. Run migration: `npx tsx supabase/migrations/run_migrations.ts`
2. Start dev server: `npm run dev` in admin directory
3. Open admin dashboard → Bookings
4. Find a booking with status "authorized" → click Refund
5. Confirm dialog appears → click "Confirm Refund"
6. Verify booking status changes to "refunded" in the list
7. Check Supabase: `SELECT * FROM refund_audit ORDER BY created_at DESC LIMIT 1` shows success=true
8. To test error path: use invalid booking ID — verify inline red error appears and dialog stays open

## Self-Check: PASSED

- admin/app/(dashboard)/bookings/actions.ts: FOUND
- admin/app/(dashboard)/bookings/refund-button.tsx: FOUND
- Commit 5991cef: confirmed via git log

---
*Phase: 03-admin-refund-saga*
*Completed: 2026-03-31*
