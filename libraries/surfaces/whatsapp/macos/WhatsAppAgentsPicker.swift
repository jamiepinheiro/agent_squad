import SwiftUI

private struct WhatsAppConversation: Decodable, Identifiable {
    let id: String
    let name: String
    let recipient: String
    let timestamp: Double
}

struct WhatsAppAgentsPicker: View {
    @Environment(Gateway.self) private var gateway
    @Environment(\.dismiss) private var dismiss
    @State private var chats: [WhatsAppConversation] = []
    @State private var selected: Set<String> = []
    @State private var query = ""
    @State private var loading = true
    @State private var requestedSync = false
    @Binding var saving: Bool
    @State private var error: String?
    @State private var agentIDs: [String: String] = [:]

    private var connected: Bool { gateway.state?.whatsapp.status == "connected" }
    private var visible: [WhatsAppConversation] {
        chats.filter { query.isEmpty || $0.name.localizedStandardContains(query) || $0.recipient.localizedStandardContains(query) }
    }
    private func added(_ chat: WhatsAppConversation) -> Bool {
        gateway.state?.agents.contains { $0.adapterType == "whatsapp" && ($0.recipient == chat.recipient || $0.recipient == chat.id) } ?? false
    }
    private var chosen: [WhatsAppConversation] { chats.filter { selected.contains($0.id) && !added($0) && !$0.recipient.isEmpty } }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if !connected {
                VStack(spacing: 12) {
                    Text("Connect WhatsApp to load recent conversations.").foregroundStyle(.secondary)
                    Button("Connect WhatsApp") { gateway.perform("connectWhatsApp") }
                        .disabled(gateway.state?.whatsapp.status != "disconnected")
                    Text("Link your phone in Settings → Connectors → WhatsApp.").font(.caption).foregroundStyle(.secondary)
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if loading && chats.isEmpty {
                ProgressView("Loading conversations…").frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                HStack {
                    TextField("Search recent conversations", text: $query).textFieldStyle(.roundedBorder)
                    Button { gateway.perform("refreshWhatsAppChats") } label: { Image(systemName: "arrow.clockwise") }.help("Sync conversations from WhatsApp").disabled(gateway.state?.whatsapp.chatSyncStatus == "syncing")
                }
                if visible.isEmpty {
                    Text(chats.isEmpty ? "No conversations have synced yet. Keep WhatsApp open on your phone, then refresh." : "No matching conversations.")
                        .foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 0) {
                            ForEach(visible) { chat in
                                VStack(alignment: .leading, spacing: 6) {
                                    HStack {
                                        Toggle(chat.name, isOn: Binding(get: { selected.contains(chat.id) || added(chat) }, set: { checked in
                                            if checked { selected.insert(chat.id) } else { selected.remove(chat.id) }
                                        })).toggleStyle(.checkbox).disabled(added(chat) || chat.recipient.isEmpty)
                                        Spacer()
                                        if added(chat) { Text("Already added").font(.caption).foregroundStyle(Color.squadGreen) }
                                    }
                                    Text(chat.recipient.hasSuffix("@bot") ? "WhatsApp AI agent" : chat.recipient.hasSuffix("@lid") ? "WhatsApp ID: \(chat.recipient.replacingOccurrences(of: "@lid", with: ""))" : chat.recipient)
                                        .font(.caption).foregroundStyle(.secondary).padding(.leading, 22)
                                }.padding(.vertical, 12)
                                Divider()
                            }
                        }
                    }.frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            if gateway.state?.whatsapp.chatSyncStatus == "syncing" { ProgressView("Syncing conversations…").controlSize(.small) }
            if let syncError = gateway.state?.whatsapp.chatSyncError { Text(syncError).font(.caption).foregroundStyle(.orange) }
            if let error { Text(error).font(.caption).foregroundStyle(.red) }
            Divider()
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
                Button(saving ? "Adding…" : chosen.isEmpty ? "Add Selected" : "Add \(chosen.count) \(chosen.count == 1 ? "Agent" : "Agents")") { addSelected() }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(chosen.isEmpty || !connected)
            }
        }
        .disabled(saving).interactiveDismissDisabled(saving)
        .task {
            while !Task.isCancelled {
                if connected && !requestedSync { requestedSync = true; gateway.perform("refreshWhatsAppChats") }
                if !saving { await reload() }
                do { try await Task.sleep(for: .seconds(3)) } catch { break }
            }
        }
    }

    private func reload() async {
        defer { loading = false }
        do {
            let result = try await gateway.action("whatsappRecentChats") ?? []
            let rows = try JSONDecoder().decode([WhatsAppConversation].self, from: JSONSerialization.data(withJSONObject: result))
            guard !Task.isCancelled else { return }
            chats = rows
        } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
    private func addSelected() {
        let rows = chosen
        saving = true; error = nil
        Task {
            defer { saving = false }
            var failures: [String] = []
            for chat in rows {
                let id = agentIDs[chat.id] ?? UUID().uuidString
                agentIDs[chat.id] = id
                do {
                    let agent = SquadAgent(id: id, name: String(chat.name.prefix(100)), adapterType: "whatsapp", recipient: chat.recipient)
                    try await gateway.action("saveAgent", ["agent": try agent.jsonObject()])
                    selected.remove(chat.id)
                } catch { failures.append("\(chat.name): \(error.localizedDescription)") }
            }
            if failures.isEmpty { dismiss() } else { error = failures.joined(separator: "\n") }
        }
    }
}
