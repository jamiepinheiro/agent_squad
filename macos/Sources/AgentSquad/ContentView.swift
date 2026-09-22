import SwiftUI

enum Destination: String, CaseIterable, Identifiable {
    case agents = "Agents", activity = "Activity", settings = "Settings"
    var id: String { rawValue }
    var symbol: String { switch self { case .agents: "cpu"; case .activity: "clock.arrow.circlepath"; case .settings: "gearshape" } }
}
enum SquadSheet: Identifiable {
    case add, editor(SquadAgent), detail(String)
    var id: String { switch self { case .add: "add"; case .editor(let a): "edit-" + a.id; case .detail(let id): id } }
}
struct ContentView: View {
    @Environment(Gateway.self) private var gateway
    @State private var destination: Destination? = .agents
    @State private var sheet: SquadSheet?
    var body: some View {
        @Bindable var gateway = gateway
        NavigationSplitView {
            VStack(alignment: .leading, spacing: 24) {
                HStack(spacing: 10) {
                    Image(nsImage: SquadArtwork.appIcon).resizable().scaledToFit().frame(width: 30, height: 30)
                    Text("Agent Squad").font(.title3.weight(.semibold))
                }.padding(.horizontal, 18).padding(.top, 28)
                List(Destination.allCases, selection: $destination) { item in
                    Label {
                        Text(item.rawValue)
                    } icon: {
                        Image(systemName: item.symbol)
                    }.padding(.vertical, 7).tag(item)
                }.listStyle(.sidebar)
            }.navigationSplitViewColumnWidth(min: 205, ideal: 220, max: 260)
        } detail: {
            Group {
                switch destination ?? .agents {
                case .agents: agents
                case .activity: ActivityView()
                case .settings: SettingsView()
                }
            }.background(Color(nsColor: .windowBackgroundColor))
        }
        .sheet(item: $sheet) { item in
            switch item {
            case .add: AddAgentsView().environment(gateway)
            case .editor(let agent): AgentEditor(agent: agent).environment(gateway)
            case .detail(let id): AgentDetail(agentId: id).environment(gateway)
            }
        }
        .alert("Agent Squad", isPresented: Binding(get: { gateway.error != nil }, set: { if !$0 { gateway.error = nil } })) {
            Button("OK") { gateway.error = nil }
        } message: { Text(gateway.error ?? "") }
    }
    private var agents: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                HStack {
                    PageHeading(title: "Agents")
                    Spacer()
                    Button { sheet = .add } label: { Label("Add", systemImage: "plus") }
                        .buttonStyle(.borderedProminent).controlSize(.large).disabled(gateway.state == nil)
                }
                if let state = gateway.state {
                    if state.agents.isEmpty {
                        VStack(spacing: 18) {
                            Image(nsImage: SquadArtwork.appIcon).resizable().scaledToFit().frame(width: 100, height: 100)
                            Text("No agents yet").font(.title2.weight(.semibold))
                            Button("Add your first agent") { sheet = .add }.buttonStyle(.borderedProminent).controlSize(.large)
                            HStack(spacing: 24) { ForEach(NativeSurfaces.all) { Label($0.name, systemImage: $0.symbol) } }.font(.caption).foregroundStyle(.secondary).padding(.top, 12)
                        }.frame(maxWidth: .infinity).padding(.vertical, 48).card()
                    } else {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 250), spacing: 16)], spacing: 16) {
                            ForEach(state.agents) { agent in
                                AgentRow(agent: agent, disconnected: disconnected(agent, state: state), working: state.sessions.contains { $0.agentId == agent.id && $0.status == "working" }, open: { sheet = .detail(agent.id) }, edit: { sheet = .editor(agent) })
                            }
                        }
                    }
                } else { ProgressView(gateway.launchStatus).frame(maxWidth: .infinity, minHeight: 280) }

            }.padding(32).frame(maxWidth: 1200)
        }.navigationTitle("")
        .task { for surface in NativeSurfaces.all { await surface.refreshStatus() } }
    }
    private func disconnected(_ agent: SquadAgent, state: GatewayState) -> Bool {
        if !agent.enabled { return true }
        return NativeSurfaces.find(agent.adapterType)?.isDisconnected(agent, state) ?? true
    }
}
struct PageHeading: View {
    var title: String
    var body: some View { Text(title).font(.system(size: 32, weight: .semibold, design: .rounded)) }
}
struct AgentRow: View {
    var agent: SquadAgent; var disconnected: Bool; var working: Bool
    var open: () -> Void
    var edit: () -> Void
    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Button(action: open) {
                VStack(alignment: .leading, spacing: 18) {
                    HStack(spacing: 14) {
                        AgentAvatar(agent: agent, size: 48)
                        VStack(alignment: .leading, spacing: 5) {
                            Text(agent.name).font(.headline).lineLimit(2)
                            Text(agent.transportName).font(.caption).foregroundStyle(Color.squadGreen)
                        }
                        Spacer(minLength: 0)
                    }.frame(height: 60, alignment: .leading)
                    HStack {
                        Circle()
                            .fill(disconnected ? Color.red : working ? Color.orange : Color.squadGreen)
                            .frame(width: 8, height: 8)
                            .accessibilityHidden(true)
                        Text(disconnected ? "Disconnected" : working ? "Working" : "Connected")
                            .font(.caption).foregroundStyle(.secondary)
                        Spacer(minLength: 40)
                    }.frame(height: 28)
                }
                .padding(18).frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }.buttonStyle(.plain)
            Button(action: edit) {
                Image(systemName: "pencil").frame(width: 28, height: 28)
                    .background(Color.squadGreen.opacity(0.12), in: Circle())
                    .contentShape(Circle())
            }
                .buttonStyle(.borderless).help("Edit \(agent.name)").accessibilityLabel("Edit \(agent.name)")
                .padding(18)
        }.card()
    }
}
struct StatusLabel: View {
    var text: String; var active: Bool
    var body: some View { HStack(spacing: 7) { Circle().fill(active ? Color.squadGreen : .secondary).frame(width: 6, height: 6); Text(text).font(.caption) } }
}
extension View {
    func card() -> some View { background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 16)).overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Color.primary.opacity(0.06))) }
}
