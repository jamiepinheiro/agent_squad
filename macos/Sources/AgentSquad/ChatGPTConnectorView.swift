import SwiftUI

struct ChatGPTConnectorView: View {
    @Environment(Gateway.self) private var gateway
    @State private var config = TunnelConfig()
    @State private var key = ""
    @State private var loaded = false
    @State private var busy = false
    @State private var note: String?
    private var connected: Bool { gateway.state?.tunnel.status == "connected" }
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack { Label("ChatGPT Tunnel", systemImage: "sparkles").font(.headline); Spacer(); StatusLabel(text: gateway.state?.tunnel.status.capitalized ?? "Disconnected", active: connected) }
            Text("Create a tunnel in your OpenAI Platform account, then save its ID and a runtime key with Tunnels Read + Use access. The key is stored in macOS Keychain.").foregroundStyle(.secondary)
            HStack { Button("Open Tunnel Settings") { openURL("https://platform.openai.com/settings/organization/tunnels") }; Button("Get a Runtime Key") { openURL("https://platform.openai.com/settings/organization/api-keys") } }
            Divider()
            TextField("Tunnel ID", text: $config.tunnelId, prompt: Text("tunnel_…")).textFieldStyle(.roundedBorder)
            SecureField("Runtime key — leave blank to keep the saved key", text: $key).textFieldStyle(.roundedBorder)
            HStack {
                TextField("Tunnel client executable", text: $config.executable).textFieldStyle(.roundedBorder)
                Button("Choose…") { chooseExecutable() }
            }
            Text("Use the installed tunnel-client executable. You can get it from OpenAI’s tunnel settings or the official release page.").font(.caption).foregroundStyle(.secondary)
            Toggle("Reconnect the tunnel when Agent Squad starts", isOn: $config.autoConnect)
            if let error = gateway.state?.tunnel.error { Text(error).font(.caption).foregroundStyle(.orange) }
            if let note { Text(note).font(.caption).foregroundStyle(Color.squadGreen) }
            HStack {
                Button(busy ? "Connecting…" : connected ? "Save & Restart Tunnel" : "Save & Connect") { connect() }.buttonStyle(.borderedProminent).disabled(busy || gateway.state == nil)
                if ["connected", "connecting"].contains(gateway.state?.tunnel.status ?? "") {
                    Button(connected ? "Disconnect" : "Cancel Connection") { gateway.perform("stopTunnel") }.disabled(gateway.state == nil || busy)
                }
                if let url = gateway.state?.tunnel.healthURL { Button("Open Diagnostics") { openURL(url + "/ui") } }
            }
            Divider()
            Text("Finish in ChatGPT").font(.headline)
            Text("In ChatGPT’s developer-mode app setup, choose Tunnel, select this tunnel, and use No authentication. Keep Agent Squad running while ChatGPT discovers and uses your agents.").foregroundStyle(.secondary)
            Button("Open ChatGPT") { openURL("https://chatgpt.com/#settings/Connectors") }
            Text("Account access and tunnel permissions are managed by OpenAI. A running tunnel is required for discovery and tool calls.").font(.caption).foregroundStyle(.secondary)
        }.padding(24).card()
        .task { load() }
        .onChange(of: gateway.state?.tunnelConfig?.tunnelId) { _, _ in load() }
    }
    private func load() { guard !loaded, let state = gateway.state else { return }; if let saved = state.tunnelConfig { config = saved }; loaded = true }
    private func chooseExecutable() {
        let panel = NSOpenPanel(); panel.canChooseDirectories = false; panel.allowsMultipleSelection = false; panel.message = "Choose the OpenAI tunnel-client executable."
        if panel.runModal() == .OK, let url = panel.url { config.executable = url.path }
    }
    private func connect() {
        busy = true; note = nil
        Task {
            defer { busy = false }
            do {
                if !key.isEmpty { try Keychain.save(key, account: "tunnel"); key = "" }
                try await gateway.action("saveTunnel", ["config": try config.jsonObject()])
                try await gateway.action("startTunnel"); note = "Tunnel started. Waiting for OpenAI readiness checks."
            } catch { gateway.error = error.localizedDescription }
        }
    }
}
