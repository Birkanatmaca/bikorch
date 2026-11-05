import CoreImage
import Foundation
import IOSurface
import ObjectiveC

// Bikorch's headless helper for the iOS Simulator panel.
//
// The device runs without Simulator.app: frames come straight from the device's
// framebuffer (an IOSurface shared by CoreSimulator) and touches and keys go in
// through SimulatorKit's HID client. Nothing shows up on the Mac, the cursor is
// never moved, and no Accessibility or Screen Recording permission is needed.
//
// These are Xcode's private frameworks. When any piece is missing the helper
// reports `headless-error` and Bikorch falls back to the Simulator window.
//
// Protocol: JSON lines on stdin and stdout.

struct Incoming: Decodable {
    var op: String
    var udid: String?
    var x: Double?
    var y: Double?
    var text: String?
    var key: String?
    var fps: Int?
    var button: String?
}

let output = DispatchQueue(label: "bikorch.simulator.output")

func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object) else { return }
    output.async {
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0A]))
    }
}

struct HeadlessFailure: Error {
    let message: String
}

// MARK: - Private frameworks

func developerDir() -> String {
    if let path = ProcessInfo.processInfo.environment["DEVELOPER_DIR"], !path.isEmpty { return path }
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/xcode-select")
    process.arguments = ["-p"]
    let pipe = Pipe()
    process.standardOutput = pipe
    try? process.run()
    process.waitUntilExit()
    let text = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
        .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return text.isEmpty ? "/Applications/Xcode.app/Contents/Developer" : text
}

let developer = developerDir()
var simulatorKit: UnsafeMutableRawPointer?

func loadFrameworks() throws {
    let coreSimulator = [
        "/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator",
        "\(developer)/Library/PrivateFrameworks/CoreSimulator.framework/CoreSimulator"
    ]
    guard coreSimulator.contains(where: { dlopen($0, RTLD_NOW) != nil }) else {
        throw HeadlessFailure(message: "CoreSimulator is not available")
    }
    simulatorKit = dlopen("\(developer)/Library/PrivateFrameworks/SimulatorKit.framework/SimulatorKit", RTLD_NOW)
    guard simulatorKit != nil else { throw HeadlessFailure(message: "SimulatorKit is not available") }
}

func call(_ target: NSObjectProtocol, _ selector: String, _ argument: Any? = nil, _ second: Any? = nil) -> NSObject? {
    let sel = NSSelectorFromString(selector)
    guard target.responds(to: sel) else { return nil }
    return target.perform(sel, with: argument, with: second)?.takeUnretainedValue() as? NSObject
}

func findDevice(_ udid: String) throws -> NSObject {
    guard let contextClass = NSClassFromString("SimServiceContext") as? NSObject.Type,
          let context = call((contextClass as AnyObject) as! NSObjectProtocol, "sharedServiceContextForDeveloperDir:error:", developer, nil),
          let set = call(context, "defaultDeviceSetWithError:", nil),
          let devices = set.value(forKey: "devices") as? [NSObject]
    else { throw HeadlessFailure(message: "Could not read the simulator device set") }
    guard let device = devices.first(where: { ($0.value(forKey: "UDID") as? NSUUID)?.uuidString == udid }) else {
        throw HeadlessFailure(message: "Simulator \(udid) was not found")
    }
    return device
}

/// The main display: the IOSurface-backed port with the largest framebuffer.
func mainDisplay(of device: NSObject) -> NSObject? {
    guard let io = device.value(forKey: "io") as? NSObject,
          let ports = io.value(forKey: "ioPorts") as? [NSObject],
          let renderable = objc_getProtocol("SimDisplayIOSurfaceRenderable")
    else { return nil }
    var best: (NSObject, Int)?
    for port in ports {
        guard let descriptor = call(port, "descriptor"), descriptor.conforms(to: renderable) else { continue }
        guard let surface = framebuffer(of: descriptor) else { continue }
        let area = surface.width * surface.height
        if best == nil || area > best!.1 { best = (descriptor, area) }
    }
    return best?.0
}

