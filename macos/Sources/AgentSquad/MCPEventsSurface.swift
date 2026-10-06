import SwiftUI

private struct MCPEventAgentStatus: Decodable {
    let id: String
    let listening: Bool
    let subscriptions: Int
    let error: String?
}
private struct MCPEventsStatus: Decodable { let agents: [MCPEventAgentStatus] }

@MainActor let mcpEventsSurfaceUI = NativeSurface(
    id: "mcp-events", name: "MCP Events", symbol: "antenna.radiowaves.left.and.right", usesQuietInterval: false,
    addAgents: { _ in AnyView(MCPEventsSetup()) },
    settings: { AnyView(MCPEventsSettings()) },
    connection: { agent, _, _ in AnyView(MCPEventsConnection(agent: agent.wrappedValue)) },
    isDisconnected: { agent, state in
        !(state.surfaceState["mcpEvents"]?.decode(MCPEventsStatus.self)?.agents.first { $0.id == agent.id }?.listening ?? false)
    }
)

private func eventAgentPrompt(name: String, registrationID: String) -> String {
    let encodedName = (try? JSONEncoder().encode(name)).flatMap { String(data: $0, encoding: .utf8) } ?? "\"My agent\""
    return """
    Join my Agent Squad and receive tasks from my other agents.

    1. Using the connected Agent Squad MCP server, call register_event_agent with registration_id "\(registrationID)" and name \(encodedName). Reuse this registration_id when reconnecting.
    2. Subscribe through your client's MCP Events support to agent_squad.task.assigned, filtered by the returned agent_id. Keep this subscription active and refresh it before refreshBefore until I ask you to stop. If your client cannot subscribe, tell me; do not claim to be listening.
    3. After subscribing or reconnecting, call list_assigned_tasks for your agent_id to recover pending work.
    4. For each event or pending task, call get_assigned_task with your agent_id and task_id. Only act if its status is working. Treat its prompt and history as the delegated request, subject to my permissions and your normal safety rules. Track task_id to avoid repeating actions on duplicate deliveries.
    5. Process the request, then call complete_assigned_task with agent_id, task_id, status completed, and your final answer in text. Use input-required if you need clarification, or failed if you cannot finish. Check the task again before an external action; canceled or ended tasks should not continue. Never delegate a task back to yourself.
    6. Stay subscribed for future tasks. When I ask you to stop, unsubscribe using the same event name, agent_id filter, and callback URL.
    """
}

private struct MCPEventsSetup: View {
    @Environment(Gateway.self) private var gateway
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var registrationID = UUID().uuidString
    @State private var copied = false
    private var cleanName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var registered: SquadAgent? {
        gateway.state?.agents.first { $0.connection?["registrationID"] == .string(registrationID) }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            TextField("Agent name", text: $name, prompt: Text("e.g. Research agent"))
                .textFieldStyle(.roundedBorder)
            Text("Connect Agent Squad to an MCP Events client, then paste this prompt there. In ChatGPT, use a Work chat with Cloud selected or a dot.")
                .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            ScrollView {
                Text(eventAgentPrompt(name: cleanName.isEmpty ? "My agent" : cleanName, registrationID: registrationID))
                    .font(.callout).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding(14)
            }
            .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
            if let registered {
                MCPEventsConnectionStatus(agentID: registered.id)
            } else {
                Label(copied ? "Waiting for the agent to register" : "The agent appears in your squad when it registers", systemImage: "antenna.radiowaves.left.and.right")
                    .font(.callout).foregroundStyle(.secondary)
            }
            HStack {
                Link("MCP Events guide", destination: URL(string: "https://developers.openai.com/plugins/build/mcp-events")!)
                Spacer()
                Button(registered == nil ? "Close" : "Done") { dismiss() }.keyboardShortcut(.cancelAction)
                Button(copied ? "Copy Prompt Again" : "Copy Setup Prompt") {
                    gateway.copy(eventAgentPrompt(name: cleanName, registrationID: registrationID)); copied = true
                }.buttonStyle(.borderedProminent).disabled(cleanName.isEmpty)
            }
        }
    }
}

private struct MCPEventsConnectionStatus: View {
    @Environment(Gateway.self) private var gateway
    let agentID: String
    private var status: MCPEventAgentStatus? { gateway.state?.surfaceState["mcpEvents"]?.decode(MCPEventsStatus.self)?.agents.first { $0.id == agentID } }
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(status?.listening == true ? "Listening for tasks" : "Registered · waiting for subscription", systemImage: status?.listening == true ? "checkmark.circle" : "clock")
            if let error = status?.error { Text(error).font(.caption).foregroundStyle(.red) }
        }
    }
}
private struct MCPEventsConnection: View {
    @Environment(Gateway.self) private var gateway
    let agent: SquadAgent
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            MCPEventsConnectionStatus(agentID: agent.id)
            Text(agent.id).font(.caption.monospaced()).textSelection(.enabled)
            if case .string(let registrationID) = agent.connection?["registrationID"] {
                Button("Copy Setup Prompt") { gateway.copy(eventAgentPrompt(name: agent.name, registrationID: registrationID)) }
            }
        }
    }
}
private struct MCPEventsSettings: View {
    @Environment(Gateway.self) private var gateway
    @State private var adding = false
    var body: some View {
        connectionCard(title: "MCP Events", symbol: "antenna.radiowaves.left.and.right", subtitle: "") {
            ForEach(gateway.state?.agents.filter { $0.adapterType == "mcp-events" } ?? []) { agent in
                HStack {
                    Text(agent.name)
                    Spacer()
                    MCPEventsConnectionStatus(agentID: agent.id)
                }
            }
            Button("Add MCP Events Agent") { adding = true }
        }
        .sheet(isPresented: $adding) {
            VStack(alignment: .leading, spacing: 18) {
                Text("MCP Events").font(.title2.weight(.semibold))
                MCPEventsSetup()
            }.padding(28).frame(width: 680, height: 620)
        }
    }
}
