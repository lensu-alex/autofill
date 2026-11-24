// AutoFill for macOS: a window around autofill.html, plus a bridge that lets Pages, Numbers and
// Keynote convert their files (and old .xls/.ppt) to Office formats and back.
import AppKit
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate, WKNavigationDelegate, WKDownloadDelegate, WKScriptMessageHandlerWithReply {
    var window: NSWindow!
    var web: WKWebView!

    func applicationDidFinishLaunching(_ note: Notification) {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "native")
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        web = WKWebView(frame: .zero, configuration: config)
        web.uiDelegate = self
        web.navigationDelegate = self
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1320, height: 900),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "AutoFill"
        window.contentView = web
        window.center()
        window.setFrameAutosaveName("AutoFillMain")
        window.makeKeyAndOrderFront(nil)
        let res = Bundle.main.resourceURL!
        web.loadFileURL(res.appendingPathComponent("autofill.html"), allowingReadAccessTo: res)
        buildMenu()
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

    func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem(); main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Quit AutoFill", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        let editItem = NSMenuItem(); main.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit
        NSApp.mainMenu = main
    }

    // <input type="file">
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = false
        panel.beginSheetModal(for: window) { r in completionHandler(r == .OK ? panel.urls : nil) }
    }

    // prompt()
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let a = NSAlert(); a.messageText = prompt
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24)); field.stringValue = defaultText ?? ""
        a.accessoryView = field; a.addButton(withTitle: "OK"); a.addButton(withTitle: "Cancel")
        a.window.initialFirstResponder = field
        completionHandler(a.runModal() == .alertFirstButtonReturn ? field.stringValue : nil)
    }

    // <a download> → save panel
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if action.shouldPerformDownload || action.request.url?.scheme == "blob" { decisionHandler(.download); return }
        if let u = action.request.url, u.scheme == "http" || u.scheme == "https" { NSWorkspace.shared.open(u); decisionHandler(.cancel); return }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename
        panel.directoryURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
        panel.beginSheetModal(for: window) { r in
            guard r == .OK, let url = panel.url else { completionHandler(nil); return }
            if FileManager.default.fileExists(atPath: url.path) { try? FileManager.default.trashItem(at: url, resultingItemURL: nil) }
            completionHandler(url)
        }
    }

    // window.webkit.messageHandlers.native.postMessage({op: "convert", name, data (base64), to})
    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let op = body["op"] as? String else { replyHandler(nil, "bad message"); return }
        if op == "ping" { replyHandler(["ok": true], nil); return }
        guard op == "convert", let name = body["name"] as? String, let b64 = body["data"] as? String,
              let data = Data(base64Encoded: b64), let to = body["to"] as? String else { replyHandler(nil, "bad message"); return }
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let out = try Converter.convert(data: data, name: name, to: to)
                DispatchQueue.main.async { replyHandler(["data": out.base64EncodedString()], nil) }
            } catch {
                DispatchQueue.main.async { replyHandler(nil, error.localizedDescription) }
            }
        }
    }
}

enum Converter {
    struct Failure: LocalizedError { let errorDescription: String? }

    // Which Apple app opens/writes each format, and how to export
    static func plan(from ext: String, to: String) -> (app: String, export: String?)? {
        switch (ext, to) {
        case ("pages", "docx"), ("doc", "docx"): return ("Pages", "Microsoft Word")
        case ("numbers", "xlsx"), ("xls", "xlsx"): return ("Numbers", "Microsoft Excel")
        case ("key", "pptx"), ("ppt", "pptx"): return ("Keynote", "Microsoft PowerPoint")
        case ("docx", "pages"): return ("Pages", nil)
        case ("xlsx", "numbers"): return ("Numbers", nil)
        case ("pptx", "key"): return ("Keynote", nil)
        default: return nil
        }
    }

    static func convert(data: Data, name: String, to: String) throws -> Data {
        let ext = (name as NSString).pathExtension.lowercased()
        guard let p = plan(from: ext, to: to) else { throw Failure(errorDescription: "Can't convert .\(ext) to .\(to)") }
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("autofill-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let input = dir.appendingPathComponent("in." + ext)
        let output = dir.appendingPathComponent("out." + to)
        try data.write(to: input)
        let action = p.export.map { "export d to POSIX file \"\(output.path)\" as \($0)" } ?? "save d in POSIX file \"\(output.path)\""
        let script = """
        tell application "\(p.app)"
            set d to open POSIX file "\(input.path)"
            delay 0.5
            \(action)
            close d saving no
        end tell
        """
        var err: NSDictionary?
        guard let s = NSAppleScript(source: script) else { throw Failure(errorDescription: "AppleScript error") }
        s.executeAndReturnError(&err)
        if let e = err { throw Failure(errorDescription: "\(p.app): \(e[NSAppleScript.errorMessage] ?? e)") }
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: output.path, isDirectory: &isDir) else { throw Failure(errorDescription: "\(p.app) did not write the file") }
        if isDir.boolValue { // package folder: zip it so it travels as one file
            let zipped = dir.appendingPathComponent("out.zip")
            let task = Process()
            task.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
            task.arguments = ["-c", "-k", "--sequesterRsrc", output.path, zipped.path]
            try task.run(); task.waitUntilExit()
            return try Data(contentsOf: zipped)
        }
        return try Data(contentsOf: output)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
