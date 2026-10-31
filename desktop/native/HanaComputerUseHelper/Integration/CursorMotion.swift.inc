    // Enigma: time-based travel reaches its destination before dispatching the
    // click. This avoids cutting an unfinished spring path short at 180 ms.
    private var enigmaMove: (from: CGPoint, to: CGPoint, start: Double)?
    public private(set) var enigmaDuration: Double = 0

    public func beginEnigmaMove(point: CGPoint, duration: Double) {
        path = nil; trip = nil; spring = nil; springTarget = nil
        if position.x < -100 { position = CGEvent(source: nil)?.location ?? point }
        let distance = hypot(point.x - position.x, point.y - position.y)
        let scale = min(1.8, max(0.7, sqrt(distance / 300)))
        enigmaDuration = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion || duration <= 0
            ? 0 : min(0.32, max(0.09, duration * scale))
        enigmaMove = (position, point, Date.timeIntervalSinceReferenceDate)
        if enigmaDuration == 0 { finishEnigmaMove() }
    }

    public func finishEnigmaMove() {
        if let motion = enigmaMove { position = motion.to }
        enigmaMove = nil
        let continuation = arrivalContinuation
        arrivalContinuation = nil
        continuation?.resume()
    }

    private func tickEnigmaMove(now: Double) -> Bool {
        guard let motion = enigmaMove else { return false }
        let progress = min(1, max(0, (now - motion.start) / max(0.001, enigmaDuration)))
        let eased = 1 - pow(1 - progress, 3)
        position = CGPoint(x: motion.from.x + (motion.to.x - motion.from.x) * eased,
                           y: motion.from.y + (motion.to.y - motion.from.y) * eased)
        if progress >= 1 { finishEnigmaMove() }
        return true
    }
