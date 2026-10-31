# Native cursor presentation

`AgentCursorView.swift` is Enigma's presentation layer for the public
[Cua Driver](https://github.com/trycua/cua/tree/d38bfbfb6b1d4296903477f517b1a0fa54af497b/libs/cua-driver)
integration. The build replaces the pinned driver's cursor view with this
implementation and adds the click feedback hook to its existing cursor facade.
An unknown upstream view version stops the build for review.

The driver continues to own input dispatch, accessibility validation and window
ordering. Text and scroll results are shown in the actual controls and refreshed
snapshots. Click feedback means an action was dispatched; it is
not evidence that the task succeeded. The model receives a fresh target-window
snapshot for that verification.

The pointer uses rounded geometry, a small contrasting outline, and a brief
contact ripple. Movement interpolates continuously for 90–320ms according to
distance, then dispatches the click. Reduced Motion keeps the contact mark
without scaling or travel animation. The native window remains click-through. No feedback
animation changes file content or broadens application access.

The host patches the pinned driver's implicit frontmost-window HID routing.
Coordinate clicks and drags remain per-process input even when the target is
frontmost; visual pointer travel never grants permission to move the system
pointer. Surfaces that reject per-process events may need the separate explicit
foreground helper. The model-facing tool requires a visible, single-action
confirmation before using that helper; app access approval is insufficient.
Declined, unavailable, or cancelled confirmation dispatches no input. Existing
snapshot freshness and foreground cancellation checks remain in force.

Cua's MIT license is retained in the helper output alongside the Swift MCP SDK
license. This view is authored for Enigma; the surrounding Cua code retains its
upstream attribution and license.
