import fs from "fs";
import {createHash} from 'node:crypto';
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath, pathToFileURL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function shouldBuildComputerUseHelper({ platform = process.platform } = {}) {
  return platform === "darwin";
}

export function swiftArchForNodeArch(arch = process.arch) {
  if (arch === "x64") return "x86_64";
  return arch;
}

export function resolveComputerUseHelperBuildArch({
  argv = process.argv,
  env = process.env,
  arch = process.arch,
} = {}) {
  const explicitArg = Array.isArray(argv) ? argv[2] : null;
  return explicitArg || env.HANA_COMPUTER_USE_HELPER_ARCH || arch;
}

export function computerUseHelperOutputDir({
  rootDir = path.resolve(__dirname, ".."),
  osName = "mac",
  arch = process.arch,
} = {}) {
  return path.join(rootDir, "dist-computer-use", `${osName}-${arch}`);
}

export function swiftBuildScratchPath({
  rootDir = path.resolve(__dirname, ".."),
  arch = process.arch,
} = {}) {
  return path.join(rootDir, ".cache", "computer-use-helper", "swift-build", `mac-${arch}`);
}

const CUA_APP_STATE_RELATIVE_PATH = path.join(
  "checkouts",
  "cua",
  "libs",
  "cua-driver",
  "Sources",
  "CuaDriverCore",
  "AppState",
  "AppState.swift",
);
const CUA_CLICK_TOOL_RELATIVE_PATH = path.join(
  "checkouts",
  "cua",
  "libs",
  "cua-driver",
  "Sources",
  "CuaDriverServer",
  "Tools",
  "ClickTool.swift",
);
const CUA_SCROLL_TOOL_RELATIVE_PATH = path.join('checkouts', 'cua', 'libs', 'cua-driver', 'Sources', 'CuaDriverServer', 'Tools', 'ScrollTool.swift');
const CUA_PRESS_KEY_RELATIVE_PATH = path.join('checkouts', 'cua', 'libs', 'cua-driver', 'Sources', 'CuaDriverServer', 'Tools', 'PressKeyTool.swift');
const CUA_FOCUS_ENFORCER_RELATIVE_PATH = path.join('checkouts', 'cua', 'libs', 'cua-driver', 'Sources', 'CuaDriverCore', 'Focus', 'SyntheticAppFocusEnforcer.swift');
const CUA_MOUSE_INPUT_RELATIVE_PATH = path.join('checkouts', 'cua', 'libs', 'cua-driver', 'Sources', 'CuaDriverCore', 'Input', 'MouseInput.swift');

export function patchCuaDriverMouseInputSource(source) {
  const marker = '// Enigma: background input must not promote itself to system HID.';
  if (source.includes(marker)) return source;
  const automaticForeground = /        let targetIsFrontmost =\n            NSRunningApplication\(processIdentifier: pid\)\?\.isActive \?\? false\n        if targetIsFrontmost \{[\s\S]*?\n            return\n        \}/g;
  const branches = [...source.matchAll(automaticForeground)];
  if (branches.length !== 2 || !branches[0][0].includes('clickFrontmostViaHIDTap') || !branches[1][0].includes('dragFrontmostViaHIDTap')) {
    throw new Error('[computer-use-helper] Cua automatic foreground input anchors changed');
  }
  return source.replace(automaticForeground, `        ${marker}\n        // Window focus is not permission to move the user's pointer.\n        // Explicit foreground input uses the separate host-approved helper.`);
}

const CUA_AX_PATCH_SENTINEL = "cuaDriverAXMessagingTimeoutSeconds";
const CUA_CLICK_PATCH_SENTINEL = '"show_default_ui": "AXShowDefaultUI"';

function replaceRequired(source, needle, replacement, label) {
  if (!source.includes(needle)) {
    throw new Error(`[computer-use-helper] Cua patch anchor not found: ${label}`);
  }
  return source.replace(needle, replacement);
}

