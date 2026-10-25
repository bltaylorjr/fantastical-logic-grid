import Foundation
import UniformTypeIdentifiers
import WebKit

/// Serves the web build bundled in the app (dist/web, as the "web" folder) at app://localhost/,
/// so the game has its own origin for saves (IndexedDB) and module workers.
final class AppSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "app"
    private let root = Bundle.main.resourceURL!.appendingPathComponent("web", isDirectory: true)

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return fail(task) }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        // Everything is on the device already, so the offline service worker is not needed.
        if path.contains("..") || path == "/sw.js" { return notFound(task, url) }
        let file = root.appendingPathComponent(String(path.dropFirst()))
        guard let data = try? Data(contentsOf: file, options: .mappedIfSafe) else { return notFound(task, url) }
        let mime = Self.mimeType(for: file)
        var headers = ["Content-Type": mime, "Cache-Control": "no-cache", "Accept-Ranges": "bytes"]

        // Video seeking asks for byte ranges.
        if let range = task.request.value(forHTTPHeaderField: "Range"), let (start, end) = Self.parse(range, length: data.count) {
            headers["Content-Range"] = "bytes \(start)-\(end)/\(data.count)"
            headers["Content-Length"] = String(end - start + 1)
            let response = HTTPURLResponse(url: url, statusCode: 206, httpVersion: "HTTP/1.1", headerFields: headers)!
            task.didReceive(response)
            task.didReceive(data.subdata(in: start..<(end + 1)))
            task.didFinish()
            return
        }
        headers["Content-Length"] = String(data.count)
        task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    private func notFound(_ task: WKURLSchemeTask, _ url: URL) {
        task.didReceive(HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: ["Content-Length": "0"])!)
        task.didFinish()
    }

    private func fail(_ task: WKURLSchemeTask) {
        task.didFailWithError(URLError(.badURL))
    }

    private static func parse(_ header: String, length: Int) -> (Int, Int)? {
        guard header.hasPrefix("bytes="), length > 0 else { return nil }
        let spec = header.dropFirst(6).split(separator: ",").first.map(String.init) ?? ""
        let parts = spec.split(separator: "-", omittingEmptySubsequences: false).map { String($0).trimmingCharacters(in: .whitespaces) }
        guard parts.count == 2 else { return nil }
        if parts[0].isEmpty, let suffix = Int(parts[1]) { return (max(0, length - suffix), length - 1) }
        guard let start = Int(parts[0]), start < length else { return nil }
        let end = Int(parts[1]).map { min($0, length - 1) } ?? length - 1
        return start <= end ? (start, end) : nil
    }

    private static func mimeType(for file: URL) -> String {
        switch file.pathExtension.lowercased() {
        case "html": return "text/html"
        case "js", "mjs": return "text/javascript"
        case "css": return "text/css"
        case "json": return "application/json"
        case "webmanifest": return "application/manifest+json"
        case "wasm": return "application/wasm"
        case "vtt": return "text/vtt"
        case "woff2": return "font/woff2"
        case "svg": return "image/svg+xml"
        default: return UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        }
    }
}
