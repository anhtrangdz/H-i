import Foundation
import WebKit

final class MediaSchemeHandler: NSObject, WKURLSchemeHandler {
    private let vault = SecureVault.shared
    private let queue = DispatchQueue(label: "com.prix.sorelax.media", qos: .userInitiated, attributes: .concurrent)

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url, url.scheme == "sorelax-media", url.host == "media" else {
            urlSchemeTask.didFailWithError(NSError(domain: "SoreRelaxMedia", code: 400))
            return
        }
        let id = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        queue.async { [vault] in
            do {
                let media = try vault.readMedia(id: id)
                let response = URLResponse(url: url, mimeType: media.mime, expectedContentLength: media.data.count, textEncodingName: nil)
                urlSchemeTask.didReceive(response)
                urlSchemeTask.didReceive(media.data)
                urlSchemeTask.didFinish()
            } catch {
                urlSchemeTask.didFailWithError(error)
            }
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}