export function patchCuaDriverAppStateSource(source) {
  if (source.includes(CUA_AX_PATCH_SENTINEL)) return source;
  let patched = source;

  patched = replaceRequired(
    patched,
    "extension AXObserver: @retroactive @unchecked Sendable {}\n\n/// No-op callback",
    `extension AXObserver: @retroactive @unchecked Sendable {}

private let cuaDriverAXMessagingTimeoutSeconds: Float = 0.35

@discardableResult
private func applyCuaDriverAXMessagingTimeout(_ element: AXUIElement) -> AXError {
    AXUIElementSetMessagingTimeout(element, cuaDriverAXMessagingTimeoutSeconds)
}

/// No-op callback`,
    "AX messaging timeout helpers",
  );

  patched = replaceRequired(
    patched,
    "    public static let maxDepth = 25\n",
    "    public static let maxDepth = 6\n    public static let maxActionableElements = 48\n",
    "bounded AX tree walk",
  );

  patched = replaceRequired(
    patched,
    `        let root = AXUIElementCreateApplication(pid)

        // Cue Chromium/Electron apps to turn on their web accessibility tree.
        // Non-Chromium apps ignore these attribute writes — safe no-op.
        try await activateAccessibilityIfNeeded(pid: pid, root: root)
`,
    `        let root = AXUIElementCreateApplication(pid)
        applyCuaDriverAXMessagingTimeout(root)

        // Cue Chromium/Electron apps to turn on their web accessibility tree.
        // Native AppKit apps can stall on the AXManualAccessibility writes, so
        // keep this Chromium-only instead of probing every app optimistically.
        try await activateAccessibilityIfNeeded(
            pid: pid,
            root: root,
            bundleId: running.bundleIdentifier
        )
`,
    "safe accessibility activation call",
  );

  patched = replaceRequired(
    patched,
    `    private func activateAccessibilityIfNeeded(
        pid: Int32,
        root: AXUIElement
    ) async throws {
        // Already did the one-shot pump + observer for this pid.
`,
    `    private func activateAccessibilityIfNeeded(
        pid: Int32,
        root: AXUIElement,
        bundleId: String?
    ) async throws {
        guard shouldAssertAccessibilityForAXClientSignals(
            pid: pid,
            bundleId: bundleId
        ) else { return }
        // Already did the one-shot pump + observer for this pid.
`,
    "Chromium-only accessibility activation signature",
  );

  patched = replaceRequired(
    patched,
    `        pumpRunLoopForActivation(duration: 0.5)
    }

    /// Pump the current thread's CFRunLoop for roughly \`duration\` seconds.
`,
    `        pumpRunLoopForActivation(duration: 0.5)
    }

    private nonisolated func shouldAssertAccessibilityForAXClientSignals(
        pid: Int32,
        bundleId: String?
    ) -> Bool {
        if ElectronJS.isElectron(pid: pid) { return true }
        switch bundleId {
        case "com.google.Chrome",
             "com.google.Chrome.canary",
             "com.microsoft.edgemac",
             "com.microsoft.edgemac.Canary",
             "com.brave.Browser",
             "com.operasoftware.Opera",
             "com.vivaldi.Vivaldi":
            return true
        default:
            return false
        }
    }

    /// Pump the current thread's CFRunLoop for roughly \`duration\` seconds.
`,
    "Chromium app detection helper",
  );

  patched = replaceRequired(
    patched,
    `    ) {
        guard depth <= AppStateEngine.maxDepth else { return }

        let role = attributeString(element, "AXRole") ?? "?"
`,
    `    ) {
        guard depth <= AppStateEngine.maxDepth else { return }
        guard nextIndex < AppStateEngine.maxActionableElements else { return }
        applyCuaDriverAXMessagingTimeout(element)

        let role = attributeString(element, "AXRole") ?? "?"
`,
    "renderTree guard",
  );

  patched = replaceRequired(
    patched,
    `        let enabled = attributeBool(element, "AXEnabled")
        let actions = actionNames(of: element)

        let indent = String(repeating: "  ", count: depth)
`,
    `        let enabled = attributeBool(element, "AXEnabled")
        let actions = actionNames(of: element)
        let descendantSummary =
            (role == "AXRow" && (title?.isEmpty ?? true) && (value?.isEmpty ?? true) && (description?.isEmpty ?? true))
            ? descendantLabelSummary(of: element)
            : nil

        let indent = String(repeating: "  ", count: depth)
`,
    "AXRow descendant summary",
  );

  patched = replaceRequired(
    patched,
    `        line += role
        if let t = title, !t.isEmpty { line += " \\"\\(t)\\"" }
        if let v = value, !v.isEmpty, v.count < 120 { line += " = \\"\\(v)\\"" }
`,
    `        line += role
        if let t = title, !t.isEmpty { line += " \\"\\(t)\\"" }
        else if let s = descendantSummary, !s.isEmpty { line += " \\"\\(s)\\"" }
        if let v = value, !v.isEmpty, v.count < 120 { line += " = \\"\\(v)\\"" }
`,
    "AXRow label rendering",
  );

  for (const [needle, replacement, label] of [
    [
      `    private func windows(of appRoot: AXUIElement) -> [AXUIElement] {
        var value: CFTypeRef?
`,
      `    private func windows(of appRoot: AXUIElement) -> [AXUIElement] {
        applyCuaDriverAXMessagingTimeout(appRoot)
        var value: CFTypeRef?
`,
      "AX timeout for windows",
    ],
    [
      `    private func isMenuOpen(_ menu: AXUIElement) -> Bool {
        var value: CFTypeRef?
`,
      `    private func isMenuOpen(_ menu: AXUIElement) -> Bool {
        applyCuaDriverAXMessagingTimeout(menu)
        var value: CFTypeRef?
`,
      "AX timeout for menu visibility",
    ],
    [
      `    private func attributeString(_ element: AXUIElement, _ attribute: String) -> String? {
        var value: CFTypeRef?
`,
      `    private func attributeString(_ element: AXUIElement, _ attribute: String) -> String? {
        applyCuaDriverAXMessagingTimeout(element)
        var value: CFTypeRef?
`,
      "AX timeout for string attributes",
    ],
    [
      `    private func attributeBool(_ element: AXUIElement, _ attribute: String) -> Bool? {
        var value: CFTypeRef?
`,
      `    private func attributeBool(_ element: AXUIElement, _ attribute: String) -> Bool? {
        applyCuaDriverAXMessagingTimeout(element)
        var value: CFTypeRef?
`,
      "AX timeout for boolean attributes",
    ],
    [
      `    private func actionNames(of element: AXUIElement) -> [String] {
        var names: CFArray?
`,
      `    private func actionNames(of element: AXUIElement) -> [String] {
        applyCuaDriverAXMessagingTimeout(element)
        var names: CFArray?
`,
      "AX timeout for action names",
    ],
    [
      `    private func children(of element: AXUIElement) -> [AXUIElement] {
        var value: CFTypeRef?
`,
      `    private func children(of element: AXUIElement) -> [AXUIElement] {
        applyCuaDriverAXMessagingTimeout(element)
        var value: CFTypeRef?
`,
      "AX timeout for children",
    ],
  ]) {
    patched = replaceRequired(patched, needle, replacement, label);
  }

  patched = replaceRequired(
    patched,
    `    /// Standard AX actions come through as simple strings like \`AXPress\`.
`,
    `    private func descendantLabelSummary(of element: AXUIElement) -> String? {
        var labels: [String] = []
        collectDescendantLabels(element, depth: 0, maxDepth: 2, labels: &labels)
        let joined = labels
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .prefix(4)
            .joined(separator: " ")
        return joined.isEmpty ? nil : joined
    }

    private func collectDescendantLabels(
        _ element: AXUIElement,
        depth: Int,
        maxDepth: Int,
        labels: inout [String]
    ) {
        if labels.count >= 4 || depth > maxDepth { return }
        let role = attributeString(element, "AXRole") ?? ""
        if role == "AXStaticText" || role == "AXButton" || role == "AXImage" {
            for attribute in ["AXTitle", "AXValue", "AXDescription"] {
                if let text = attributeString(element, attribute), !text.isEmpty {
                    labels.append(text)
                    if labels.count >= 4 { return }
                    break
                }
            }
        }
        if depth == maxDepth { return }
        for child in children(of: element) {
            collectDescendantLabels(child, depth: depth + 1, maxDepth: maxDepth, labels: &labels)
            if labels.count >= 4 { return }
        }
    }

    /// Standard AX actions come through as simple strings like \`AXPress\`.
`,
    "AXRow descendant label helpers",
  );

  return patched;
}

