import SwiftUI

@MainActor private let iMessageAccess = MessagesAccess()

@MainActor let iMessageSurfaceUI = NativeSurface(
    id: "imessage", name: "iMessage", symbol: "message.fill",
    addAgents: { AnyView(IMessageAgentsPicker(saving: $0)) },
    settings: { AnyView(IMessageConnectorView()) },
    connection: { agent, _, _ in AnyView(IMessageConnectionFields(agent: agent)) },
    refreshPhoto: refreshIMessagePhoto,
    refreshStatus: { iMessageAccess.check(); await iMessageAccess.checkSending() },
    isDisconnected: { _, _ in
        iMessageAccess.status == .permissionNeeded || iMessageAccess.status == .unavailable
            || iMessageAccess.sendingStatus == .permissionNeeded || iMessageAccess.sendingStatus == .unavailable
    },
    handle: { args in args.first?.hasPrefix("--messages-") == true ? MessagesHelper.run(args) : nil }
)
private struct IMessageConnectionFields: View {
    @Binding var agent: SquadAgent
    var body: some View {
        TextField("Phone number or Apple ID", text: $agent.recipient, prompt: Text("+15551234567"))
        Text("Use the exact international number or email in the existing iMessage conversation. Messages access is managed in Settings → Connectors.").font(.caption).foregroundStyle(.secondary)
    }
}
