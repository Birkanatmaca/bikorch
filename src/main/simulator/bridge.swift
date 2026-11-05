import AppKit
import ApplicationServices
import CoreImage
import Foundation
import ScreenCaptureKit

// Bikorch's helper for the iOS Simulator panel.
//
// Frames: ScreenCaptureKit streams only the Simulator window, and only when its
// pixels change, so a still screen costs almost nothing. Each frame is the whole
// window, which lets taps map straight onto window coordinates.
// Input: mouse and key events posted to the Simulator process (Accessibility).
//
// Protocol: JSON lines on stdin and stdout.

struct Incoming: Decodable {
    var op: String
    var x: Double?
    var y: Double?
    var text: String?
    var key: String?
    var name: String?
    var content: Bool?
    var fps: Int?
}

struct WindowBox {
    var pid: pid_t
    var id: CGWindowID
    var bounds: CGRect
    var name: String
    var area: CGFloat { bounds.width * bounds.height }
}

var preferredName = ""
var contentOnly = false
var pressed = false

let keyCodes: [String: CGKeyCode] = [
    "enter": 36,
    "backspace": 51,
    "escape": 53,
    "tab": 48,
    "space": 49,
    "arrowup": 126,
    "arrowdown": 125,
    "arrowleft": 123,
    "arrowright": 124
]

// One writer so frame lines never interleave with status lines.
let output = DispatchQueue(label: "bikorch.simulator.output")

func emit(_ object: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(object),
          let data = try? JSONSerialization.data(withJSONObject: object)
    else { return }
    output.async {
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0A]))
    }
}

func number(_ value: Any?) -> CGFloat? {
    if let number = value as? NSNumber { return CGFloat(number.doubleValue) }
    if let number = value as? Double { return CGFloat(number) }
    return nil
}