export function patchCuaDriverClickToolSource(source) {
  if (source.includes(CUA_CLICK_PATCH_SENTINEL)) return source;
  let patched = source;

  patched = replaceRequired(
    patched,
    `"enum": ["press", "show_menu", "pick", "confirm", "cancel", "open"],`,
    `"enum": ["press", "show_menu", "show_default_ui", "pick", "confirm", "cancel", "open"],`,
    "ClickTool action schema",
  );

  patched = replaceRequired(
    patched,
    `"show_menu": "AXShowMenu",
        "pick": "AXPick",`,
    `"show_menu": "AXShowMenu",
        "show_default_ui": "AXShowDefaultUI",
        "pick": "AXPick",`,
    "ClickTool AXShowDefaultUI action mapping",
  );

  patched = replaceRequired(
    patched,
    "Other values:\n                  `show_menu` (right-click equivalent), `pick` (open a",
    "Other values:\n                  `show_menu` (right-click equivalent), `show_default_ui`\n                  (select a row/list item via AXShowDefaultUI), `pick` (open a",
    "ClickTool action description",
  );

  return patched;
}

export function patchCuaDriverVisibleRowsSource(source) {
  if (source.includes('enigmaVisibleRowsResult')) return source;
  return replaceRequired(source,
    '        let result = AXUIElementCopyAttributeValue(element, "AXChildren" as CFString, &value)',
    `        let role = attributeString(element, "AXRole") ?? ""
        let enigmaVisibleRowsResult = (role == "AXTable" || role == "AXOutline")
            ? AXUIElementCopyAttributeValue(element, "AXVisibleRows" as CFString, &value)
            : AXError.attributeUnsupported
        let result = enigmaVisibleRowsResult == .success
            ? enigmaVisibleRowsResult
            : AXUIElementCopyAttributeValue(element, "AXChildren" as CFString, &value)`,
    'visible table rows before offscreen rows exhaust the AX budget');
}

