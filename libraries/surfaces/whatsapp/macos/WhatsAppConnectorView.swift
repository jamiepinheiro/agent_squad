import SwiftUI
import CoreImage.CIFilterBuiltins
struct WhatsAppConnectorView: View {
    @Environment(Gateway.self) private var gateway
    @State private var confirmUnlink = false
    var body: some View {
        connectionCard(title: "WhatsApp", symbol: "phone.bubble.fill", subtitle: gateway.state?.whatsapp.status.capitalized ?? "Disconnected") {
            Text("Link this Mac from WhatsApp on your phone: Settings → Linked Devices → Link a Device. Agent Squad uses the open-source Baileys linked-device connection.").foregroundStyle(.secondary)
            if let qr = gateway.state?.whatsapp.qr, let image = qrImage(qr) {
                HStack { Spacer(); Image(nsImage: image).interpolation(.none).resizable().frame(width: 220, height: 220).padding(16).background(.white, in: RoundedRectangle(cornerRadius: 12)); Spacer() }
                Text("Scan this QR code with WhatsApp. It refreshes automatically.").font(.caption).foregroundStyle(.secondary)
            }
            if let error = gateway.state?.whatsapp.error { Text(error).foregroundStyle(.orange).font(.caption) }
            HStack {
                if gateway.state?.whatsapp.status == "connected" {
                    Button("Disconnect") { gateway.perform("disconnectWhatsApp") }
                } else if ["connecting", "pairing", "reconnecting"].contains(gateway.state?.whatsapp.status ?? "") {
                    Button("Cancel Connection") { gateway.perform("disconnectWhatsApp") }
                } else {
                    Button("Connect WhatsApp") { gateway.perform("connectWhatsApp") }.buttonStyle(.borderedProminent)
                }
                Button("Unlink this Mac…", role: .destructive) { confirmUnlink = true }
            }.disabled(gateway.state == nil || gateway.busy)
            Text("Disconnect pauses this connection. Unlink removes the saved pairing and requires scanning a new QR code.").font(.caption).foregroundStyle(.secondary)
        }
        .confirmationDialog("Unlink WhatsApp from this Mac?", isPresented: $confirmUnlink, titleVisibility: .visible) {
            Button("Unlink this Mac", role: .destructive) { gateway.perform("logoutWhatsApp") }
        } message: {
            Text("The saved pairing will be removed. You’ll need to scan a new QR code to reconnect. Your agents and task history will stay in Agent Squad.")
        }
    }
    private func qrImage(_ text: String) -> NSImage? {
        let filter = CIFilter.qrCodeGenerator(); filter.message = Data(text.utf8)
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 8, y: 8)), let image = CIContext().createCGImage(output, from: output.extent) else { return nil }
        return NSImage(cgImage: image, size: .init(width: output.extent.width, height: output.extent.height))
    }
}
