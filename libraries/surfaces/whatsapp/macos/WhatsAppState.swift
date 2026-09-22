import Foundation
struct WhatsAppStatus: Decodable { var status: String; var qr: String?; var error: String?; var chatSyncStatus: String?; var chatSyncError: String? }
extension GatewayState {
    var whatsapp: WhatsAppStatus {
        surfaceState["whatsapp"]?.decode(WhatsAppStatus.self) ?? WhatsAppStatus(status: "disconnected")
    }
}
