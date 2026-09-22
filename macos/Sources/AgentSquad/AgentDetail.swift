import SwiftUI

struct AgentDetail: View {
    @Environment(Gateway.self) private var gateway
    @Environment(\.dismiss) private var dismiss
    var agentId: String
    @State var selectedSession: String? = nil
    @State private var prompt = ""
    @State private var busy = false
    private var agent: SquadAgent? { gateway.state?.agents.first { $0.id == agentId } }
    private var sessions: [SquadSession] { gateway.state?.sessions.filter { $0.agentId == agentId } ?? [] }
    private var session: SquadSession? { sessions.first { $0.id == selectedSession } }
    private var canSend: Bool { !busy && !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && session?.status != "working" && agent?.enabled == true }
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 14) {
                if let agent { AgentAvatar(agent: agent) }
                VStack(alignment: .leading, spacing: 4) { Text(agent?.name ?? "Agent").font(.title2.bold()); Text(agent?.transportName ?? "").foregroundStyle(.secondary) }
                Spacer()
                Button { dismiss() } label: { Image(systemName: "xmark") }.buttonStyle(.plain).accessibilityLabel("Close agent")
            }
            HStack(spacing: 10) {
                Picker("Session", selection: $selectedSession) {
                    Text("New session").tag(String?.none)
                    ForEach(sessions) { s in Text(String(s.title.prefix(45))).tag(Optional(s.id)) }
                }.pickerStyle(.menu).labelsHidden().fixedSize(horizontal: true, vertical: false)
                Button { selectedSession = nil } label: { Image(systemName: "plus.bubble") }.help("Start a new session")
                Spacer(minLength: 0)
            }
            ScrollViewReader { reader in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 16) {
                        ForEach(session?.messages ?? []) { message in
                            messageBubble(message)
                        }
                        if let session {
                            HStack { if session.status == "working" { ProgressView().controlSize(.small) }; Text(session.status.replacingOccurrences(of: "-", with: " ").capitalized).font(.caption).foregroundStyle(.secondary) }
                            if let error = session.error { Text(error).font(.caption).foregroundStyle(.orange).textSelection(.enabled) }
                        }
                        Color.clear.frame(height: 1).id("bottom")
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
                .overlay {
                    if session == nil {
                        VStack(spacing: 12) {
                            Image(systemName: "bubble.left.and.bubble.right").font(.system(size: 36)).foregroundStyle(.tertiary)
                            Text("Start a conversation").font(.headline).foregroundStyle(.secondary)
                        }.frame(maxWidth: .infinity, maxHeight: .infinity).allowsHitTesting(false)
                    }
                }.onChange(of: session?.messages.count) { _, _ in reader.scrollTo("bottom", anchor: .bottom) }
            }
            Divider()
            HStack(alignment: .bottom, spacing: 12) {
                composer.frame(maxWidth: .infinity)
                if session?.status == "working" {
                    Button("Stop waiting") { if let session { gateway.perform("cancel", ["agentId": agentId, "sessionId": session.id]) } }
                }
                Button("Send Task") { send() }.buttonStyle(.borderedProminent).disabled(!canSend)
            }
        }.padding(26).frame(width: 740, height: 640)
    }
    private var composer: some View {
        TextField("What should this agent do?", text: $prompt, axis: .vertical)
            .lineLimit(1...6).textFieldStyle(.roundedBorder)
            .onKeyPress(.return, phases: .down) { key in
                if key.modifiers.contains(.shift) { return .ignored }
                send()
                return .handled
            }
    }
    private func messageBubble(_ message: SquadMessage) -> some View {
        let author = message.role == "user" ? "YOU" : (agent?.name.uppercased() ?? "AGENT")
        let background = message.role == "user" ? Color.squadGreen.opacity(0.07) : Color(nsColor: .controlBackgroundColor)
        return VStack(alignment: .leading, spacing: 7) {
            Text(author).font(.system(size: 10, weight: .semibold)).tracking(1).foregroundStyle(.secondary)
            Text(message.text).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
        }.padding(16).background(background, in: RoundedRectangle(cornerRadius: 12)).id(message.id)
    }
    private func send() {
        guard canSend else { return }
        let submittedPrompt = prompt
        busy = true
        Task {
            defer { busy = false }
            do {
                var id = selectedSession
                if id == nil {
                    let result = try await gateway.action("createSession", ["agentId": agentId]) as? [String: Any]
                    id = result?["id"] as? String; selectedSession = id
                }
                guard let id else { return }
                try await gateway.action("sendPrompt", ["agentId": agentId, "sessionId": id, "prompt": submittedPrompt])
                if prompt == submittedPrompt { prompt = "" }
            } catch { gateway.error = error.localizedDescription }
        }
    }
}
struct ActivityView: View {
    @Environment(Gateway.self) private var gateway
    @State private var detail: SquadSession?
    private func agentName(_ id: String) -> String { gateway.state?.agents.first(where: { $0.id == id })?.name ?? id }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                PageHeading(title: "Activity")
                if gateway.state?.sessions.isEmpty != false {
                    ContentUnavailableView("No activity yet", systemImage: "clock.arrow.circlepath").frame(maxWidth: .infinity, minHeight: 350)
                }
                ForEach(gateway.state?.sessions ?? []) { session in
                    Button {
                        detail = session
                    } label: {
                        VStack(alignment: .leading, spacing: 10) {
                            HStack { Text(agentName(session.agentId)).font(.headline); Spacer(); StatusLabel(text: session.status.capitalized, active: session.status == "completed" || session.status == "working") }
                            Text(session.title).lineLimit(2).foregroundStyle(.secondary)
                            Text(session.updatedAt).font(.caption2).foregroundStyle(.tertiary)
                        }.padding(20).card()
                    }.buttonStyle(.plain)
                }
            }.padding(32)
        }.sheet(item: $detail) { AgentDetail(agentId: $0.agentId, selectedSession: $0.id).environment(gateway) }.navigationTitle("")
    }
}