export function patchCuaDriverScrollToolSource(source) {
  if (source.includes('enigmaScrollPageControl')) return source;
  const old = `                    let enigmaPageAction = ["up": "AXScrollUpByPage", "down": "AXScrollDownByPage", "left": "AXScrollLeftByPage", "right": "AXScrollRightByPage"][direction]
                    if let action = enigmaPageAction, AXInput.advertisedActionNames(of: element).contains(action) {
                        for _ in 0..<amount { try AXInput.performAction(action, on: element) }
                        return CallTool.Result(content: [.text(text: "Scrolled the observed region with its native page action. Verify the new visible content.", annotations: nil, _meta: nil)])
                    }
`;
  const next = `
                    let enigmaPageAction = ["up": "AXScrollUpByPage", "down": "AXScrollDownByPage", "left": "AXScrollLeftByPage", "right": "AXScrollRightByPage"][direction]
                    let orientation = (direction == "left" || direction == "right") ? "AXHorizontalOrientation" : "AXVerticalOrientation"
                    let bar = AXInput.children(of: element).first { AXInput.stringAttribute("AXRole", of: $0) == "AXScrollBar" && AXInput.stringAttribute("AXOrientation", of: $0) == orientation }
                    let pageRole = (direction == "down" || direction == "right") ? "AXIncrementPage" : "AXDecrementPage"
                    let enigmaScrollPageControl = bar.flatMap { AXInput.children(of: $0).first { AXInput.stringAttribute("AXSubrole", of: $0) == pageRole } }
                    if let action = enigmaPageAction, AXInput.advertisedActionNames(of: element).contains(action) || enigmaScrollPageControl != nil {
                        for _ in 0..<amount {
                            do { try AXInput.performAction(action, on: element) }
                            catch { guard let page = enigmaScrollPageControl else { throw error }; try AXInput.performAction("AXPress", on: page) }
                        }
                        return CallTool.Result(content: [.text(text: "Scrolled the observed region with its native page action. Verify the new visible content.", annotations: nil, _meta: nil)])
                    }
`;
  if (source.includes('enigmaPageAction')) return replaceRequired(source, old, next, 'native scrollbar fallback');
  return replaceRequired(source, '                if let element = focusedElement {\n', '                if let element = focusedElement {\n' + next, 'native scroll action before keyboard focus fallback');
}

