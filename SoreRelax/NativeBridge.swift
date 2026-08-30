import Foundation
import WebKit
import UIKit

final class NativeBridge: NSObject, WKScriptMessageHandler {
    weak var webView: WKWebView?
    weak var viewController: ViewController?
    private let vault = SecureVault.shared

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "sorelax",
              let body = message.body as? [String: Any],
              let id = body["id"] as? String,
              let method = body["method"] as? String else { return }
        let params = body["params"] as? [String: Any] ?? [:]

        if method == "restoreBackupPicker" {
            let password = params["password"] as? String ?? ""
            DispatchQueue.main.async { [weak self] in
                guard let self, let vc = self.viewController else { self?.reject(id: id, message: "Không mở được trình chọn file."); return }
                vc.presentRestorePicker(requestID: id, password: password)
            }
            return
        }

        if method == "pickPhotos" {
            let maxSelection = max(1, min(12, params["maxSelection"] as? Int ?? 8))
            DispatchQueue.main.async { [weak self] in
                guard let self, let vc = self.viewController else { self?.reject(id: id, message: "Không mở được trình chọn ảnh."); return }
                vc.presentPhotoPicker(requestID: id, maxSelection: maxSelection)
            }
            return
        }

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            do {
                let result = try self.execute(method: method, params: params)
                if method == "exportBackup", let path = result["path"] as? String {
                    DispatchQueue.main.async {
                        guard let vc = self.viewController else {
                            try? FileManager.default.removeItem(atPath: path)
                            self.reject(id: id, message: "Không mở được Share Sheet.")
                            return
                        }
                        vc.presentShareSheet(fileURL: URL(fileURLWithPath: path))
                        self.resolve(id: id, result: ["ok": true])
                    }
                } else {
                    self.resolve(id: id, result: result)
                }
            } catch {
                self.reject(id: id, message: error.localizedDescription)
            }
        }
    }

    private func execute(method: String, params: [String: Any]) throws -> [String: Any] {
        switch method {
        case "status":
            return vault.status().dictionary
        case "setup":
            guard let json = params["json"] as? String else { throw SecureVault.VaultError.invalidInput("Thiếu dữ liệu khởi tạo.") }
            try vault.setup(password: params["password"] as? String ?? "", initialStateJSON: json)
            return ["ok": true]
        case "unlock":
            try vault.unlock(password: params["password"] as? String ?? "")
            return ["ok": true]
        case "lock":
            vault.lockVault()
            return ["ok": true]
        case "loadState":
            if let json = try vault.loadStateJSON() { return ["json": json] }
            return [:]
        case "saveState":
            guard let json = params["json"] as? String else { throw SecureVault.VaultError.invalidInput("Thiếu dữ liệu trạng thái.") }
            try vault.saveStateJSON(json)
            return ["ok": true]
        case "changePassword":
            try vault.changePassword(current: params["current"] as? String ?? "", next: params["next"] as? String ?? "")
            return ["ok": true]
        case "saveMedia":
            guard let id = params["id"] as? String,
                  let mime = params["mime"] as? String,
                  let base64 = params["base64"] as? String,
                  let data = Data(base64Encoded: base64) else { throw SecureVault.VaultError.invalidInput("Dữ liệu ảnh không hợp lệ.") }
            try vault.saveMedia(id: id, mime: mime, bytes: data)
            return ["ok": true]
        case "deleteMedia":
            guard let id = params["id"] as? String else { throw SecureVault.VaultError.invalidInput("ID ảnh không hợp lệ.") }
            try vault.deleteMedia(id: id)
            return ["ok": true]
        case "setBiometric":
            try vault.setBiometricEnabled(params["enabled"] as? Bool ?? false)
            return vault.status().dictionary
        case "unlockBiometric":
            try vault.unlockWithBiometrics()
            return ["ok": true]
        case "exportBackup":
            let url = try vault.exportBackup(password: params["password"] as? String ?? "")
            return ["path": url.path]
        default:
            throw SecureVault.VaultError.invalidInput("Native method không tồn tại.")
        }
    }

    func resolve(id: String, result: [String: Any] = [:]) {
        send(id: id, result: result, error: nil)
    }

    func reject(id: String, message: String) {
        send(id: id, result: nil, error: message)
    }

    private func send(id: String, result: [String: Any]?, error: String?) {
        var payload: [String: Any] = ["id": id]
        payload["result"] = result ?? NSNull()
        if let error { payload["error"] = error }
        guard JSONSerialization.isValidJSONObject(payload),
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript("window.NativeBridge&&window.NativeBridge._receive(\(json));", completionHandler: nil)
        }
    }
}
