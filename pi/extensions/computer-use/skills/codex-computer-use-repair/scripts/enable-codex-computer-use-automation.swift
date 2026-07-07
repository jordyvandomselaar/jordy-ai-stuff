import Foundation
import ApplicationServices
import AppKit

func attr(_ el: AXUIElement, _ name: String) -> CFTypeRef? {
    var out: CFTypeRef?
    let err = AXUIElementCopyAttributeValue(el, name as CFString, &out)
    return err == .success ? out : nil
}

func str(_ value: CFTypeRef?) -> String {
    guard let value else { return "" }
    let typeID = CFGetTypeID(value)
    if typeID == CFStringGetTypeID() { return value as! String }
    if typeID == CFNumberGetTypeID() {
        var n: Int = 0
        CFNumberGetValue((value as! CFNumber), .intType, &n)
        return String(n)
    }
    return String(describing: value)
}

func children(_ el: AXUIElement) -> [AXUIElement] {
    guard let v = attr(el, kAXChildrenAttribute) else { return [] }
    return (v as? [AXUIElement]) ?? []
}

func role(_ el: AXUIElement) -> String {
    str(attr(el, kAXRoleAttribute))
}

func titleOrValue(_ el: AXUIElement) -> String {
    let title = str(attr(el, kAXTitleAttribute))
    return title.isEmpty ? str(attr(el, kAXValueAttribute)) : title
}

func findSystemSettings() -> NSRunningApplication? {
    NSWorkspace.shared.runningApplications.first { app in
        app.localizedName == "System Settings" || app.bundleIdentifier == "com.apple.SystemSettings"
    }
}

func expandAll(_ el: AXUIElement) {
    if role(el) == "AXDisclosureTriangle", str(attr(el, kAXValueAttribute)) == "0" {
        let err = AXUIElementPerformAction(el, kAXPressAction as CFString)
        print("expanded disclosure triangle, err=\(err.rawValue)")
        usleep(50_000)
    }
    for child in children(el) { expandAll(child) }
}

func enableMatchingRows(_ el: AXUIElement) -> Int {
    var changed = 0

    if role(el) == "AXRow" {
        var hasCodexComputerUse = false
        var checkbox: AXUIElement?

        func scan(_ node: AXUIElement) {
            let nodeRole = role(node)
            if nodeRole == "AXStaticText", titleOrValue(node) == "Codex Computer Use" {
                hasCodexComputerUse = true
            }
            if nodeRole == "AXCheckBox" {
                checkbox = node
            }
            for child in children(node) { scan(child) }
        }

        scan(el)

        if hasCodexComputerUse, let checkbox {
            let value = str(attr(checkbox, kAXValueAttribute))
            if value == "0" {
                let err = AXUIElementPerformAction(checkbox, kAXPressAction as CFString)
                print("pressed disabled Codex Computer Use checkbox, err=\(err.rawValue)")
                changed += err == .success ? 1 : 0
                usleep(100_000)
            } else {
                print("Codex Computer Use checkbox already enabled")
            }
        }
    }

    for child in children(el) { changed += enableMatchingRows(child) }
    return changed
}

let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation")!
NSWorkspace.shared.open(url)
sleep(1)

guard let app = findSystemSettings() else {
    fputs("System Settings is not running after opening Automation pane\n", stderr)
    exit(1)
}

let root = AXUIElementCreateApplication(app.processIdentifier)

// Repeat because rows can materialize after disclosure expansion.
for _ in 0..<4 {
    expandAll(root)
}

let changed = enableMatchingRows(root)
print("changed=\(changed)")

if changed == 0 {
    print("No disabled Codex Computer Use checkboxes were changed. If Computer Use still hangs, search 'Codex' manually in Privacy & Security → Automation and verify every Codex Computer Use child switch is enabled.")
}
