import AppKit
import ApplicationServices
import Foundation

struct Incoming: Decodable {
    var op: String
    var x: Double?
    var y: Double?
    var text: String?
    var key: String?
    var name: String?
    var content: Bool?
}

struct WindowBox {
    var pid: pid_t
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

func emit(_ object: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(object),
          let data = try? JSONSerialization.data(withJSONObject: object),
          let line = String(data: data, encoding: .utf8)
    else { return }
    print(line)
    fflush(stdout)
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
        let name = item[kCGWindowName as String] as? String ?? ""
        windows.append(WindowBox(pid: pid, bounds: CGRect(x: x, y: y, width: width, height: height), name: name))
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

func displayHeight() -> CGFloat {
    NSScreen.screens.reduce(CGFloat(0)) { partial, screen in
        max(partial, screen.frame.maxY)
    }
}

func quartzPoint(_ bounds: CGRect, _ nx: CGFloat, _ ny: CGFloat) -> CGPoint {
    let x = bounds.origin.x + bounds.width * min(max(nx, 0), 1)
    let yFromTop = bounds.origin.y + bounds.height * min(max(ny, 0), 1)
    return CGPoint(x: x, y: displayHeight() - yFromTop)
}

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

func postMouse(_ type: CGEventType, _ point: CGPoint, _ pid: pid_t) {
    let source = CGEventSource(stateID: .hidSystemState)
    guard let event = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: point, mouseButton: .left) else {
        return
    }
    event.postToPid(pid)
}

func handlePointer(phase: String, x: Double, y: Double) {
    guard let window = bestWindow() else { return }
    let point = quartzPoint(contentBounds(window), CGFloat(x), CGFloat(y))
    switch phase {
    case "down":
        pressed = true
        postMouse(.leftMouseDown, point, window.pid)
    case "move":
        if pressed { postMouse(.leftMouseDragged, point, window.pid) }
    case "up":
        if pressed { postMouse(.leftMouseUp, point, window.pid) }
        pressed = false
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

func requestTrust() {
    let prompt = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
    let options = [prompt: true] as CFDictionary
    _ = AXIsProcessTrustedWithOptions(options)
}

requestTrust()
emit(["op": "ready", "trusted": AXIsProcessTrusted()])

while let line = readLine() {
    guard let data = line.data(using: .utf8),
          let command = try? JSONDecoder().decode(Incoming.self, from: data)
    else { continue }
    switch command.op {
    case "focus":
        preferredName = command.name ?? ""
    case "mode":
        contentOnly = command.content ?? false
    case "down", "move", "up":
        handlePointer(phase: command.op, x: command.x ?? 0, y: command.y ?? 0)
    case "key":
        guard let window = bestWindow() else { continue }
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