export function applyCuaDriverSourcePatches({ scratchPath } = {}) {
  const appStatePath = path.join(scratchPath, CUA_APP_STATE_RELATIVE_PATH);
  if (!fs.existsSync(appStatePath)) {
    throw new Error(`[computer-use-helper] Cua AppState.swift not found at ${appStatePath}`);
  }
  const clickToolPath = path.join(scratchPath, CUA_CLICK_TOOL_RELATIVE_PATH);
  if (!fs.existsSync(clickToolPath)) {
    throw new Error(`[computer-use-helper] Cua ClickTool.swift not found at ${clickToolPath}`);
  }
  const scrollToolPath = path.join(scratchPath, CUA_SCROLL_TOOL_RELATIVE_PATH);
  if (!fs.existsSync(scrollToolPath)) throw new Error('Cua ScrollTool.swift is missing');

  let patchedAny = false;
  const mousePath = path.join(scratchPath, CUA_MOUSE_INPUT_RELATIVE_PATH);
  const mouseSource = fs.readFileSync(mousePath, 'utf8');
  const patchedMouse = patchCuaDriverMouseInputSource(mouseSource);
  if (patchedMouse !== mouseSource) {
    fs.chmodSync(mousePath, 0o644); fs.writeFileSync(mousePath, patchedMouse); patchedAny = true;
    console.log('[computer-use-helper] kept coordinate clicks and drags cursor-neutral regardless of window focus');
  }
  const focusPath = path.join(scratchPath, CUA_FOCUS_ENFORCER_RELATIVE_PATH);
  const focus = fs.readFileSync(focusPath, 'utf8');
  if (!focus.includes('// Enigma: redundant focus writes')) {
    const patched = replaceRequired(focus,
      '    private func writeBool(_ element: AXUIElement, _ attribute: String, _ value: Bool) {\n',
      '    private func writeBool(_ element: AXUIElement, _ attribute: String, _ value: Bool) {\n        // Enigma: redundant focus writes reset text selections in AppKit.\n        if readBool(element, attribute) == value { return }\n', 'preserve selection on unchanged focus');
    fs.chmodSync(focusPath,0o644);fs.writeFileSync(focusPath,patched);patchedAny=true;
  }
  const keyPath=path.join(scratchPath,CUA_PRESS_KEY_RELATIVE_PATH);
  const keySource=fs.readFileSync(keyPath,'utf8');
  if(!keySource.includes('// Enigma: preserve an already-focused selection')) {
    const patched=replaceRequired(keySource,
      '                        try? AXInput.setAttribute(\n                            "AXFocused",\n                            on: element,\n                            value: kCFBooleanTrue as CFTypeRef\n                        )',
      '                        // Enigma: preserve an already-focused selection.\n                        if AXInput.boolAttribute("AXFocused", of: element) != true {\n                            try? AXInput.setAttribute("AXFocused", on: element, value: kCFBooleanTrue as CFTypeRef)\n                        }', 'avoid key focus reset');
    fs.chmodSync(keyPath,0o644);fs.writeFileSync(keyPath,patched);patchedAny=true;
  }
  let selectionSource=fs.readFileSync(keyPath,'utf8');
  if(!selectionSource.includes('import ApplicationServices')) {
    selectionSource='import ApplicationServices\n'+selectionSource;
    fs.chmodSync(keyPath,0o644);fs.writeFileSync(keyPath,selectionSource);patchedAny=true;
  }
  if(!selectionSource.includes('// Enigma: native full-text selection')) {
    const insertion=fs.readFileSync(path.join(__dirname,'../desktop/native/HanaComputerUseHelper/Integration/SelectAll.swift.inc'),'utf8');
    selectionSource=replaceRequired(selectionSource,'                    // Focus the element, then post the key via the',insertion+'\n                    // Focus the element, then post the key via the','native text selection before keyboard fallback');
    fs.chmodSync(keyPath,0o644);fs.writeFileSync(keyPath,selectionSource);patchedAny=true;
  }
  const appStateSource = fs.readFileSync(appStatePath, "utf8");
  const patchedAppState = patchCuaDriverVisibleRowsSource(patchCuaDriverAppStateSource(appStateSource));
  if (patchedAppState !== appStateSource) {
    fs.chmodSync(appStatePath, 0o644);
    fs.writeFileSync(appStatePath, patchedAppState);
    console.log("[computer-use-helper] patched Cua AX tree walk for bounded background snapshots");
    patchedAny = true;
  }

  const clickToolSource = fs.readFileSync(clickToolPath, "utf8");
  const patchedClickTool = patchCuaDriverClickToolSource(clickToolSource);
  if (patchedClickTool !== clickToolSource) {
    fs.chmodSync(clickToolPath, 0o644);
    fs.writeFileSync(clickToolPath, patchedClickTool);
    console.log("[computer-use-helper] patched Cua ClickTool for AXShowDefaultUI row actions");
    patchedAny = true;
  }

  const cursorPath=path.join(scratchPath,'checkouts','cua','libs','cua-driver','Sources','CuaDriverCore','Cursor','AgentCursor.swift');
  let cursor=fs.readFileSync(cursorPath,'utf8');
  if(!cursor.includes('// Enigma: decorative pointer motion has a bounded latency')) {
    cursor=replaceRequired(cursor,'        await AgentCursorRenderer.shared.waitForArrival()',
      `        // Enigma: decorative pointer motion has a bounded latency.
        // The AppKit action is independent of this overlay. Finish its visual
        // position after a short glide instead of waiting for GPU spring arrival.
        try? await Task.sleep(nanoseconds: UInt64(max(0, min(duration, 0.18)) * 1_000_000_000))
        AgentCursorRenderer.shared.setInitialPosition(point)`, 'bounded cursor arrival');
    cursor=replaceRequired(cursor,'public func playClickPress(duration: CFTimeInterval = 0.65)', 'public func playClickPress(duration: CFTimeInterval = 0.09)', 'short visual press');
    fs.chmodSync(cursorPath,0o644);fs.writeFileSync(cursorPath,cursor);patchedAny=true;
  }
  if(!cursor.includes('EnigmaCursorFeedback.shared.click()')) {
    cursor=replaceRequired(cursor,
      '    public func playClickPress(duration: CFTimeInterval = 0.09) async {\n        guard isEnabled else { return }',
      '    public func playClickPress(duration: CFTimeInterval = 0.09) async {\n        guard isEnabled else { return }\n        EnigmaCursorFeedback.shared.click()', 'visible click feedback');
    cursor=replaceRequired(cursor,'    public func hide() {\n',
      '    public func hide() {\n        EnigmaCursorFeedback.shared.reset()\n', 'clear feedback on release');
    fs.chmodSync(cursorPath,0o644);fs.writeFileSync(cursorPath,cursor);patchedAny=true;
  }
  if(!cursor.includes('finishEnigmaMove')) {
    cursor=replaceRequired(cursor,'        animate(to: point)\n','        animate(to: point, duration: duration, options: options)\n', 'pass the actual glide duration');
    cursor=replaceRequired(cursor,
      '        try? await Task.sleep(nanoseconds: UInt64(max(0, min(duration, 0.18)) * 1_000_000_000))\n        AgentCursorRenderer.shared.setInitialPosition(point)',
      '        try? await Task.sleep(nanoseconds: UInt64(AgentCursorRenderer.shared.enigmaDuration * 1_000_000_000))\n        AgentCursorRenderer.shared.finishEnigmaMove()', 'finish interpolated pointer travel');
    cursor=replaceRequired(cursor,
      '        AgentCursorRenderer.shared.moveTo(point: point, endAngleDegrees: 45.0)',
      '        AgentCursorRenderer.shared.beginEnigmaMove(point: point, duration: duration ?? glideDurationSeconds)', 'bounded continuous pointer path');
    fs.chmodSync(cursorPath,0o644);fs.writeFileSync(cursorPath,cursor);patchedAny=true;
  }
  const rendererPath=path.join(path.dirname(cursorPath),'AgentCursorRenderer.swift');
  let renderer=fs.readFileSync(rendererPath,'utf8');
  const motion=fs.readFileSync(path.join(__dirname,'../desktop/native/HanaComputerUseHelper/Integration/CursorMotion.swift.inc'),'utf8');
  if(!renderer.includes('beginEnigmaMove')) {
    renderer='import AppKit\n'+renderer;
    renderer=replaceRequired(renderer,'    // -------- Internal state',motion+'\n    // -------- Internal state','continuous cursor motion state');
    renderer=replaceRequired(renderer,'    public func tick(now: CFTimeInterval) {\n','    public func tick(now: CFTimeInterval) {\n        if tickEnigmaMove(now: now) { return }\n','render the current travel position');
    renderer=replaceRequired(renderer,'        position = point\n','        enigmaMove = nil\n        position = point\n','direct positioning cancels prior travel');
    fs.chmodSync(rendererPath,0o644);fs.writeFileSync(rendererPath,renderer);patchedAny=true;
  } else {
    const start=renderer.indexOf('    // Enigma: time-based travel'),end=renderer.indexOf('    // -------- Internal state',start);
    if(start<0||end<start)throw new Error('Review the cursor motion integration markers');
    const next=renderer.slice(0,start)+motion+'\n'+renderer.slice(end);
    if(next!==renderer){fs.chmodSync(rendererPath,0o644);fs.writeFileSync(rendererPath,next);patchedAny=true;}
  }
  const viewPath=path.join(path.dirname(cursorPath),'AgentCursorView.swift');
  const currentView=fs.readFileSync(viewPath,'utf8');
  const viewSource=fs.readFileSync(path.join(__dirname,'../desktop/native/HanaComputerUseHelper/Integration/AgentCursorView.swift'),'utf8');
  if(currentView!==viewSource) {
    if(!currentView.startsWith('// Enigma presentation')&&createHash('sha256').update(currentView).digest('hex')!=='930426efcdf0a783207d882b7f6f65cd80ea314fb8d6431b343ee10b8bbaf5d4')throw new Error('Review the updated upstream cursor view before replacing its presentation');
    fs.chmodSync(viewPath,0o644);fs.writeFileSync(viewPath,viewSource);patchedAny=true;
  }

  const scrollSource = fs.readFileSync(scrollToolPath, 'utf8');
  const patchedScroll = patchCuaDriverScrollToolSource(scrollSource);
  if (patchedScroll !== scrollSource) {
    fs.chmodSync(scrollToolPath, 0o644);
    fs.writeFileSync(scrollToolPath, patchedScroll);
    console.log('[computer-use-helper] enabled advertised native scroll actions');
    patchedAny = true;
  }

  return patchedAny;
}

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: "inherit", ...options });
}