func simulatorWindows() -> [WindowBox] {
    let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let info = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
        return []
    }
    var windows: [WindowBox] = []
    for item in info {
        let owner = item[kCGWindowOwnerName as String] as? String ?? ""
        guard owner == "Simulator" else { continue }
        let layer = (item[kCGWindowLayer as String] as? NSNumber)?.intValue ?? 0
        guard layer == 0 else { continue }
        guard let box = item[kCGWindowBounds as String] as? [String: Any] else { continue }
        guard let x = number(box["X"]),
              let y = number(box["Y"]),
              let width = number(box["Width"]),
              let height = number(box["Height"]),
              width >= 80, height >= 80
        else { continue }
        let pid = pid_t((item[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value ?? 0)
        let id = CGWindowID((item[kCGWindowNumber as String] as? NSNumber)?.uint32Value ?? 0)
        let name = item[kCGWindowName as String] as? String ?? ""
        windows.append(WindowBox(pid: pid, id: id, bounds: CGRect(x: x, y: y, width: width, height: height), name: name))
    }
    return windows
}

func bestWindow() -> WindowBox? {
    let windows = simulatorWindows()
    if !preferredName.isEmpty {
        let needle = preferredName.lowercased()
        if let match = windows.first(where: { $0.name.lowercased().contains(needle) }) {
            return match
        }
    }
    return windows.max { $0.area < $1.area }
}

func quartzPoint(_ bounds: CGRect, _ nx: CGFloat, _ ny: CGFloat) -> CGPoint {
    let x = bounds.origin.x + bounds.width * min(max(nx, 0), 1)
    let yFromTop = bounds.origin.y + bounds.height * min(max(ny, 0), 1)
    // CGWindowList bounds and CGEvent locations both use global coordinates
    // with a top-left origin, so no flip is needed.
    return CGPoint(x: x, y: yFromTop)
}

/// Fallback mapping for simctl screenshots, which show the device screen only.
func contentBounds(_ window: WindowBox) -> CGRect {
    guard contentOnly else { return window.bounds }
    var bounds = window.bounds
    let title: CGFloat = 28
    let inset = min(12, bounds.width * 0.03)
    if bounds.height > title + 80 {
        bounds.origin.y += title
        bounds.size.height -= title
    }
    bounds.origin.x += inset
    bounds.size.width = max(1, bounds.size.width - inset * 2)
    bounds.size.height = max(1, bounds.size.height - inset)
    return bounds
}

// Simulator ignores mouse events posted straight to its process, so taps go
// through the HID event tap at the window's on-screen position. The real
// cursor is put back right after the touch ends.
var savedCursor: CGPoint?
var restoreApp: NSRunningApplication?
var touchToken = 0

func postMouse(_ type: CGEventType, _ point: CGPoint) {
    let source = CGEventSource(stateID: .hidSystemState)
    CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
}

/// True when the Simulator window is the first normal window under `point`.
func simulatorOnTop(at point: CGPoint, pid: pid_t) -> Bool {
    guard let info = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
        return false
    }
    for item in info {
        let layer = (item[kCGWindowLayer as String] as? NSNumber)?.intValue ?? 0
        let alpha = (item[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 1
        // System overlays (Dock, menu bar) sit above apps but let clicks through.
        guard layer == 0, alpha > 0.01,
              let box = item[kCGWindowBounds as String] as? [String: Any],
              let x = number(box["X"]), let y = number(box["Y"]),
              let width = number(box["Width"]), let height = number(box["Height"])
        else { continue }
        if CGRect(x: x, y: y, width: width, height: height).contains(point) {
            return pid_t((item[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value ?? 0) == pid
        }
    }
    return false
}

func onSomeDisplay(_ point: CGPoint) -> Bool {
    var count: UInt32 = 0
    CGGetDisplaysWithPoint(point, 0, nil, &count)
    return count > 0
}

func handlePointer(phase: String, x: Double, y: Double) {
    guard let window = bestWindow() else { return }
    let point = quartzPoint(contentBounds(window), CGFloat(x), CGFloat(y))
    switch phase {
    case "down":
        guard onSomeDisplay(point) else {
            emit(["op": "input-blocked", "reason": "offscreen"])
            return
        }
        if !simulatorOnTop(at: point, pid: window.pid) {
            // Another window covers this spot: bring Simulator forward first so
            // the click cannot land in some other app.
            restoreApp = NSWorkspace.shared.frontmostApplication
            NSRunningApplication(processIdentifier: window.pid)?.activate()
            usleep(150_000)
            guard simulatorOnTop(at: point, pid: window.pid) else {
                emit(["op": "input-blocked", "reason": "covered"])
                return
            }
        }
        touchToken += 1
        if savedCursor == nil { savedCursor = CGEvent(source: nil)?.location }
        pressed = true
        postMouse(.leftMouseDown, point)
    case "move":
        if pressed { postMouse(.leftMouseDragged, point) }
    case "up":
        guard pressed else { return }
        pressed = false
        postMouse(.leftMouseUp, point)
        let token = touchToken
        // Moving the cursor away at once turns a tap into a long press.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
            guard token == touchToken, !pressed else { return }
            if let cursor = savedCursor { CGWarpMouseCursorPosition(cursor) }
            savedCursor = nil
            restoreApp?.activate()
            restoreApp = nil
        }
    default:
        break
    }
}

func postKeyCode(_ code: CGKeyCode, _ pid: pid_t) {
    let source = CGEventSource(stateID: .hidSystemState)
    CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: true)?.postToPid(pid)
    CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false)?.postToPid(pid)
}

func postText(_ text: String, _ pid: pid_t) {
    let source = CGEventSource(stateID: .hidSystemState)
    let units = Array(text.utf16)
    guard let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true),
          let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false)
    else { return }
    units.withUnsafeBufferPointer { buffer in
        guard let base = buffer.baseAddress else { return }
        down.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: base)
        up.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: base)
    }
    down.postToPid(pid)
    up.postToPid(pid)
}

// MARK: - Window stream

final class WindowStreamer: NSObject, SCStreamOutput, SCStreamDelegate {
    private var stream: SCStream?
    private var windowID: CGWindowID = 0
    private var pending = 0
    private var fps = 30
    private let context = CIContext(options: [.useSoftwareRenderer: false])
    private let frames = DispatchQueue(label: "bikorch.simulator.frames")
    private var retry: Timer?

    func start(fps requested: Int) {
        fps = max(5, min(60, requested))
        stop(emitStopped: false)
        connect()
    }

    func stop(emitStopped: Bool = true) {
        retry?.invalidate()
        retry = nil
        let current = stream
        stream = nil
        windowID = 0
        current?.stopCapture { _ in }
        if emitStopped { emit(["op": "stream-stopped"]) }
    }

