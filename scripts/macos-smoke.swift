import AppKit
import CoreGraphics
import Foundation

// Ignore the title bar and shadow; a created white window is not a painted application.
if CommandLine.arguments.count == 3 && CommandLine.arguments[1] == "--check-content" {
    let path = URL(fileURLWithPath: CommandLine.arguments[2])
    guard let data = try? Data(contentsOf: path), let bitmap = NSBitmapImageRep(data: data) else {
        exit(2)
    }
    var contentPixels = 0
    for y in stride(from: bitmap.pixelsHigh / 5, to: bitmap.pixelsHigh * 4 / 5, by: 8) {
        for x in stride(from: bitmap.pixelsWide / 8, to: bitmap.pixelsWide * 7 / 8, by: 8) {
            guard let color = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) else { continue }
            let highest = max(color.redComponent, max(color.greenComponent, color.blueComponent))
            let lowest = min(color.redComponent, min(color.greenComponent, color.blueComponent))
            if color.alphaComponent > 0.9 && (highest < 0.75 || highest - lowest > 0.08) {
                contentPixels += 1
            }
        }
    }
    exit(contentPixels >= 20 ? 0 : 3)
}

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
