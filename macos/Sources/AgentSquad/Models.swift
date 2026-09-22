import Foundation

struct SquadAgent: Codable, Identifiable, Hashable {
    var id = UUID().uuidString
    var name = ""
    var adapterType = ""
    var recipient = ""
    var recipientAliases: [String] = []
    var endpoint = ""
    var profilePhoto: String?
    var profilePhotoStatus: String?
    var enabled = true
    var quietSeconds = 8
    var timeoutSeconds = 180
    @MainActor var transportName: String { NativeSurfaces.find(adapterType)?.name ?? adapterType }
    @MainActor var symbol: String { NativeSurfaces.find(adapterType)?.symbol ?? "person.crop.circle" }
}
struct SquadMessage: Codable, Identifiable { var id: String; var role: String; var text: String; var timestamp: String }
struct SquadSession: Codable, Identifiable {
    var id: String; var agentId: String; var contextId: String; var status: String
    var createdAt: String; var updatedAt: String; var messages: [SquadMessage]; var error: String?
    var title: String { messages.first(where: { $0.role == "user" })?.text ?? "New session" }
}
struct TunnelConfig: Codable {
    var tunnelId = ""
    var executable = "/opt/homebrew/bin/tunnel-client"
    var autoConnect = false
}
struct TunnelStatus: Decodable { var status: String; var error: String?; var healthURL: String? }
struct GatewayState: Decodable {
    var agents: [SquadAgent]; var sessions: [SquadSession]; var tunnelConfig: TunnelConfig?
    var tunnel: TunnelStatus; var surfaceState: [String: SurfaceValue]
    var endpoint: String
}
extension Encodable {
    func jsonObject() throws -> Any { try JSONSerialization.jsonObject(with: JSONEncoder().encode(self)) }
}