func framebuffer(of display: NSObject) -> IOSurface? {
    guard let object = call(display, "framebufferSurface") else { return nil }
    return unsafeBitCast(object, to: IOSurface.self)
}

// MARK: - Input

typealias MouseMessage = @convention(c) (
    UnsafeMutablePointer<CGPoint>, UnsafeMutablePointer<CGPoint>?, UInt32, UInt, CGFloat, CGFloat, UInt32
) -> UnsafeMutableRawPointer?
typealias KeyboardMessage = @convention(c) (UInt32, UInt32) -> UnsafeMutableRawPointer?
typealias ButtonMessage = @convention(c) (UInt32, UInt32, UInt32) -> UnsafeMutableRawPointer?
typealias ClientInit = @convention(c) (AnyObject, Selector, AnyObject, UnsafeMutablePointer<NSError?>?) -> AnyObject?
typealias ClientSend = @convention(c) (
    AnyObject, Selector, UnsafeMutableRawPointer, Bool, DispatchQueue?, (@convention(block) (NSError?) -> Void)?
) -> Void

/// NSEventType values the Indigo mouse helper understands.
enum Touch: UInt {
    case down = 1
    case up = 2
    case drag = 6
}

final class HIDInput {
    private let client: AnyObject
    private let sendImp: ClientSend
    private let sendSel = NSSelectorFromString("sendWithMessage:freeWhenDone:completionQueue:completion:")
    private let mouse: MouseMessage
    private let keyboard: KeyboardMessage?
    private let buttonMessage: ButtonMessage?
    private var touchStartY = 0.0
    private let queue = DispatchQueue(label: "bikorch.simulator.hid")
    private var pressed = false

    init(device: NSObject) throws {
        guard let kit = simulatorKit,
              let mouseSymbol = dlsym(kit, "IndigoHIDMessageForMouseNSEvent"),
              let type = NSClassFromString("SimulatorKit.SimDeviceLegacyHIDClient") as? NSObject.Type
        else { throw HeadlessFailure(message: "SimulatorKit input is not available") }
        mouse = unsafeBitCast(mouseSymbol, to: MouseMessage.self)
        keyboard = dlsym(kit, "IndigoHIDMessageForKeyboardArbitrary").map { unsafeBitCast($0, to: KeyboardMessage.self) }
        buttonMessage = dlsym(kit, "IndigoHIDMessageForButton").map { unsafeBitCast($0, to: ButtonMessage.self) }
        let initSel = NSSelectorFromString("initWithDevice:error:")
        guard type.instancesRespond(to: initSel), type.instancesRespond(to: sendSel),
              let allocated = type.perform(NSSelectorFromString("alloc"))?.takeUnretainedValue()
        else { throw HeadlessFailure(message: "SimulatorKit input has changed") }
        let initImp = unsafeBitCast(class_getMethodImplementation(type, initSel), to: ClientInit.self)
        var error: NSError?
        guard let client = initImp(allocated, initSel, device, &error) else {
            throw HeadlessFailure(message: error?.localizedDescription ?? "Could not connect to the simulator input")
        }
        self.client = client
        sendImp = unsafeBitCast(class_getMethodImplementation(type, sendSel), to: ClientSend.self)
    }

    private func send(_ message: UnsafeMutableRawPointer) {
        // The client frees the message once it is delivered.
        sendImp(client, sendSel, message, true, queue, nil)
    }

    func pointer(_ phase: String, x: Double, y: Double) {
        var point = CGPoint(x: min(max(x, 0), 1), y: min(max(y, 0), 1))
        let touch: Touch
        switch phase {
        case "down":
            pressed = true
            touchStartY = point.y
            touch = .down
        case "move":
            guard pressed else { return }
            touch = .drag
        case "up":
            guard pressed else { return }
            pressed = false
            touch = .up
        default:
            return
        }
        // 0x32 is the touch digitizer of the main screen.
        if let message = mouse(&point, nil, 0x32, touch.rawValue, 1, 1, 0) { send(message) }
        // The home-indicator swipe is an edge gesture the digitizer cannot start,
        // so a swipe up from the bottom edge presses Home instead.
        if touch == .up, touchStartY > 0.955, point.y < touchStartY - 0.06 {
            press(button: "home")
        }
    }

