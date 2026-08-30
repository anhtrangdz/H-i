# Sổ Relax iOS R5

Offline/local-first iPhone app. No VPS, domain, Node server, or Internet connection is required for normal use.

## What changed in R5

R5 focuses on broken interaction logic and internal editors, not the already-acceptable outer shell.

- Journal now supports multiple independent entries per day.
- Saving a journal entry exits edit mode and returns to the day's saved entries.
- **Write new** always creates a clean draft.
- Existing entries can be opened deliberately for editing/deleting.
- Mood selection is real application state and persists when saved.
- Photos use native iOS `PHPickerViewController` rather than a WebKit file input.
- Global routing bug fixed: controls inside `#pageWrap` can no longer be mistaken for navigation.
- Quick Add rebuilt as an iPhone bottom-sheet editor.
- Account, budget, goal, profile, password, backup and other input forms share one iOS-style form system.
- Layout is designed first for iPhone SE 2022 (375×667pt) and then tested across small/large iPhones and landscape.
- Face ID / Touch ID is not part of the R5 primary UX; local password unlock remains the supported path.

## Architecture

- UIKit `WKWebView` shell.
- Bundled HTML/CSS/JS; no online website is loaded.
- `SecureVault.swift`: encrypted local state and media.
- `NativeBridge.swift`: JS ↔ native bridge.
- `PHPickerViewController`: native photo selection.
- `UIDocumentPickerViewController`: backup restore.
- `UIActivityViewController`: backup export.

## Build on GitHub

Upload the contents of this repository to the root of a GitHub repository.

The included workflow is:

`.github/workflows/build-ipa.yml`

It builds an unsigned iPhone app on GitHub's macOS runner and packages:

- `SoreRelax-unsigned.ipa`
- `SoreRelax-unsigned.ipa.sha256`
- `build-xcode.log`

The artifact is named `SoreRelax-R5-unsigned-IPA`.

The resulting unsigned IPA can then be signed/sideloaded with the signing workflow you use on your iPhone.

## Bundle identity

- Bundle ID: `com.prix.sorelax`
- Marketing version: `1.2.0`
- Build: `5`
- Deployment target: iOS 15+
- Device family: iPhone

Keep the bundle ID unchanged between updates if you want iOS to treat later builds as updates to the same app.

## Local QA

Core dependency-free checks:

```sh
node --check SoreRelax/Web/native-bridge.js
node --check SoreRelax/Web/local-api.js
node --check SoreRelax/Web/app.js
node tests/local-api.test.js
python3 tests/native_contract.py
python3 scripts/qa_repo.py
```

Browser interaction/layout tests (requires Chromium + Python Playwright):

```sh
python3 tests/ui_interaction_smoke.py
python3 tests/form_workflow_smoke.py
python3 tests/responsive_smoke.py
python3 tests/dark_responsive_smoke.py
python3 tests/auth_responsive_smoke.py
```

## Photo privacy behavior

R5 intentionally uses the system Photos picker. Tapping **Add photo** opens the iOS picker and the user selects only the photos to give to Sổ Relax. A blanket “allow access to all photos” prompt is therefore not required for this flow.

## Important

The Linux QA environment can parse Swift syntax but cannot run Apple's `xcodebuild`. The GitHub Actions macOS job is the final native compile gate. If that gate fails, use the generated `build-xcode.log` to diagnose the exact Swift/Xcode error.
