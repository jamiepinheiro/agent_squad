import SwiftUI

@MainActor let a2aSurfaceUI = NativeSurface(
    id: "a2a", name: "Agent-to-agent protocol", symbol: "network", usesQuietInterval: false,
    addAgents: { saving in AnyView(AgentEditor(agent: SquadAgent(adapterType: "a2a"), embedded: true, onBusyChange: { saving.wrappedValue = $0 })) },
    connection: { AnyView(A2AConnectionFields(agent: $0, credential: $1, validating: $2)) },
    prepareSave: { agent, credential, gateway in
        try await gateway.action("validateA2A", ["agent": try agent.jsonObject(), "credential": credential])
        if !credential.isEmpty { try Keychain.save(credential, account: "agent." + agent.id) }
    },
    isDisconnected: { agent, state in
        let latest = state.sessions.filter { $0.agentId == agent.id }.max { $0.updatedAt < $1.updatedAt }
        guard latest?.status == "failed", let error = latest?.error?.lowercased() else { return false }
        return ["fetch failed", "econnrefused", "enotfound", "network", "connection", "http 502", "http 503", "http 504"].contains { error.contains($0) }
    }
)
private struct A2AConnectionFields: View {
    @Environment(Gateway.self) private var gateway
    @Binding var agent: SquadAgent
    @Binding var credential: String
    @Binding var validating: Bool
    @State private var validation: String?
    @State private var error: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            TextField("A2A endpoint", text: $agent.endpoint, prompt: Text("https://agent.example.com/a2a"))
            SecureField("Bearer token (optional)", text: $credential)
            Button(validating ? "Checking…" : "Check Connection", action: checkConnection).disabled(validating || agent.endpoint.isEmpty)
            if let validation { Label(validation, systemImage: "checkmark.circle.fill").font(.caption).foregroundStyle(Color.squadGreen) }
            if let error { Text(error).font(.caption).foregroundStyle(.red) }
            Text("The Agent Card must advertise this endpoint with A2A 0.3 or 1.0 JSON-RPC support. Saving checks it automatically. No message is sent.").font(.caption).foregroundStyle(.secondary)
        }
        .onChange(of: agent.endpoint) { _, _ in validation = nil; error = nil }
        .onChange(of: credential) { _, _ in validation = nil; error = nil }
    }
    private func checkConnection() {
        validating = true; validation = nil; error = nil
        Task {
            defer { validating = false }
            do {
                let result = try await gateway.action("validateA2A", ["agent": try agent.jsonObject(), "credential": credential]) as? [String: Any]
                validation = "Verified: \(result?["name"] as? String ?? "A2A agent")"
            } catch { self.error = error.localizedDescription }
        }
    }
}
