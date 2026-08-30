import UIKit
import WebKit
import UniformTypeIdentifiers

final class ViewController: UIViewController, UIDocumentPickerDelegate, WKNavigationDelegate {
    private(set) var webView: WKWebView!
    private let bridge = NativeBridge()
    private let mediaHandler = MediaSchemeHandler()
    private var privacyCover: UIVisualEffectView?
    private var pendingRestore: (requestID: String, password: String)?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemGroupedBackground

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.userContentController.add(bridge, name: "sorelax")
        config.setURLSchemeHandler(mediaHandler, forURLScheme: "sorelax-media")

        webView = WKWebView(frame: .zero, configuration: config)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.navigationDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.allowsLinkPreview = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.keyboardDismissMode = .interactive
        if #available(iOS 16.4, *) { webView.isInspectable = false }

        bridge.webView = webView
        bridge.viewController = self

        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        guard let indexURL = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Web") else {
            assertionFailure("Missing Web/index.html")
            return
        }
        webView.loadFileURL(indexURL, allowingReadAccessTo: indexURL.deletingLastPathComponent())

        NotificationCenter.default.addObserver(self, selector: #selector(showPrivacyCover), name: UIApplication.willResignActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(hidePrivacyCover), name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "sorelax")
    }

    @objc private func showPrivacyCover() {
        guard privacyCover == nil else { return }
        let cover = UIVisualEffectView(effect: UIBlurEffect(style: .systemMaterial))
        cover.frame = view.bounds
        cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        let label = UILabel()
        label.text = "Sổ Relax"
        label.font = .systemFont(ofSize: 18, weight: .semibold)
        label.textColor = .secondaryLabel
        label.translatesAutoresizingMaskIntoConstraints = false
        cover.contentView.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: cover.contentView.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: cover.contentView.centerYAnchor)
        ])
        view.addSubview(cover)
        privacyCover = cover
    }

    @objc private func hidePrivacyCover() {
        privacyCover?.removeFromSuperview()
        privacyCover = nil
        webView?.evaluateJavaScript("window.dispatchEvent(new Event('sorelax-resume'));", completionHandler: nil)
    }

    func presentShareSheet(fileURL: URL) {
        let sheet = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
        sheet.completionWithItemsHandler = { _, _, _, _ in try? FileManager.default.removeItem(at: fileURL) }
        if let popover = sheet.popoverPresentationController {
            popover.sourceView = view
            popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.maxY - 40, width: 1, height: 1)
        }
        present(sheet, animated: true)
    }

    func presentRestorePicker(requestID: String, password: String) {
        guard pendingRestore == nil else {
            bridge.reject(id: requestID, message: "Đang có một phiên khôi phục khác.")
            return
        }
        pendingRestore = (requestID, password)
        let type = UTType(filenameExtension: "sobackup") ?? .data
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [type, .data], asCopy: true)
        picker.delegate = self
        picker.allowsMultipleSelection = false
        present(picker, animated: true)
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        guard let pending = pendingRestore else { return }
        pendingRestore = nil
        bridge.reject(id: pending.requestID, message: "Đã hủy chọn bản sao.")
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let pending = pendingRestore else { return }
        guard let url = urls.first else {
            pendingRestore = nil
            bridge.reject(id: pending.requestID, message: "Không nhận được file bản sao.")
            return
        }
        pendingRestore = nil
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            do {
                try SecureVault.shared.restoreBackup(from: url, password: pending.password)
                self?.bridge.resolve(id: pending.requestID, result: ["ok": true])
            } catch {
                self?.bridge.reject(id: pending.requestID, message: error.localizedDescription)
            }
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.isFileURL || url.scheme == "sorelax-media" || url.scheme == "about" {
            decisionHandler(.allow)
        } else {
            decisionHandler(.cancel)
        }
    }
}
