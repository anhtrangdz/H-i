# Sổ Relax iOS — Local-first

Bản iPhone của Sổ Relax chạy hoàn toàn trên thiết bị, không cần VPS, domain hay Node server.
Giao diện web gốc được đóng trong `WKWebView`; dữ liệu và media được lưu local bằng vault mã hóa.

## Kiến trúc

- `SoreRelax/Web/` — HTML/CSS/JS và LocalAPI tương thích các route `/api/...` cũ.
- `SoreRelax/SecureVault.swift` — vault local AES-GCM, password KDF, Keychain/biometric, backup/restore.
- `SoreRelax/NativeBridge.swift` — bridge giữa JavaScript và native Swift.
- `SoreRelax/MediaSchemeHandler.swift` — đọc media đã mã hóa qua scheme local `sorelax-media://`.
- `SoreRelax/ViewController.swift` — `WKWebView`, privacy cover, Files picker/share sheet.
- `project.yml` — cấu hình XcodeGen.
- `.github/workflows/build-ipa.yml` — build unsigned IPA bằng GitHub Actions.

Bundle ID cố định: `com.prix.sorelax`.
Deployment target: iOS 15.0+.

## Build IPA bằng GitHub Actions

1. Tạo repository GitHub mới.
2. Giải nén ZIP này và upload **toàn bộ nội dung bên trong thư mục repo** lên branch `main` hoặc `master`.
3. Mở tab **Actions** → **Build unsigned IPA**.
4. Chọn **Run workflow** nếu workflow chưa tự chạy sau lần push đầu.
5. Khi job hoàn tất, tải artifact `SoreRelax-unsigned-IPA`.
6. Bên trong artifact có:
   - `SoreRelax-unsigned.ipa`
   - `SoreRelax-unsigned.ipa.sha256`
   - `build-xcode.log`
7. Import IPA vào SideStore để ký/cài bằng Apple ID của bạn.

Workflow tạo Xcode project từ `project.yml`, chạy QA, build `Release-iphoneos` với code signing tắt, sau đó đóng `.app` vào `Payload/` để tạo IPA unsigned.

## QA local

Nếu có Node.js + Python 3:

```bash
node --check SoreRelax/Web/native-bridge.js
node --check SoreRelax/Web/local-api.js
node --check SoreRelax/Web/app.js
node tests/local-api.test.js
python3 scripts/qa_repo.py
python3 tests/responsive_smoke.py
```

`responsive_smoke.py` sử dụng Chromium/Playwright khi môi trường có sẵn và kiểm tra nhiều route/viewport iPhone để phát hiện horizontal overflow.

## Dữ liệu và bảo mật

- Không có backend Internet và không gửi dữ liệu Sổ Relax lên server.
- Password không được lưu plaintext.
- Master key được bọc bằng khóa dẫn xuất từ password.
- Vault và media dùng AES-GCM để bảo vệ confidentiality + integrity.
- Có thể bật Face ID/Touch ID để mở khóa master key qua Keychain.
- Đưa app ra background sẽ phủ privacy cover để giảm lộ nội dung trong App Switcher.
- Backup `.sobackup` được mã hóa và có thể lưu ra Files/Share Sheet.

## Responsive iPhone

Web UI có safe-area support (`env(safe-area-inset-*)`) và breakpoint cho iPhone nhỏ/lớn, portrait/landscape. Layout tránh phụ thuộc một model iPhone cụ thể; các control tương tác chính được điều chỉnh cho touch target iOS.

## Lưu ý khi update

Giữ nguyên `PRODUCT_BUNDLE_IDENTIFIER = com.prix.sorelax` ở các bản sau để update cùng app identity. Luôn xuất backup trước khi xóa app; việc uninstall có thể xóa dữ liệu sandbox local.


## CI packaging note

The workflow includes a **Web bundle packaging guard**. After Xcode finishes the unsigned native build, CI explicitly places `SoreRelax/Web` at `SoreRelax.app/Web` before creating the IPA, then verifies `Payload/SoreRelax.app/Web/index.html` exists inside the archive. This avoids resource-folder flattening differences between Xcode/XcodeGen versions.
