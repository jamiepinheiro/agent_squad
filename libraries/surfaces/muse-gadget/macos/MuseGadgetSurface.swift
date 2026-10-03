import SwiftUI
import UniformTypeIdentifiers

@MainActor let museGadgetSurfaceUI = NativeSurface(
    id: "muse-gadget", name: "Muse Gadget", symbol: "cpu", usesQuietInterval: false,
    addAgents: { saving in AnyView(AgentEditor(agent: SquadAgent(name: "Muse", adapterType: "muse-gadget"), embedded: true, onBusyChange: { saving.wrappedValue = $0 })) },
    settings: { AnyView(GroupBox("Muse Gadget") { MusePairingFields().padding(12) }) },
    connection: { agent, _, validating in AnyView(MusePairingFields(onBusyChange: { validating.wrappedValue = $0 }).onAppear { agent.wrappedValue.connection = ["mode": .string("native")] }) },
    prepareSave: { _, _, gateway in try await gateway.action("validateMuseGadget") }
)

private struct MusePairingFields: View {
    var onBusyChange: (Bool) -> Void = { _ in }
    @Environment(Gateway.self) private var gateway
    @State private var command = ""
    @State private var transferStatus = ""
    @State private var receiving = false
    @State private var copied = false
    @State private var choosingFile = false
    @State private var imported = false
    @State private var busy = false
    @State private var connected = false
    @State private var paired = false
    @State private var connectionStatus = "Not paired"
    @State private var error: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(connected ? "Connected to Muse" : connectionStatus, systemImage: connected ? "checkmark.circle.fill" : "antenna.radiowaves.left.and.right")
                .foregroundStyle(connected ? Color.squadGreen : .secondary)
            Text("1. Pair your Raspberry Pi in Muse → Settings → Devices.\n2. Keep the Pi and Mac on the same network.\n3. Copy the transfer command and run it on the Pi.")
                .font(.callout).fixedSize(horizontal: false, vertical: true)
            if command.isEmpty {
                Button("Receive pairing from Raspberry Pi") {
                    busy = true; error = nil
                    Task {
                        defer { busy = false }
                        do {
                            if let result = try await gateway.action("museTransferStart") as? [String: Any] {
                                command = result["command"] as? String ?? ""
                                transferStatus = result["status"] as? String ?? ""
                                copied = false
                            }
                        } catch { self.error = error.localizedDescription }
                    }
                }.disabled(busy || receiving)
            } else {
                HStack {
                    Button(copied ? "Copied" : "Copy Pi command") {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(command, forType: .string)
                        copied = true
                    }.disabled(receiving)
                    Button("Cancel transfer") {
                        Task {
                            do { try await gateway.action("museTransferStop"); command = ""; transferStatus = "" }
                            catch { self.error = error.localizedDescription }
                        }
                    }.disabled(receiving)
                }
                Text("Run the command in a terminal on your paired Pi within 10 minutes. It stops the Pi’s Muse service and securely transfers its pairing to this Mac.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            if !transferStatus.isEmpty { Text(transferStatus).font(.callout).foregroundStyle(.secondary) }
            HStack {
                Button("Setup instructions") {
                    if let file = Bundle.main.resourceURL?.appendingPathComponent("MuseSetup/README.md") { NSWorkspace.shared.open(file) }
                }
                Button(busy ? "Checking pairing…" : "Import from file…") { choosingFile = true }
                    .disabled(busy || receiving || !command.isEmpty)
            }
            if imported { Text("Pairing saved in Keychain. You can delete the transfer file.").font(.callout).foregroundStyle(Color.squadGreen) }
            if let error { Text(error).foregroundStyle(.red).font(.callout) }
        }
        .onChange(of: busy || receiving) { _, value in onBusyChange(value) }
        .fileImporter(isPresented: $choosingFile, allowedContentTypes: [.json]) { result in
            guard case .success(let url) = result else { return }
            busy = true; error = nil; imported = false
            Task {
                defer { busy = false }
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                do {
                    let file = try FileHandle(forReadingFrom: url)
                    defer { try? file.close() }
                    var data = Data()
                    while data.count <= 65536 {
                        guard let chunk = try file.read(upToCount: min(4096, 65537 - data.count)), !chunk.isEmpty else { break }
                        data.append(chunk)
                    }
                    guard data.count <= 65536,
                          let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                        throw NSError(domain: "Muse", code: 1, userInfo: [NSLocalizedDescriptionKey: "Choose a pairing JSON file created by export-pairing.py."])
                    }
                    try await gateway.action("musePairingImport", ["pairing": object])
                    imported = true
                } catch { self.error = error.localizedDescription }
            }
        }
        .task {
            while !Task.isCancelled {
                if let state = try? await gateway.action("museGadgetStatus") as? [String: Any] {
                    connected = state["connected"] as? Bool ?? false
                    paired = state["paired"] as? Bool ?? false
                    connectionStatus = state["status"] as? String ?? "Not paired"
                }
                if let transfer = try? await gateway.action("museTransferStatus") as? [String: Any] {
                    command = transfer["command"] as? String ?? ""
                    transferStatus = transfer["status"] as? String ?? ""
                    receiving = transfer["receiving"] as? Bool ?? false
                }
                try? await Task.sleep(for: .seconds(2))
            }
        }
    }
}
