import SwiftUI
import UniformTypeIdentifiers

struct ReorderableAgentCard<Content: View>: View {
    let agentID: String
    let move: (String, String) -> Bool
    @ViewBuilder var content: () -> Content
    @State private var targeted = false

    var body: some View {
        content()
            .contentShape(RoundedRectangle(cornerRadius: 16))
            .onDrag {
                NSItemProvider(object: ("agent-squad-card:" + agentID) as NSString)
            }
            .overlay {
                RoundedRectangle(cornerRadius: 16)
                    .strokeBorder(Color.accentColor, lineWidth: targeted ? 2 : 0)
                    .allowsHitTesting(false)
            }
            .onDrop(of: [UTType.text], delegate: AgentCardDropDelegate(
                targetID: agentID, targeted: $targeted, move: move
            ))
            .help("Drag to reorder")
    }
}

private struct AgentCardDropDelegate: DropDelegate {
    let targetID: String
    @Binding var targeted: Bool
    let move: (String, String) -> Bool

    func validateDrop(info: DropInfo) -> Bool {
        info.itemProviders(for: [UTType.text]).contains { $0.canLoadObject(ofClass: NSString.self) }
    }

    func dropEntered(info: DropInfo) { targeted = true }
    func dropExited(info: DropInfo) { targeted = false }
    func dropUpdated(info: DropInfo) -> DropProposal? { DropProposal(operation: .move) }

    func performDrop(info: DropInfo) -> Bool {
        targeted = false
        guard let provider = info.itemProviders(for: [UTType.text]).first,
              provider.canLoadObject(ofClass: NSString.self) else { return false }
        provider.loadObject(ofClass: NSString.self) { object, error in
            guard error == nil, let payload = object as? String,
                  payload.hasPrefix("agent-squad-card:") else { return }
            let sourceID = String(payload.dropFirst("agent-squad-card:".count))
            DispatchQueue.main.async { _ = move(sourceID, targetID) }
        }
        return true
    }
}
