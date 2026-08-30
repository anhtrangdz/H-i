# Sổ Relax iOS R4 — iPhone-first local app

R4 rebuild toàn bộ visual layer của Sổ Relax cho iPhone. App vẫn local-first: không VPS, không domain, không Node server khi chạy trên máy.

## R4 khác gì R3

- Home, Tài chính, Nhật ký và Cài đặt được dựng lại hoàn toàn theo hierarchy iOS: large title, material surface, tab bar, sheet, grouped settings và edge-to-edge artwork.
- Các màn Giao dịch, Ngân sách, Lịch, Mục tiêu, Phân tích, Nhật ký cá nhân được re-skin theo cùng design system.
- 12 visual asset high-resolution được bundle local và thực sự được dùng trong UI; không dùng padding/file rác để tăng dung lượng.
- `Viết nhật ký` điều hướng bằng state nội bộ, render editor ngay rồi focus `#dailyBody` trong cùng tap event. Không dùng hash/sessionStorage.
- VisualViewport được dùng để nhận biết keyboard; bottom tab bar tự né khi bàn phím mở.
- Save journal chủ động blur editor để dismiss keyboard sau khi lưu.
- Biometrics không nằm trong UX chính; password local là đường mở khóa chuẩn.

## Responsive iPhone

UI dùng safe area `env(safe-area-inset-*)`, `100dvh`, scroll containers và breakpoint mobile-first. Browser QA render 10 route trên 14 viewport:

- Portrait/fallback: 320, 350, 360, 375, 390, 393, 402, 420, 430, 440 pt.
- Landscape: 844×390, 874×402, 932×430, 956×440.

Các control chính được thiết kế quanh touch target iOS; QA chặn control nhỏ hơn 28 pt và horizontal overflow.

## Visual assets R4

`SoreRelax/Web/assets/r4/` chứa artwork local cho Home, Finance, Journal, Calendar, Goals, Insights, Settings, Auth và backup surfaces. Tổng bundle asset >5 MB raw và workflow kiểm tra các asset quan trọng có mặt trong `.app` trước khi đóng IPA.

## Kiến trúc

- `SoreRelax/Web/` — UI + LocalAPI compatibility layer.
- `SoreRelax/SecureVault.swift` — AES-GCM vault, password-derived key protection, encrypted backup/media.
- `SoreRelax/NativeBridge.swift` — JS ↔ Swift bridge.
- `SoreRelax/MediaSchemeHandler.swift` — local encrypted media scheme.
- `SoreRelax/ViewController.swift` — WKWebView shell, privacy cover, Files/share integration.
- `project.yml` — XcodeGen config, bundle ID `com.prix.sorelax`.
- `.github/workflows/build-ipa.yml` — unsigned iPhone Release build on GitHub macOS runner.

Version: `1.1.0 (4)`.
Deployment target: iOS 15+.

## Build trên GitHub

1. Giải nén ZIP.
2. Upload **nội dung bên trong thư mục R4** vào root repository GitHub (`main` hoặc `master`).
3. GitHub → **Actions** → **Build unsigned IPA** → Run workflow.
4. Tải artifact `SoreRelax-R4-unsigned-IPA`.
5. Artifact chứa `SoreRelax-unsigned.ipa`, SHA256 và `build-xcode.log`.
6. Import IPA vào SideStore để ký/cài.

Workflow cưỡng chế copy nguyên `SoreRelax/Web` vào `SoreRelax.app/Web` trước khi đóng IPA và kiểm tra `index.html`, `r4.css`, cùng R4 artwork trong payload.

## QA

Dependency-free / CI:

```bash
node --check SoreRelax/Web/native-bridge.js
node --check SoreRelax/Web/local-api.js
node --check SoreRelax/Web/app.js
node tests/local-api.test.js
python3 scripts/qa_repo.py
```

Browser release QA (Chromium + Playwright):

```bash
python3 tests/ui_interaction_smoke.py
python3 tests/responsive_smoke.py
```

`ui_interaction_smoke.py` kiểm tra riêng Home → Viết nhật ký → Daily → editor focus, save daily, More sheet và Quick Add transaction.

## Dữ liệu và bảo mật

- Không gửi dữ liệu lên Internet trong runtime (`connect-src 'none'`).
- Password không lưu plaintext.
- Vault/media dùng AES-GCM.
- App background có privacy cover.
- Backup `.sobackup` được mã hóa trước khi xuất qua Files/Share Sheet.
- Luôn export backup trước khi uninstall app; xóa app có thể xóa sandbox local.
