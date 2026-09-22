import SwiftUI
struct IMessageConnectorView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var messagesAccess = MessagesAccess()
    @State private var showAccessResult = false
    @State private var setupSheet: SetupSheet?
    private enum SetupSheet: String, Identifiable { case messages; var id: String { rawValue } }
    var body: some View {
        connectionCard(title: "iMessage", symbol: "message.fill", subtitle: messagesAccess.detail) {
            HStack {
                if messagesAccess.ready {
                    Button("Manage Access…") { openURL("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles") }
                    Button("Sending Permissions…") { openURL("x-apple.systempreferences:com.apple.preference.security?Privacy_Automation") }
                } else {
                    Button("Set Up iMessage") { setupSheet = .messages }.buttonStyle(.borderedProminent)
                }
                Button("Check Access") {
                    Task {
                        messagesAccess.check()
                        await messagesAccess.checkSending()
                        showAccessResult = true
                    }
                }
            }
            if messagesAccess.ready {
                Text("To revoke access to replies, open Manage Access and turn off Agent Squad. To revoke sending, open Sending Permissions and turn off Messages under Agent Squad.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Text("iMessage setup requests Messages control and guides you through Full Disk Access.")
                .font(.caption).foregroundStyle(.secondary)
        }
        .alert("Messages Access", isPresented: $showAccessResult) {
            Button("OK", role: .cancel) { }
        } message: {
            Text(messagesAccess.detail)
        }
        .sheet(item: $setupSheet) { _ in MessagesSetupView(access: messagesAccess) }
        .task { messagesAccess.check(); await messagesAccess.checkSending() }
        .onChange(of: scenePhase) { _, phase in if phase == .active { Task { messagesAccess.check(); await messagesAccess.checkSending() } } }
    }
}
