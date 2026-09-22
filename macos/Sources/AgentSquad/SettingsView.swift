import SwiftUI
import ServiceManagement

struct SettingsView: View {
    @Environment(Gateway.self) private var gateway
    @State private var launchAtLogin = SMAppService.mainApp.status == .enabled
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                PageHeading(title: "Settings")
                Text("Connectors").font(.title2.weight(.semibold))
                ForEach(NativeSurfaces.all) { $0.settings() }
                connectionCard(title: "MCP", symbol: "network", subtitle: gateway.state == nil ? "Offline" : "Running on this Mac") {
                    if let state = gateway.state {
                        LabeledContent("MCP endpoint", value: state.endpoint).textSelection(.enabled)
                        Button("Copy Endpoint") { gateway.copy(state.endpoint) }
                        Text("Connect using Streamable HTTP with no authentication. Remote access is provided by the ChatGPT tunnel or a trusted private network such as Tailscale.").font(.caption).foregroundStyle(.secondary)
                    }
                    Toggle("Launch Agent Squad at login", isOn: $launchAtLogin)
                        .onChange(of: launchAtLogin) { _, enabled in
                            do { if enabled { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }; UserDefaults.standard.set(enabled, forKey: "launchAtLogin") }
                            catch { gateway.error = error.localizedDescription; launchAtLogin = SMAppService.mainApp.status == .enabled }
                        }
                    Button("Restart Gateway") { gateway.restart() }
                }
                ChatGPTConnectorView()
            }.padding(32)
        }.navigationTitle("")
    }
}
func openURL(_ text: String) { if let url = URL(string: text) { NSWorkspace.shared.open(url) } }
