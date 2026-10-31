                    // Enigma: native full-text selection avoids a lost Command
                    // modifier in background AppKit fields. Unsupported fields
                    // keep the original keyboard route and its validation.
                    if key.lowercased() == "a", modifiers.count == 1,
                       ["cmd", "command"].contains(modifiers[0].lowercased()),
                       let role = AXInput.stringAttribute("AXRole", of: element),
                       ["AXTextField", "AXTextArea"].contains(role),
                       let value = AXInput.stringAttribute("AXValue", of: element) {
                        var settable = DarwinBoolean(false)
                        if AXUIElementIsAttributeSettable(element, "AXSelectedTextRange" as CFString, &settable) == .success, settable.boolValue {
                            var full = CFRange(location: 0, length: value.utf16.count)
                            if let range = AXValueCreate(.cfRange, &full),
                               AXUIElementSetAttributeValue(element, "AXSelectedTextRange" as CFString, range) == .success {
                                var selected: CFTypeRef?
                                if AXUIElementCopyAttributeValue(element, "AXSelectedTextRange" as CFString, &selected) == .success,
                                   let selected, CFGetTypeID(selected) == AXValueGetTypeID() {
                                    var observed = CFRange()
                                    if AXValueGetValue(unsafeBitCast(selected, to: AXValue.self), .cfRange, &observed),
                                       observed.location == 0, observed.length == full.length {
                                        return CallTool.Result(content: [.text(text: "Selected all text in the observed field using native accessibility.", annotations: nil, _meta: nil)])
                                    }
                                }
                            }
                        }
                    }
