import SwiftUI

struct AgentEditor: View {
    @Environment(Gateway.self) private var gateway
    @Environment(\.dismiss) private var dismiss
    @State var agent: SquadAgent
    var embedded = false
    var onBusyChange: (Bool) -> Void = { _ in }
    @State private var refreshingPhoto = false
    @State private var photoMessage: String?
    private var savedAgent: SquadAgent? { gateway.state?.agents.first { $0.id == agent.id } }
    private var photoLoading: Bool { refreshingPhoto || savedAgent?.profilePhotoStatus == "loading" }
    private var connectionChanged: Bool {
        guard let savedAgent else { return false }
        return agent.adapterType != savedAgent.adapterType || agent.recipient != savedAgent.recipient || agent.endpoint != savedAgent.endpoint || !credential.isEmpty
    }
    @State private var confirmRemoval = false
    @State private var credential = ""
    @State private var error: String?
    @State private var saving = false
    @State private var validating = false
    private var isNew: Bool { !(gateway.state?.agents.contains { $0.id == agent.id } ?? false) }
    private func secondsField(_ title: String, value: Binding<Int>, in range: ClosedRange<Int>) -> some View {
        LabeledContent(title) {
            HStack(spacing: 6) {
                TextField(title, value: Binding(get: { value.wrappedValue }, set: { value.wrappedValue = min(max($0, range.lowerBound), range.upperBound) }), format: .number.grouping(.never))
                    .labelsHidden().textFieldStyle(.roundedBorder).multilineTextAlignment(.trailing).frame(width: 70)
                Text("seconds").foregroundStyle(.secondary)
            }
        }.help("\(range.lowerBound)–\(range.upperBound) seconds")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            if !embedded { Text(isNew ? "Add Agent" : "Edit").font(.title2.weight(.semibold)) }
            Form {
                Section("Agent") {
                    if !embedded {
                    Picker("Connection", selection: $agent.adapterType) {
                        ForEach(NativeSurfaces.all) { Text($0.name).tag($0.id) }
                    }.pickerStyle(.segmented)
                    }
                    TextField("Name", text: $agent.name, prompt: Text("e.g. Research assistant"))
                }
                if let savedAgent {
                    Section("Image") {
                        HStack(spacing: 14) {
                            AgentAvatar(agent: savedAgent)
                            Button { refreshPhoto() } label: {
                                Label(photoLoading ? "Refreshing…" : "Refresh Image", systemImage: "arrow.clockwise")
                            }.disabled(photoLoading || connectionChanged || gateway.state?.sessions.contains { $0.agentId == agent.id && $0.status == "working" } == true)
                        }
                        if connectionChanged { Text("Save connection changes before refreshing the image.").font(.caption).foregroundStyle(.secondary) }
                        if let photoMessage { Text(photoMessage).font(.caption).foregroundStyle(.secondary) }
                        else if savedAgent.profilePhotoStatus == "unavailable" { Text("No new image was available.").font(.caption).foregroundStyle(.secondary) }
                    }
                }
                Section("Connection") {
                    NativeSurfaces.find(agent.adapterType)?.connection($agent, $credential, $validating)
                }

                Section("Task behavior") {
                    Toggle("Enabled", isOn: $agent.enabled)
                    if NativeSurfaces.find(agent.adapterType)?.usesQuietInterval == true {
                        secondsField("Finish after no reply for", value: $agent.quietSeconds, in: 1...120)
                    }
                    secondsField("Task timeout", value: $agent.timeoutSeconds, in: 10...3600)
                }
            }.formStyle(.grouped).disabled(saving || validating || refreshingPhoto)
            if let error { Text(error).foregroundStyle(.red).font(.caption) }
            HStack {
                if !isNew {
                    Button("Remove Agent", role: .destructive) { confirmRemoval = true }.disabled(saving || validating || refreshingPhoto)
                }
                Spacer(); Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving || refreshingPhoto)
                Button(saving ? "Checking & Saving…" : "Save Agent") { save() }.buttonStyle(.borderedProminent).disabled(saving || validating || refreshingPhoto || agent.name.trimmingCharacters(in: .whitespaces).isEmpty).keyboardShortcut(.defaultAction)
            }
        }.padding(embedded ? 0 : 28).frame(width: embedded ? nil : 570, height: embedded ? nil : 660)
        .confirmationDialog("Remove this agent and its local session history?", isPresented: $confirmRemoval) {
            Button("Remove Agent", role: .destructive) {
                saving = true; error = nil
                Task {
                    defer { saving = false }
                    do {
                        try await gateway.action("deleteAgent", ["agentId": agent.id])
                        Keychain.delete(account: "agent." + agent.id)
                        dismiss()
                    } catch { self.error = error.localizedDescription }
                }
            }
        }
        .interactiveDismissDisabled(saving || validating || refreshingPhoto)
        .onChange(of: saving || validating) { _, busy in onBusyChange(busy) }
        .onChange(of: agent.recipient) { _, _ in agent.recipientAliases = [] }
        .onChange(of: agent.adapterType) { _, _ in agent.recipientAliases = [] }
    }
    private func refreshPhoto() {
        guard let savedAgent else { return }
        refreshingPhoto = true; photoMessage = nil; error = nil
        Task {
            defer { refreshingPhoto = false }
            do {
                photoMessage = try await NativeSurfaces.find(savedAgent.adapterType)?.refreshPhoto(savedAgent, gateway)
            } catch { self.error = error.localizedDescription }
        }
    }
    private func save() {
        saving = true
        Task {
            defer { saving = false }
            do {
                try await NativeSurfaces.find(agent.adapterType)?.prepareSave(agent, credential, gateway)
                if let latest = savedAgent {
                    agent.profilePhoto = latest.profilePhoto
                    agent.profilePhotoStatus = latest.profilePhotoStatus
                }
                try await gateway.action("saveAgent", ["agent": try agent.jsonObject()]); dismiss()
            } catch { self.error = error.localizedDescription }
        }
    }
}