    /// Finds the Simulator window and starts streaming it; retries while it is not on screen yet.
    private func connect() {
        SCShareableContent.getExcludingDesktopWindows(true, onScreenWindowsOnly: true) { [weak self] content, error in
            DispatchQueue.main.async {
                guard let self else { return }
                if let error {
                    emit(["op": "stream-error", "message": error.localizedDescription])
                    return
                }
                let windows = (content?.windows ?? []).filter {
                    $0.owningApplication?.bundleIdentifier == "com.apple.iphonesimulator" &&
                        $0.windowLayer == 0 && $0.frame.width >= 80 && $0.frame.height >= 80
                }
                let needle = preferredName.lowercased()
                let window = windows.first(where: { !needle.isEmpty && ($0.title ?? "").lowercased().contains(needle) })
                    ?? windows.max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height })
                guard let window else {
                    self.scheduleRetry()
                    return
                }
                self.begin(window)
            }
        }
    }

    private func scheduleRetry() {
        retry?.invalidate()
        retry = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: false) { [weak self] _ in self?.connect() }
    }

    private func begin(_ window: SCWindow) {
        let filter = SCContentFilter(desktopIndependentWindow: window)
        let config = SCStreamConfiguration()
        // Retina detail, capped so a tall device stays near 1400 px high.
        let scale = min(2.0, 1400.0 / max(window.frame.height, 1))
        config.width = Int(window.frame.width * scale)
        config.height = Int(window.frame.height * scale)
        config.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
        config.showsCursor = false
        config.queueDepth = 3
        config.pixelFormat = kCVPixelFormatType_32BGRA
        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        do {
            try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: frames)
        } catch {
            emit(["op": "stream-error", "message": error.localizedDescription])
            return
        }
        self.stream = stream
        windowID = window.windowID
        stream.startCapture { error in
            if let error {
                emit(["op": "stream-error", "message": error.localizedDescription])
            } else {
                emit(["op": "streaming", "window": Int(window.windowID)])
            }
        }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, sampleBuffer.isValid else { return }
        // Only complete frames carry new pixels; idle ones mean nothing changed.
        guard let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let raw = attachments.first?[.status] as? Int,
              SCFrameStatus(rawValue: raw) == .complete,
              let pixels = CMSampleBufferGetImageBuffer(sampleBuffer)
        else { return }
        // Drop frames while the previous one is still being written.
        if pending > 1 { return }
        pending += 1
        let image = CIImage(cvPixelBuffer: pixels)
        guard let jpeg = context.jpegRepresentation(
            of: image,
            colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
            options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.72]
        ) else {
            pending -= 1
            return
        }
        let line: [String: Any] = ["op": "frame", "data": jpeg.base64EncodedString()]
        output.async { [weak self] in
            if let data = try? JSONSerialization.data(withJSONObject: line) {
                FileHandle.standardOutput.write(data)
                FileHandle.standardOutput.write(Data([0x0A]))
            }
            self?.frames.async { self?.pending -= 1 }
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        DispatchQueue.main.async {
            guard self.stream === stream else { return }
            self.stream = nil
            emit(["op": "stream-stopped", "message": error.localizedDescription])
            // The window closed or the device changed: look for it again.
            self.scheduleRetry()
        }
    }
}

let streamer = WindowStreamer()

func requestTrust() {
    let prompt = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
    let options = [prompt: true] as CFDictionary
    _ = AXIsProcessTrustedWithOptions(options)
}

func handle(_ command: Incoming) {
    switch command.op {
    case "focus":
        preferredName = command.name ?? ""
    case "mode":
        contentOnly = command.content ?? false
    case "stream":
        if let name = command.name { preferredName = name }
        streamer.start(fps: command.fps ?? 30)
    case "unstream":
        streamer.stop()
    case "down", "move", "up":
        handlePointer(phase: command.op, x: command.x ?? 0, y: command.y ?? 0)
    case "key":
        guard let window = bestWindow() else { return }
        if let name = command.key, let code = keyCodes[name] {
            postKeyCode(code, window.pid)
        } else if let text = command.text, !text.isEmpty {
            postText(String(text.prefix(8)), window.pid)
        }
    case "ping":
        emit(["op": "pong", "trusted": AXIsProcessTrusted()])
    default:
        break
    }
}

requestTrust()
emit(["op": "ready", "trusted": AXIsProcessTrusted()])

// stdin is read on its own thread; commands run on the main queue with the stream.
Thread.detachNewThread {
    while let line = readLine() {
        guard let data = line.data(using: .utf8),
              let command = try? JSONDecoder().decode(Incoming.self, from: data)
        else { continue }
        DispatchQueue.main.async { handle(command) }
    }
    DispatchQueue.main.async {
        streamer.stop(emitStopped: false)
        exit(0)
    }
}

dispatchMain()