    /// Hardware buttons: Home (source 0) and Lock (source 1) on the hardware target.
    func press(button: String) {
        guard let buttonMessage else { return }
        let source: UInt32 = button == "lock" ? 1 : 0
        if let message = buttonMessage(source, 1, 0x33) { send(message) }
        queue.asyncAfter(deadline: .now() + 0.06) { [self] in
            if let message = buttonMessage(source, 2, 0x33) { send(message) }
        }
    }

    /// Presses and releases one HID usage, with optional modifier usages held around it.
    func press(_ usage: UInt32, modifiers: [UInt32] = []) {
        guard let keyboard else { return }
        for modifier in modifiers { if let message = keyboard(modifier, 1) { send(message) } }
        if let message = keyboard(usage, 1) { send(message) }
        if let message = keyboard(usage, 2) { send(message) }
        for modifier in modifiers.reversed() { if let message = keyboard(modifier, 2) { send(message) } }
    }
}

// HID keyboard usages. Text is sent as key presses on the device's hardware
// layout; only characters that layout cannot type go through the pasteboard.
let shiftUsage: UInt32 = 0xE1
let commandUsage: UInt32 = 0xE3
let optionUsage: UInt32 = 0xE6
let namedKeys: [String: UInt32] = [
    "enter": 0x28, "escape": 0x29, "backspace": 0x2A, "tab": 0x2B, "space": 0x2C,
    "arrowright": 0x4F, "arrowleft": 0x50, "arrowdown": 0x51, "arrowup": 0x52
]

struct Stroke {
    var usage: UInt32
    var modifiers: [UInt32] = []
}

func letterAndDigitStrokes(skipping skipped: Set<Character> = []) -> [Character: Stroke] {
    var map: [Character: Stroke] = [" ": Stroke(usage: 0x2C), "0": Stroke(usage: 0x27)]
    for (index, letter) in "abcdefghijklmnopqrstuvwxyz".enumerated() where !skipped.contains(letter) {
        map[letter] = Stroke(usage: UInt32(0x04 + index))
        map[Character(letter.uppercased())] = Stroke(usage: UInt32(0x04 + index), modifiers: [shiftUsage])
    }
    for (index, digit) in "123456789".enumerated() { map[digit] = Stroke(usage: UInt32(0x1E + index)) }
    return map
}

func usLayout() -> [Character: Stroke] {
    var map = letterAndDigitStrokes()
    let plain: [Character: UInt32] = ["-": 0x2D, "=": 0x2E, "[": 0x2F, "]": 0x30, "\\": 0x31, ";": 0x33,
                                      "'": 0x34, "`": 0x35, ",": 0x36, ".": 0x37, "/": 0x38]
    let shifted: [Character: UInt32] = ["_": 0x2D, "+": 0x2E, "{": 0x2F, "}": 0x30, "|": 0x31, ":": 0x33,
                                        "\"": 0x34, "~": 0x35, "<": 0x36, ">": 0x37, "?": 0x38]
    for (character, usage) in plain { map[character] = Stroke(usage: usage) }
    for (character, usage) in shifted { map[character] = Stroke(usage: usage, modifiers: [shiftUsage]) }
    for (index, symbol) in "!@#$%^&*()".enumerated() { map[symbol] = Stroke(usage: UInt32(0x1E + index), modifiers: [shiftUsage]) }
    return map
}

