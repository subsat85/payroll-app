# Tests

Browser tests for the payroll/attendance app. They open `../index.html` directly (no server needed) in headless Chromium.

## Run

```bash
cd tests
npm install          # installs Playwright (pinned in package.json)
npx playwright install chromium   # only if you don't already have a matching Chromium
npm test             # all suites; exits 1 on any failure
node run.js rtl      # a single suite
```

Environment variables:

| Variable | Effect |
|---|---|
| `RM=1` | Run with `prefers-reduced-motion: reduce` (the runner already does this for `safety` and `mobile`). |
| `CHROMIUM_PATH` | Use a preinstalled Chromium binary instead of Playwright's download. |
| `PLAYWRIGHT_BROWSERS_PATH` | Standard Playwright browser cache location. |

## Suites

| File | Covers |
|---|---|
| `calculations.test.js` | Salary, entitlement days, absence/late, advances, unpaid leave, social security, overtime, live attendance, manual posting, automatic vs manual months, global off — every result compared with the independent oracle. |
| `safety.test.js` | Backup (copy + file), restore (file, paste, snapshot), automatic snapshots, delete employee + undo, wipe + recover, invalid/partial backups, storage-full fallback, unsaved-changes counter. |
| `rtl.test.js` | Visual order of negative numbers, currency, times, dates and `x / y` counters; long Arabic names; no horizontal overflow at 320/375/390px. |
| `mobile.test.js` | 44px touch targets, sheets on short screens, swipe-to-close, backdrop tap, time fields, scrolling above the bottom bar, dark-mode button contrast. |
| `animation.test.js` | Sheet open/close/interrupt/swipe, non-blocking close (taps during the exit animation reach the page), toast undo bar and long-name toasts, check-in and delivered feedback (incl. dimmed contrast), month direction without sideways scroll, instant tabs, transform/opacity-only audit, reduced-motion fallbacks at 320/375/390px, and the confirm-sheet close-event race. |
| `security.test.js` | Planted HTML/script payloads in every user-controlled field (IDs, names, notes, times, settings, snapshots) across every screen and sheet; hostile-ID backups rejected; static audit of attribute interpolations. |
| `schema.test.js` | `schemaVersion` + migration runner, fresh install, legacy data loading unchanged, newer-version read-only, corrupt-data preservation, and persistent alerts (save failure, storage full, restore failure, no storage). |

## Shared files

- `oracle.js` — independent re-implementation of the original Excel formulas. It never imports app code; keep it in sync with the spreadsheets.
- `fixtures.js` — realistic legacy data as written by earlier app versions (generic sample names, not real staff).
- `lib.js` — browser launch, page setup, and pass/fail reporting.
