import AppKit
import CoreGraphics
import CuaDriverCore
import Foundation

struct ForegroundDragRequest: Decodable {
    let pid: Int32
    let window_id: Int
    let from_x: Double
    let from_y: Double
    let to_x: Double
    let to_y: Double
    let screenshot_width: Double
    let screenshot_height: Double
    let duration_ms: Int
    let modifier: [String]?
}

private final class DragCancellation: @unchecked Sendable {
    private let lock = NSLock()
    private var value = false
    func cancel() { lock.lock(); value = true; lock.unlock() }
    var cancelled: Bool { lock.lock(); defer { lock.unlock() }; return value }
}

enum ForegroundDrag {
    private static func failure(_ message: String) -> NSError {
        NSError(domain: "EnigmaComputer", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }

    @MainActor
    static func run(_ request: ForegroundDragRequest) async throws {
        let values = [request.from_x, request.from_y, request.to_x, request.to_y, request.screenshot_width, request.screenshot_height]
        guard request.pid > 0, request.window_id > 0, values.allSatisfy({ $0.isFinite }),
              request.screenshot_width > 0, request.screenshot_height > 0,
              [request.from_x, request.to_x].allSatisfy({ $0 >= 0 && $0 < request.screenshot_width }),
              [request.from_y, request.to_y].allSatisfy({ $0 >= 0 && $0 < request.screenshot_height }),
              let target = WindowEnumerator.allWindows().first(where: { $0.id == request.window_id && $0.pid == request.pid && $0.isOnScreen }),
              let app = NSRunningApplication(processIdentifier: request.pid) else {
            throw failure("TARGET_NOT_FOUND: The observed drag window or coordinates are no longer available.")
        }
        let bounds = CGRect(x: target.bounds.x, y: target.bounds.y, width: target.bounds.width, height: target.bounds.height)
        let root = AXUIElementCreateApplication(request.pid)
        AXUIElementSetMessagingTimeout(root, 0.35)
        var rawWindows: CFTypeRef?
        guard AXUIElementCopyAttributeValue(root, kAXWindowsAttribute as CFString, &rawWindows) == .success,
              let windows = rawWindows as? [AXUIElement] else {
            throw failure("TARGET_NOT_FOUND: Cannot identify the observed window for foreground input.")
        }
        // Use public AX geometry and require a unique match. Never activate an
        // arbitrary window when the requested window cannot be identified.
        let matches = windows.filter { window in
            AXUIElementSetMessagingTimeout(window, 0.35)
            var position: CFTypeRef?, size: CFTypeRef?
            guard AXUIElementCopyAttributeValue(window, kAXPositionAttribute as CFString, &position) == .success,
                  AXUIElementCopyAttributeValue(window, kAXSizeAttribute as CFString, &size) == .success,
                  let position, let size, CFGetTypeID(position) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID() else { return false }
            var point = CGPoint.zero, extent = CGSize.zero
            AXValueGetValue(unsafeBitCast(position, to: AXValue.self), .cgPoint, &point)
            AXValueGetValue(unsafeBitCast(size, to: AXValue.self), .cgSize, &extent)
            return abs(point.x - bounds.minX) < 1 && abs(point.y - bounds.minY) < 1
                && abs(extent.width - bounds.width) < 1 && abs(extent.height - bounds.height) < 1
        }
        guard matches.count == 1 else { throw failure("TARGET_NOT_FOUND: Foreground window identity is ambiguous; obtain a fresh state.") }
        let cancellation = DragCancellation()
        signal(SIGTERM, SIG_IGN)
        let termination = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        termination.setEventHandler { cancellation.cancel() }
        termination.resume()
        defer { termination.cancel() }
        app.activate(options: [])
        guard AXUIElementPerformAction(matches[0], kAXRaiseAction as CFString) == .success else {
            throw failure("ACTION_REQUIRES_FOREGROUND: Cannot raise the observed window.")
        }
        try await Task.sleep(for: .milliseconds(150))
        func stillTarget() -> Bool {
            guard app.isActive, !cancellation.cancelled,
                  !CGEventSource.keyState(.combinedSessionState, key: 53),
                  let current = WindowEnumerator.visibleWindows().filter({ $0.pid == request.pid && $0.layer == 0 && $0.bounds.height > 40 }).max(by: { $0.zIndex < $1.zIndex }) else { return false }
            return current.id == request.window_id && current.bounds.x == bounds.minX && current.bounds.y == bounds.minY
                && current.bounds.width == bounds.width && current.bounds.height == bounds.height
        }
        guard stillTarget() else { throw failure("COMPUTER_OPERATION_CANCELLED: The target lost focus or the user took over before drag. No input was dispatched.") }
        func point(_ x: Double, _ y: Double) -> CGPoint {
            CGPoint(x: bounds.minX + x / request.screenshot_width * bounds.width, y: bounds.minY + y / request.screenshot_height * bounds.height)
        }
        let start = point(request.from_x, request.from_y), end = point(request.to_x, request.to_y)
        var flags = CGEventFlags()
        for key in request.modifier ?? [] {
            switch key.lowercased() {
            case "cmd", "command", "super": flags.insert(.maskCommand)
            case "shift": flags.insert(.maskShift)
            case "ctrl", "control": flags.insert(.maskControl)
            case "alt", "option": flags.insert(.maskAlternate)
            default: throw failure("CAPABILITY_UNSUPPORTED: Unknown drag modifier.")
            }
        }
        let source = CGEventSource(stateID: .hidSystemState)
        func post(_ type: CGEventType, _ location: CGPoint) throws {
            guard let event = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: location, mouseButton: .left) else {
                throw failure("PROVIDER_CRASHED: Cannot create drag input.")
            }
            event.flags = flags
            event.setIntegerValueField(.mouseEventClickState, value: 1)
            event.post(tap: .cghidEventTap)
        }
        var last = start
        try post(.mouseMoved, start)
        try await Task.sleep(for: .milliseconds(40))
        guard stillTarget() else { throw failure("COMPUTER_OPERATION_CANCELLED: Target changed before mouse down.") }
        try post(.leftMouseDown, start)
        fputs("ENIGMA_FOREGROUND_POINTER_DOWN\n", stderr)
        fflush(stderr)
        defer {
            try? post(.leftMouseUp, CGEvent(source: nil)?.location ?? last)
            // Let WindowServer consume the release before the helper exits.
            usleep(30_000)
            if !CGEventSource.buttonState(.combinedSessionState, button: .left) {
                fputs("ENIGMA_FOREGROUND_POINTER_UP\n", stderr)
                fflush(stderr)
            }
        }
        let steps = 30, duration = max(100, min(2000, request.duration_ms))
        for step in 1...steps {
            try await Task.sleep(for: .milliseconds(duration / steps))
            guard stillTarget() else { throw failure("COMPUTER_OPERATION_CANCELLED: Drag stopped after focus changed, Escape, or cancellation. Inspect before retrying.") }
            if let cursor = CGEvent(source: nil)?.location, hypot(cursor.x - last.x, cursor.y - last.y) > 18 {
                throw failure("COMPUTER_OPERATION_CANCELLED: Pointer diverged from the drag path (expected \(Int(last.x)),\(Int(last.y)); observed \(Int(cursor.x)),\(Int(cursor.y))). Drag released; inspect before retrying.")
            }
            let progress = Double(step) / Double(steps)
            last = CGPoint(x: start.x + (end.x - start.x) * progress, y: start.y + (end.y - start.y) * progress)
            try post(.leftMouseDragged, last)
        }
        try await Task.sleep(for: .milliseconds(80))
    }
}
