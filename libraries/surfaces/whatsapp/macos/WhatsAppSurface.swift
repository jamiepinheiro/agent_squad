import SwiftUI

@MainActor let whatsAppSurfaceUI = NativeSurface(
    id: "whatsapp", name: "WhatsApp", symbol: "phone.bubble.fill",
    addAgents: { AnyView(WhatsAppAgentsPicker(saving: $0)) },
    settings: { AnyView(WhatsAppConnectorView()) },
    connection: { agent, _, _ in AnyView(WhatsAppConnectionFields(agent: agent)) },
    isDisconnected: { _, state in state.whatsapp.status != "connected" }
)
private struct WhatsAppConnectionFields: View {
    @Binding var agent: SquadAgent
    var body: some View {
        TextField("Phone number or conversation ID", text: $agent.recipient, prompt: Text("+15551234567"))
        Text("Pair WhatsApp in Settings → Connectors. You can select an agent from recent conversations when adding it.").font(.caption).foregroundStyle(.secondary)
    }
}
