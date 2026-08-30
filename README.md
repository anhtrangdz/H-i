# Sổ Relax iOS R3 — Local-first

Bản iPhone của Sổ Relax chạy hoàn toàn trên thiết bị, không cần VPS, domain hay Node server.
R3 thay toàn bộ lớp giao diện bằng thiết kế mobile-first theo ngôn ngữ iOS: system typography, grouped surfaces, translucent tab bar, bottom sheets, safe-area, keyboard-aware editor và responsive portrait/landscape.

## Kiến trúc

- `SoreRelax/Web/` — UI mới + LocalAPI tương thích các route `/api/...` cũ.
- `SoreRelax/SecureVault.swift` — vault local AES-GCM, password KDF, Keychain code nền, backup/restore.
- `SoreRelax/NativeBridge.swift` — bridge giữa JavaScript và native Swift.
- `SoreRelax/MediaSchemeHandler.swift` — đọc media mã hóa qua scheme local `sorelax-media://`.
- `SoreRelax/ViewController.swift` — `WKWebView`, privacy cover, Files picker/share sheet, interactive keyboard dismissal.
- `project.yml` — cấu hình XcodeGen.
- `.github/workflows/build-ipa.yml` — build unsigned IPA bằng GitHub Actions.

Bundle ID cố định: `com.prix.sorelax`.
Deployment target: iOS 15.0+.

## Những thay đổi chính ở R3

- Bỏ UI desktop/sidebar cũ; toàn bộ navigation được thiết kế lại cho iPhone.
- Bottom tab bar gồm Hôm nay, Tài chính, Thêm, Nhật ký, Khác.
- Các mục Giao dịch, Ngân sách, Lịch, Mục tiêu, Phân tích, Cài đặt nằm trong bottom sheet `Khác`.
- `Viết nhật ký hôm nay` render thẳng Daily editor và focus `textarea` ngay trong tap event; route không dùng URL hash/sessionStorage.
- Khi input/textarea focus, bottom tab bar tự né để không cản bàn phím.
- Daily editor đứng trước lịch trên portrait; landscape chuyển sang two-column.
- Tự hỗ trợ light/dark system scheme và chế độ tối ấm hiện có.
- Face ID/Touch ID **không được đưa vào UI R3**. Password local là cơ chế mở khóa chuẩn để tránh phụ thuộc vào hành vi signing/sideload. Code native nền được giữ để không phá format/khả năng nâng cấp sau này.

## Build IPA bằng GitHub Actions

1. Tạo repository GitHub mới.
2. Giải nén ZIP và upload **toàn bộ nội dung bên trong thư mục repo** lên branch `main` hoặc `master`.
3. Mở **Actions** → **Build unsigned IPA**.
4. Chọn **Run workflow** nếu workflow chưa tự chạy.
5. Khi job xong, tải artifact `SoreRelax-unsigned-IPA`.
6. Artifact chứa:
   - `SoreRelax-unsigned.ipa`
   - `SoreRelax-unsigned.ipa.sha256`
   - `build-xcode.log`
7. Import IPA vào SideStore để ký/cài.

Workflow tạo Xcode project từ `project.yml`, chạy QA, build `Release-iphoneos` với code signing tắt, cưỡng chế `SoreRelax/Web` vào đúng `SoreRelax.app/Web`, rồi mới đóng IPA.

## QA

QA dependency-free chạy trong GitHub Actions:

```bash
node --check SoreRelax/Web/native-bridge.js
node --check SoreRelax/Web/local-api.js
node --check SoreRelax/Web/app.js
node tests/local-api.test.js
python3 scripts/qa_repo.py
```

QA browser sâu hơn (khi máy có Chromium + Python Playwright):

```bash
python3 tests/responsive_smoke.py
python3 tests/ui_interaction_smoke.py
```

`responsive_smoke.py` render 10 route trên 14 viewport iPhone/compact/landscape, kiểm tra horizontal overflow, tap target cực nhỏ và JS runtime errors. `ui_interaction_smoke.py` kiểm thử riêng regression `Viết nhật ký → Daily → focus editor`, lưu nhật ký, More-sheet navigation và Quick Add.

## Dữ liệu và bảo mật

- Không có backend Internet và không gửi dữ liệu lên server.
- Password không lưu plaintext.
- Master key được bọc bằng khóa dẫn xuất từ password.
- Vault và media dùng AES-GCM để bảo vệ confidentiality + integrity.
- App ra background sẽ phủ privacy cover để giảm lộ nội dung trong App Switcher.
- Backup `.sobackup` được mã hóa và xuất qua Files/Share Sheet.

## Responsive iPhone

UI dùng safe area `env(safe-area-inset-*)`, mobile-first layout, portrait + landscape và không hard-code theo một model. Bộ QA bao phủ từ 320 px fallback đến các width 360/375/390/393/402/420/430/440 pt cùng landscape 844/874/932/956.

## Lưu ý update

Giữ nguyên `PRODUCT_BUNDLE_IDENTIFIER = com.prix.sorelax` để update cùng app identity. Luôn xuất backup trước khi uninstall; xóa app có thể xóa dữ liệu sandbox local.