/// Apple's Turkish Q layout, keyed by the US key position that produces each character.
func turkishQLayout() -> [Character: Stroke] {
    var map = letterAndDigitStrokes(skipping: ["i"])
    let plain: [Character: UInt32] = ["ı": 0x0C, "i": 0x34, "ğ": 0x2F, "ü": 0x30, "ş": 0x33, "ö": 0x36, "ç": 0x37,
                                      ".": 0x38, ",": 0x31, "*": 0x2D, "-": 0x2E, "\"": 0x64, "<": 0x35]
    let shifted: [Character: UInt32] = ["I": 0x0C, "İ": 0x34, "Ğ": 0x2F, "Ü": 0x30, "Ş": 0x33, "Ö": 0x36, "Ç": 0x37,
                                        ":": 0x38, ";": 0x31, "?": 0x2D, "_": 0x2E, ">": 0x35, "é": 0x64]
    for (character, usage) in plain { map[character] = Stroke(usage: usage) }
    for (character, usage) in shifted { map[character] = Stroke(usage: usage, modifiers: [shiftUsage]) }
    for (index, symbol) in "!'^+%&/()=".enumerated() {
        map[symbol] = Stroke(usage: UInt32(0x1E + index), modifiers: [shiftUsage])
    }
    let option: [Character: UInt32] = ["@": 0x14, "#": 0x20, "$": 0x21, "{": 0x24, "[": 0x25, "]": 0x26, "}": 0x27]
    for (character, usage) in option { map[character] = Stroke(usage: usage, modifiers: [optionUsage]) }
    return map
}

var keyMap: [Character: Stroke] = usLayout()

func detectKeyboardLayout(udid: String) {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
    process.arguments = ["simctl", "spawn", udid, "defaults", "read", "-g", "AppleKeyboards"]
    let pipe = Pipe()
    process.standardOutput = pipe
    process.standardError = FileHandle.nullDevice
    guard (try? process.run()) != nil else { return }
    process.waitUntilExit()
    let text = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    // First entry, e.g. "tr_TR@sw=Turkish-Q;hw=Automatic": hw wins unless Automatic.
    guard let first = text.split(separator: "\n").first(where: { $0.contains("@") }) else { return }
    var software = "", hardware = ""
    for part in first.split(whereSeparator: { $0 == "@" || $0 == ";" || $0 == "\"" }) {
        if part.hasPrefix("sw=") { software = String(part.dropFirst(3)) }
        if part.hasPrefix("hw=") { hardware = String(part.dropFirst(3)) }
    }
    let layout = hardware.isEmpty || hardware == "Automatic" ? software : hardware
    if layout == "Turkish-Q" {
        keyMap = turkishQLayout()
    } else if layout != "QWERTY" && layout != "U.S." && layout != "US" {
        // Unknown layout: keep only keys that rarely move (letters can, on AZERTY).
        keyMap = keyMap.filter { $0.key.isNumber || $0.key == " " }
    }
}

/// Keys and pastes run one after another so fast typing keeps its order.
let typing = DispatchQueue(label: "bikorch.simulator.typing")

func pasteText(_ text: String, udid: String, input: HIDInput) {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
    process.arguments = ["simctl", "pbcopy", udid]
    let pipe = Pipe()
    process.standardInput = pipe
    guard (try? process.run()) != nil else { return }
    pipe.fileHandleForWriting.write(Data(text.utf8))
    try? pipe.fileHandleForWriting.close()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else { return }
    input.press(0x19, modifiers: [commandUsage])
    // Give the paste a moment before the next key lands.
    usleep(60_000)
}

func typeText(_ text: String, udid: String, input: HIDInput) {
    typing.async {
        var pending = ""
        let flush = {
            if !pending.isEmpty { pasteText(pending, udid: udid, input: input) }
            pending = ""
        }
        for character in text {
            guard let stroke = keyMap[character] else {
                pending.append(character)
                continue
            }
            flush()
            input.press(stroke.usage, modifiers: stroke.modifiers)
        }
        flush()
    }
}

// MARK: - Frames

