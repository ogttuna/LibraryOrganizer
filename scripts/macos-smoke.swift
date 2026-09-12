import AppKit
import CoreGraphics
import Foundation

// Window-server observation only; this does not assert UI workflows or PDF rendering.
guard CommandLine.arguments.count == 3, let pid = Int32(CommandLine.arguments[1]) else {
    fputs("Usage: macos-smoke PID REPORT\n", stderr)
    exit(2)
}
let destination = URL(fileURLWithPath: CommandLine.arguments[2])
let deadline = Date().addingTimeInterval(30)
while Date() < deadline {
    let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    if let window = windows.first(where: { info in
        guard let owner = info[kCGWindowOwnerPID as String] as? Int32,
              let bounds = info[kCGWindowBounds as String] as? [String: CGFloat]
        else { return false }
        return owner == pid && (bounds["Width"] ?? 0) >= 800 && (bounds["Height"] ?? 0) >= 500
    }) {
        let report: [String: Any] = [
            "processId": pid,
            "windowId": window[kCGWindowNumber as String] ?? 0,
            "visibleWindow": true,
            "bounds": window[kCGWindowBounds as String] ?? [:],
            "guiInteractionAcceptance": "pending",
            "pdfAcceptance": "pending",
        ]
        try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]).write(to: destination)
        print("Visible Folio window observed.")
        exit(0)
    }
    Thread.sleep(forTimeInterval: 0.2)
}
fputs("Folio did not create a visible window within 30 seconds.\n", stderr)
exit(1)