function read(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", ...options }).trim();
}

export function buildComputerUseHelper({
  rootDir = path.resolve(__dirname, ".."),
  platform = process.platform,
  env = process.env,
  arch = env.HANA_COMPUTER_USE_HELPER_ARCH || process.arch,
} = {}) {
  if (!shouldBuildComputerUseHelper({ platform })) {
    console.log(`[computer-use-helper] skipped on ${platform}`);
    return { skipped: true };
  }

  const packageDir = path.join(rootDir, "desktop", "native", "HanaComputerUseHelper");
  const swiftArch = swiftArchForNodeArch(arch);
  const scratchPath = swiftBuildScratchPath({ rootDir, arch });
  const baseArgs = [
    "--package-path",
    packageDir,
    "--scratch-path",
    scratchPath,
    "-c",
    "release",
    "--arch",
    swiftArch,
    "--product",
    "hana-computer-use-helper",
  ];

  console.log(`[computer-use-helper] building for ${swiftArch}`);
  run("swift", ["package", "resolve", "--package-path", packageDir, "--scratch-path", scratchPath], { cwd: rootDir, env });
  applyCuaDriverSourcePatches({ scratchPath });
  run("swift", ["build", ...baseArgs], { cwd: rootDir, env });

  const binPath = read("swift", ["build", "--show-bin-path", ...baseArgs], { cwd: rootDir, env });
  const source = path.join(binPath, "hana-computer-use-helper");
  if (!fs.existsSync(source)) {
    throw new Error(`[computer-use-helper] build did not produce ${source}`);
  }

  const outDir = computerUseHelperOutputDir({ rootDir, osName: "mac", arch });
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const target = path.join(outDir, "hana-computer-use-helper");
  fs.copyFileSync(source, target);
  fs.chmodSync(target, 0o755);
  for(const [dependency,license,name] of [['cua','LICENSE.md','cua-LICENSE.txt'],['swift-sdk','LICENSE','swift-mcp-sdk-LICENSE.txt']]) {
    fs.copyFileSync(path.join(scratchPath,'checkouts',dependency,license),path.join(outDir,name));
  }
  console.log(`[computer-use-helper] copied ${target}`);
  return { skipped: false, target };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    buildComputerUseHelper({ arch: resolveComputerUseHelperBuildArch() });
  } catch (err) {
    console.error(err?.stack || err?.message || String(err));
    process.exitCode = 1;
  }
}