/// Watches the framebuffer's seed and sends a JPEG only when the pixels changed,
/// so a still screen costs a cheap integer read per tick.
final class FramePump {
    private let display: NSObject
    private var surface: IOSurface?
    private var lastSeed: UInt32 = .max
    private var lastSurfaceCheck = Date.distantPast
    private var timer: DispatchSourceTimer?
    private var pending = false
    private let frames = DispatchQueue(label: "bikorch.simulator.frames")
    private let context = CIContext(options: [.useSoftwareRenderer: false, .cacheIntermediates: false])
    private let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!

    init(display: NSObject) {
        self.display = display
    }

    func start(fps: Int) {
        stop()
        let interval = 1.0 / Double(max(5, min(60, fps)))
        let timer = DispatchSource.makeTimerSource(queue: frames)
        timer.schedule(deadline: .now(), repeating: interval, leeway: .milliseconds(4))
        timer.setEventHandler { [weak self] in self?.tick() }
        self.timer = timer
        timer.resume()
        emit(["op": "streaming"])
    }

    func stop() {
        timer?.cancel()
        timer = nil
        lastSeed = .max
    }

    private func tick() {
        // The device can swap its framebuffer (rotation, resolution), so look again now and then.
        if surface == nil || Date().timeIntervalSince(lastSurfaceCheck) > 2 {
            lastSurfaceCheck = Date()
            if let next = framebuffer(of: display), next != surface {
                surface = next
                lastSeed = .max
            }
        }
        guard let surface, !pending else { return }
        let seed = surface.seed
        guard seed != lastSeed else { return }
        lastSeed = seed
        pending = true
        defer { pending = false }
        var image = CIImage(ioSurface: surface)
        // Sharp enough for a side panel, light enough to keep the Mac cool.
        let scale = min(1.0, 1400.0 / max(image.extent.height, 1))
        if scale < 1 { image = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale)) }
        guard let jpeg = context.jpegRepresentation(
            of: image,
            colorSpace: colorSpace,
            options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.72]
        ) else { return }
        emit(["op": "frame", "data": jpeg.base64EncodedString()])
    }
}

// MARK: - Session

var udid = ""
var input: HIDInput?
var pump: FramePump?

func attach(_ target: String, fps: Int) {
    do {
        try loadFrameworks()
        let device = try findDevice(target)
        var display: NSObject?
        // Right after boot the display port can take a moment to appear.
        for _ in 0..<40 {
            display = mainDisplay(of: device)
            if display != nil { break }
            usleep(250_000)
        }
        guard let display else { throw HeadlessFailure(message: "The simulator display is not available") }
        let hid = try HIDInput(device: device)
        udid = target
        input = hid
        pump?.stop()
        let next = FramePump(display: display)
        pump = next
        next.start(fps: fps)
        emit(["op": "ready", "trusted": true, "headless": true])
        typing.async { detectKeyboardLayout(udid: target) }
    } catch let failure as HeadlessFailure {
        emit(["op": "headless-error", "message": failure.message])
    } catch {
        emit(["op": "headless-error", "message": error.localizedDescription])
    }
}

func handle(_ command: Incoming) {
    switch command.op {
    case "attach":
        if let target = command.udid { attach(target, fps: command.fps ?? 30) }
    case "down", "move", "up":
        input?.pointer(command.op, x: command.x ?? 0, y: command.y ?? 0)
    case "key":
        guard let input else { return }
        if let name = command.key, let usage = namedKeys[name] {
            typing.async { input.press(usage) }
        } else if let text = command.text, !text.isEmpty {
            typeText(String(text.prefix(64)), udid: udid, input: input)
        }
    case "button":
        if let button = command.button { input?.press(button: button) }
    case "ping":
        emit(["op": "pong", "trusted": true])
    default:
        break
    }
}

// stdin is read on its own thread; commands run on the main queue.
Thread.detachNewThread {
    while let line = readLine() {
        guard let data = line.data(using: .utf8),
              let command = try? JSONDecoder().decode(Incoming.self, from: data)
        else { continue }
        DispatchQueue.main.async { handle(command) }
    }
    DispatchQueue.main.async {
        pump?.stop()
        exit(0)
    }
}

dispatchMain()
