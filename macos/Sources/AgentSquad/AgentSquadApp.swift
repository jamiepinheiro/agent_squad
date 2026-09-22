import SwiftUI
import AppKit
import ServiceManagement

@main enum Launcher {
    @MainActor static func main() {
        let arguments = Array(CommandLine.arguments.dropFirst())
        if let status = NativeSurfaces.handle(arguments) { exit(status) }
        if arguments.first == "--credential-read", arguments.count == 2 {
            do {
                let value = try Keychain.read(account: arguments[1])
                let data = try JSONSerialization.data(withJSONObject: ["value": value as Any? ?? NSNull()])
                FileHandle.standardOutput.write(data)
                exit(0)
            } catch { exit(1) }
        }
        if arguments.first == "--prepare-install" {
            let service = SMAppService.mainApp
            let enabled = service.status == .enabled || service.status == .requiresApproval
            if enabled {
                UserDefaults.standard.set(true, forKey: "launchAtLogin")
                do { try service.unregister() } catch {
                    FileHandle.standardError.write(Data("Could not migrate the existing login item: \(error.localizedDescription)\n".utf8))
                    exit(1)
                }
            }
            exit(0)
        }
        AgentSquadApp.main()
    }
}
final class AppDelegate: NSObject, NSApplicationDelegate {
    static var onTerminate: (() -> Void)?
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationWillTerminate(_ notification: Notification) { Self.onTerminate?() }
}
@MainActor struct AgentSquadApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @State private var gateway: Gateway
    init() {
        if UserDefaults.standard.object(forKey: "launchAtLogin") == nil,
           let legacy = UserDefaults.standard.persistentDomain(forName: "com.agentsquad.app")?["launchAtLogin"] as? Bool {
            UserDefaults.standard.set(legacy, forKey: "launchAtLogin")
        }
        let service = Gateway()
        _gateway = State(initialValue: service)
        AppDelegate.onTerminate = { service.stop() }
        service.start()
        if UserDefaults.standard.bool(forKey: "launchAtLogin") {
            do { try SMAppService.mainApp.register() }
            catch { service.error = "Could not restore launch at login: \(error.localizedDescription)" }
        }
    }
    var body: some Scene {
        WindowGroup("Agent Squad", id: "main") {
            ContentView().environment(gateway)
                .frame(minWidth: 900, minHeight: 640)
                .tint(.squadGreen)
        }
        .defaultSize(width: 1100, height: 760)
        .commands { CommandGroup(replacing: .newItem) {} }
        MenuBarExtra {
            SquadMenu().environment(gateway)
        } label: {
            Image(nsImage: SquadArtwork.menuIcon).accessibilityLabel("Agent Squad")
        }
    }
}
private struct SquadMenu: View {
    @Environment(Gateway.self) private var gateway
    @Environment(\.openWindow) private var openWindow
    var body: some View {
        Text("Agent Squad")
        Text(gateway.state == nil ? "Gateway offline" : "\(gateway.state!.agents.filter(\.enabled).count) agents available")
        Divider()
        Button("Open Agent Squad") { openWindow(id: "main"); NSApp.activate(ignoringOtherApps: true) }
        Button("Restart Gateway") { gateway.restart() }
        Divider()
        Button("Quit Agent Squad") { NSApp.terminate(nil) }.keyboardShortcut("q")
    }
}
extension Color {
    static let squadGreen = Color(nsColor: NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            ? NSColor(red: 0.49, green: 0.76, blue: 0.60, alpha: 1)
            : NSColor(red: 0.17, green: 0.40, blue: 0.30, alpha: 1)
    })
    static let squadMint = Color(nsColor: NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            ? NSColor(red: 0.17, green: 0.26, blue: 0.21, alpha: 1)
            : NSColor(red: 0.86, green: 0.94, blue: 0.87, alpha: 1)
    })
}
