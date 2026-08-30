# Sổ Relax R5 — Functional redesign

R5 is not a cosmetic reskin. It changes interaction architecture while keeping the encrypted local vault and the R4 outer visual identity.

## Primary device

Design and regression testing start from iPhone SE (3rd generation / 2022): 4.7-inch Retina HD, 750×1334 pixels, equivalent to a 375×667pt layout at 2× scale. The same UI is then stress-tested down to 320pt and up to 440pt, plus landscape.

## Journal model

R4 incorrectly treated a date as a single editable journal record. R5 treats a date as a collection of independent entries.

Flow:

1. Journal day view shows saved entries.
2. **Write new** opens a blank composer.
3. Save creates an independent entry.
4. Save exits the composer and returns to the day's entry list.
5. **Write new** always opens a clean draft.
6. Tapping an existing entry intentionally enters edit mode.
7. Delete is only shown while editing an existing entry.

Legacy daily entries remain readable because R5 continues to store entries in `dailyEntries`, but the local API now supports `/api/journal` creation and `/api/journal/:id` update/delete.

## Critical routing correction

R4 stored the current route on `#pageWrap` as `data-route` while global click handling used `closest('[data-route]')`. Any control inside a page could therefore bubble to the page container and be interpreted as navigation.

R5 explicitly excludes `pageWrap` from navigation handling. This fixes mood buttons, save controls, and other in-page interactions being reset by accidental rerenders.

## Photo selection

R5 removes the journal's WebKit `<input type="file">` path. The app presents Apple's native `PHPickerViewController` through the Swift bridge.

Selected image bytes are written directly to the encrypted native media vault; only metadata IDs return to JavaScript. This avoids transferring large photo Base64 payloads through WKScriptMessageHandler and does not request blanket access to the user's entire Photos library.

## Form system

All editors use a common iPhone form language:

- one-column fields on iPhone;
- 50–54pt field height;
- grouped surfaces and clear labels;
- large numeric amount editor;
- sticky save/cancel actions in sheets;
- keyboard-aware layout;
- secure password fields;
- no desktop two-column form on iPhone SE;
- modal content constrained to the visible viewport.

## R5 validation gates

- Local API transaction and rollback tests.
- Multiple journal entries on the same date.
- Native picker metadata persistence and orphan-file rollback.
- Journal interaction regression: new → mood → photo → save → list → new blank draft.
- Quick-add mutation.
- Password form contract.
- Generic form workflow smoke on 375×667 and 390×844.
- Responsive rendering across 16 portrait/landscape viewports including 375×667 and 667×375.
- Dark-mode rendering.
- Auth form rendering.
- Swift syntax parse, JS syntax checks, plist/workflow validation, ZIP manifest/integrity.
