// Enigma presentation for the public Cua Driver cursor integration.
// The upstream input, window ordering and accessibility code remains in Cua Driver.
import AppKit
import Observation
import SwiftUI

@Observable @MainActor
public final class EnigmaCursorFeedback {
    public static let shared = EnigmaCursorFeedback()
    public enum Activity: Sendable { case pointer, dragging }
    public var activity: Activity = .pointer
    public var startedAt: TimeInterval = 0
    public var completedAt: TimeInterval = 0
    public var clickAt: TimeInterval = 0

    public func begin(_ next: Activity) {
        activity = next
        startedAt = Date.timeIntervalSinceReferenceDate
        completedAt = 0
    }
    public func click() {
        activity = .pointer
        clickAt = Date.timeIntervalSinceReferenceDate
        completedAt = clickAt
    }
    public func reset() {
        activity = .pointer
        startedAt = 0
        completedAt = 0
        clickAt = 0
    }
}

public struct AgentCursorView: View {
    @Bindable var renderer: AgentCursorRenderer
    @Bindable var feedback = EnigmaCursorFeedback.shared
    public init(renderer: AgentCursorRenderer = .shared) { self.renderer = renderer }

    public var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60.0)) { frame in
            Canvas { context, _ in
                let now = frame.date.timeIntervalSinceReferenceDate
                renderer.tick(now: now)
                draw(in: context, now: now,
                     reduced: NSWorkspace.shared.accessibilityDisplayShouldReduceMotion)
            }
            .ignoresSafeArea()
            .allowsHitTesting(false)
        }
    }

    private func draw(in context: GraphicsContext, now: TimeInterval, reduced: Bool) {
        let point = renderer.position
        guard point.x > -100 else { return }
        let sinceCompletion = feedback.completedAt > 0 ? now - feedback.completedAt : 0
        let active = feedback.completedAt == 0 || sinceCompletion < 0.55
        let activity = active ? feedback.activity : .pointer
        let tint = Color(nsColor: renderer.style.bloomColor)
        let fade = feedback.completedAt == 0 ? 0.65 : max(0, 1 - sinceCompletion / 0.65)
        if let rect = renderer.focusRect, fade > 0 {
            let outline = Path(roundedRect: rect.insetBy(dx: -2, dy: -2), cornerRadius: 6)
            context.fill(outline, with: .color(tint.opacity(0.035 * fade)))
            context.stroke(outline, with: .color(tint.opacity(0.7 * fade)), lineWidth: 1.4)
        }

        let elapsed = now - feedback.clickAt
        let clicking = feedback.clickAt > 0 && elapsed < 0.5
        if clicking {
            let progress = min(1, max(0, elapsed / 0.5))
            let radius = reduced ? 10 : 5 + 19 * progress
            let ring = Path(ellipseIn: CGRect(x: point.x - radius, y: point.y - radius,
                                             width: radius * 2, height: radius * 2))
            context.stroke(ring, with: .color(tint.opacity(0.65 * (1 - progress))), lineWidth: 1.7)
        }

        var ink = context
        ink.translateBy(x: point.x, y: point.y)
        ink.addFilter(.shadow(color: .black.opacity(0.28), radius: 2, x: 0, y: 1))
        if clicking && !reduced {
            let scale: Double = elapsed < 0.09 ? 1 - 0.2 * sin(elapsed / 0.09 * .pi / 2)
                : 1 - 0.2 * exp(-(elapsed - 0.09) * 18) * cos((elapsed - 0.09) * 24)
            ink.scaleBy(x: scale, y: scale)
        }
        // The tip remains anchored to the actual target. Rounded joins and a
        // restrained dual outline keep it legible on light and dark content.
        var arrow = Path()
        arrow.move(to: .zero)
        arrow.addQuadCurve(to: CGPoint(x: -0.4, y: 3), control: CGPoint(x: -1.5, y: -1))
        arrow.addLine(to: CGPoint(x: 5, y: 21))
        arrow.addQuadCurve(to: CGPoint(x: 8, y: 21), control: CGPoint(x: 6.3, y: 25))
        arrow.addLine(to: CGPoint(x: 11, y: 14))
        arrow.addQuadCurve(to: CGPoint(x: 13, y: 12), control: CGPoint(x: 11.4, y: 12.6))
        arrow.addLine(to: CGPoint(x: 20, y: 9))
        arrow.addQuadCurve(to: CGPoint(x: 20, y: 6), control: CGPoint(x: 24, y: 7.5))
        arrow.addLine(to: CGPoint(x: 3, y: 0.5))
        arrow.addQuadCurve(to: .zero, control: CGPoint(x: 1, y: -0.4))
        let colors = renderer.style.strokeGradientStops.map { Color(nsColor: $0.color) }
        ink.fill(arrow, with: .linearGradient(Gradient(colors: colors),
                 startPoint: .zero, endPoint: CGPoint(x: 18, y: 22)))
        ink.stroke(arrow, with: .color(.black.opacity(0.3)), style: StrokeStyle(lineWidth: 3.1, lineJoin: .round))
        ink.stroke(arrow, with: .color(.white.opacity(0.96)), style: StrokeStyle(lineWidth: 1.7, lineJoin: .round))

        if activity == .dragging {
            ink.stroke(Path(ellipseIn: CGRect(x: 18, y: 16, width: 7, height: 7)),
                       with: .color(tint), lineWidth: 2)
        }
    }
}
