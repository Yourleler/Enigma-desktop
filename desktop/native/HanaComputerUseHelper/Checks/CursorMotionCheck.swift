import AppKit
import CuaDriverCore

// Standalone verification also works with Command Line Tools, without XCTest.
@main struct CursorMotionCheck {
    @MainActor static func main() {
        let renderer = AgentCursorRenderer()
        if !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            renderer.setInitialPosition(CGPoint(x: 100, y: 100))
            renderer.beginEnigmaMove(point: CGPoint(x: 1000, y: 700), duration: 0.18)
            precondition(renderer.position == CGPoint(x: 100, y: 100), "Travel jumped to its destination")
            let start = Date.timeIntervalSinceReferenceDate
            renderer.tick(now: start + renderer.enigmaDuration * 0.25)
            let first = renderer.position
            precondition(first.x > 100 && first.x < 1000, "Missing intermediate position")
            renderer.tick(now: start + renderer.enigmaDuration * 0.6)
            precondition(renderer.position.x > first.x && renderer.position.x < 1000, "Travel must advance continuously")
            renderer.tick(now: start + renderer.enigmaDuration + 0.02)
            precondition(renderer.position == CGPoint(x: 1000, y: 700), "Travel did not arrive exactly")
            print("PASS continuous travel and exact arrival")

            renderer.beginEnigmaMove(point: CGPoint(x: 200, y: 200), duration: 0.18)
            renderer.tick(now: Date.timeIntervalSinceReferenceDate + renderer.enigmaDuration * 0.4)
            let visible = renderer.position
            renderer.beginEnigmaMove(point: CGPoint(x: 300, y: 400), duration: 0.18)
            precondition(renderer.position == visible, "Retargeting jumped away from the visible position")
            renderer.finishEnigmaMove()
            precondition(renderer.position == CGPoint(x: 300, y: 400))
            print("PASS smooth retargeting")
        } else {
            print("SKIP animated travel: system Reduce Motion is enabled")
        }
        renderer.beginEnigmaMove(point: CGPoint(x: 900, y: 700), duration: 0.18)
        renderer.setInitialPosition(CGPoint(x: 200, y: 200))
        renderer.tick(now: Date.timeIntervalSinceReferenceDate + 1)
        precondition(renderer.position == CGPoint(x: 200, y: 200), "Cancelled travel resurrected")
        renderer.beginEnigmaMove(point: CGPoint(x: 400, y: 300), duration: 0)
        precondition(renderer.position == CGPoint(x: 400, y: 300) && renderer.enigmaDuration == 0)
        print("PASS direct positioning and disabled animation")
    }
}
