import AppKit
import SwiftUI
import Observation
import Darwin
import Carbon

/// Probe from the visible app, so macOS attributes privacy access to Agent Squad.
/// This opens and closes the database without reading any messages.
@MainActor @Observable final class MessagesAccess {
    enum Status { case unchecked, allowed, permissionNeeded, unavailable }
    var status: Status = .unchecked
    var readDetail = "Set up access to replies"
    var sendingStatus: Status = .unchecked
    var sendingDetail = "Messages control has not been checked"
    var requestingSending = false
    var ready: Bool { status == .allowed && sendingStatus == .allowed }
    var detail: String { ready ? "Messages access is enabled" : "\(readDetail). \(sendingDetail)" }

    nonisolated private static var messagesBundleID: String {
        Bundle(url: URL(fileURLWithPath: "/System/Applications/Messages.app"))?.bundleIdentifier
            ?? "com.apple.iChat"
    }

    // The permission API may wait for the user; always run it off the UI thread.
    nonisolated private static func sendingPermission(prompt: Bool) -> OSStatus {
        let target = NSAppleEventDescriptor(bundleIdentifier: messagesBundleID)
        return AEDeterminePermissionToAutomateTarget(target.aeDesc, typeWildCard, typeWildCard, prompt)
    }

    private func updateSending(_ result: OSStatus) {
        switch Int(result) {
        case Int(noErr):
            sendingStatus = .allowed
            sendingDetail = "Messages control is enabled"
        case errAEEventWouldRequireUserConsent:
            sendingStatus = .permissionNeeded
            sendingDetail = "Allow Messages control to send tasks"
        case errAEEventNotPermitted:
            sendingStatus = .permissionNeeded
            sendingDetail = "Enable Messages under Agent Squad in Automation settings"
        case procNotFound:
            sendingStatus = .unchecked
            sendingDetail = "Open Messages to check sending access"
        default:
            sendingStatus = .unavailable
            sendingDetail = "Could not check Messages control (\(result))"
        }
    }

    func checkSending() async {
        guard !requestingSending else { return }
        let result = await Task.detached { Self.sendingPermission(prompt: false) }.value
        guard !requestingSending else { return }
        updateSending(result)
    }

    func requestSending() async {
        guard !requestingSending else { return }
        requestingSending = true
        defer { requestingSending = false }
        do {
            // Apple requires the target app to be running for this permission check.
            if NSRunningApplication.runningApplications(withBundleIdentifier: Self.messagesBundleID).isEmpty {
                guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: Self.messagesBundleID) else {
                    sendingStatus = .unavailable
                    sendingDetail = "Messages is not installed on this Mac"
                    return
                }
                let configuration = NSWorkspace.OpenConfiguration()
                configuration.activates = false
                _ = try await NSWorkspace.shared.openApplication(at: url, configuration: configuration)
            }
            let result = await Task.detached { Self.sendingPermission(prompt: true) }.value
            updateSending(result)
        } catch {
            sendingStatus = .unavailable
            sendingDetail = "Could not open Messages: \(error.localizedDescription)"
        }
        check()
    }

    func check() {
        let path = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Messages/chat.db").path
        let descriptor = Darwin.open(path, O_RDONLY | O_CLOEXEC)
        if descriptor >= 0 {
            Darwin.close(descriptor)
            status = .allowed
            readDetail = "Reply access is enabled"
            return
        }
        let code = errno
        if code == EPERM || code == EACCES {
            status = .permissionNeeded
            readDetail = "Full Disk Access is needed to receive replies"
        } else {
            status = .unavailable
            readDetail = code == ENOENT ? "Open Messages and sign in on this Mac first" : "Messages is unavailable: \(String(cString: strerror(code)))"
        }
    }
}

struct MessagesSetupView: SwiftUI.View {
    @SwiftUI.Environment(\.dismiss) private var dismiss
    @SwiftUI.Environment(\.scenePhase) private var scenePhase
    @State private var showAccessResult = false
    var access: MessagesAccess

    var body: some SwiftUI.View {
        VStack(alignment: .leading, spacing: 20) {
            Label(access.ready ? "iMessage Access" : "Set Up iMessage", systemImage: "message.fill").font(.title2.bold())
            Text("Allow Agent Squad to send tasks and read replies from your registered conversations.").foregroundStyle(.secondary)
            Label(access.readDetail, systemImage: access.status == .allowed ? "checkmark.circle.fill" : "lock.shield")
                .foregroundStyle(access.status == .allowed ? Color.squadGreen : Color.secondary)
            Label(access.sendingDetail, systemImage: access.sendingStatus == .allowed ? "checkmark.circle.fill" : "lock.shield")
                .foregroundStyle(access.sendingStatus == .allowed ? Color.squadGreen : Color.secondary)
            if access.sendingStatus != .allowed {
                HStack {
                    Button(access.requestingSending ? "Requesting Access…" : "Allow Messages Control") {
                        Task { await access.requestSending() }
                    }.disabled(access.requestingSending)
                    Button("Open Automation Settings") { openURL("x-apple.systempreferences:com.apple.preference.security?Privacy_Automation") }
                }
            }
            if access.status == .allowed {
                Text("To revoke access to replies, open Full Disk Access and turn off Agent Squad. To revoke sending, open Automation and turn off Messages under Agent Squad.")
                if access.sendingStatus == .allowed {
                    Button("Open Automation Settings") { openURL("x-apple.systempreferences:com.apple.preference.security?Privacy_Automation") }
                }
            } else {
                Text("Open Full Disk Access, then drag this app into the list and turn on its switch. You can also add it with the + button.")
                HStack(spacing: 14) {
                    Image(nsImage: NSWorkspace.shared.icon(forFile: Bundle.main.bundlePath))
                        .resizable().frame(width: 48, height: 48)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Agent Squad").font(.headline)
                        Text("Drag into Full Disk Access").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Image(systemName: "hand.draw").foregroundStyle(.secondary)
                }
                .padding(16).card()
                .onDrag { NSItemProvider(object: Bundle.main.bundleURL as NSURL) }
            }
            Text("If macOS asks you to quit and reopen after a permission change, do so.")
                .font(.caption).foregroundStyle(.secondary)
            HStack {
                Button("Open Full Disk Access") {
                    openURL("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")
                }.buttonStyle(.borderedProminent)
                Button("Check Again") { Task { access.check(); await access.checkSending(); showAccessResult = true } }
                Spacer()
                Button("Done") { dismiss() }.keyboardShortcut(.defaultAction)
            }
        }
        .padding(28).frame(width: 510)
        .alert("Messages Access", isPresented: $showAccessResult) {
            Button("OK", role: .cancel) { }
        } message: { Text(access.detail) }
        .task { access.check(); await access.requestSending() }
        .onChange(of: scenePhase) { _, phase in if phase == .active { Task { access.check(); await access.checkSending() } } }
    }
}
