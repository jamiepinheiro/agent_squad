import SwiftUI
import UniformTypeIdentifiers

private struct AgentCardDrag: Codable, Transferable {
    let agentID: String

    static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .agentSquadCard)
    }
}

private extension UTType {
    static let agentSquadCard = UTType(exportedAs: "com.jamiepinheiro.agentsquad.agent-card")
}

struct ReorderableAgentCard<Content: View>: View {
    let agentID: String
    let move: (String, String) -> Bool
    @ViewBuilder var content: () -> Content
    @State private var targeted = false

    var body: some View {
        content()
            .contentShape(RoundedRectangle(cornerRadius: 16))
            .draggable(AgentCardDrag(agentID: agentID))
            .overlay {
                RoundedRectangle(cornerRadius: 16)
                    .strokeBorder(Color.accentColor, lineWidth: targeted ? 2 : 0)
                    .allowsHitTesting(false)
            }
            .dropDestination(for: AgentCardDrag.self) { items, _ in
                guard items.count == 1, let item = items.first else { return false }
                return move(item.agentID, agentID)
            } isTargeted: { targeted = $0 }
            .help("Drag to reorder")
    }
}
