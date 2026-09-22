import SwiftUI

struct IMessageAgentsPicker: View {
    @Environment(Gateway.self) private var gateway
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var businessContacts: [ContactCandidate] = []
    @State private var businessError: String?
    @State private var directory = ContactDirectory()
    private let transport = "imessage"
    @State private var query = ""
    @State private var selected: Set<String> = []
    @State private var recipients: [String: String] = [:]
    @State private var agentIDs: [String: String] = [:]
    @State private var typedRecipient = ""
    @State private var typedName = ""
    @Binding var saving: Bool
    @State private var error: String?
    @State private var useNANP = ["US", "CA"].contains(Locale.current.region?.identifier ?? "")

    private var visibleContacts: [ContactCandidate] {
        let search = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return directory.contacts.filter {
            !$0.addresses.isEmpty && (search.isEmpty || $0.name.localizedStandardContains(search) || $0.addresses.contains { $0.value.localizedStandardContains(search) })
        }
    }
    private func rawRecipient(_ contact: ContactCandidate) -> String {
        recipients[contact.id] ?? contact.addresses.first?.value ?? ""
    }
    private func recipient(_ contact: ContactCandidate) -> String? {
        ContactCandidate.recipient(rawRecipient(contact), useNANP: useNANP)
    }
    private func alreadyAdded(_ contact: ContactCandidate) -> Bool {
        guard let recipient = recipient(contact) else { return false }
        return gateway.state?.agents.contains { $0.adapterType == transport && $0.recipient.lowercased() == recipient } ?? false
    }
    private var typedContact: ContactCandidate? {
        let address = typedRecipient.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !address.isEmpty else { return nil }
        let name = typedName.trimmingCharacters(in: .whitespacesAndNewlines)
        return ContactCandidate(id: "typed-imessage", name: name.isEmpty ? address : name,
            addresses: [ContactAddress(id: "typed", label: "iMessage", value: address, isEmail: address.contains("@"))])
    }
    private var selectedContacts: [ContactCandidate] {
        var contacts = (directory.contacts + businessContacts).filter { selected.contains($0.id) && !alreadyAdded($0) }
        if let contact = typedContact, !alreadyAdded(contact) { contacts.append(contact) }
        return contacts
    }
    private var hasInvalidSelection: Bool { selectedContacts.contains { recipient($0) == nil } }
    private var numberToAdd: Int { Set(selectedContacts.compactMap { recipient($0) }).count }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 8) {
                TextField("Phone number or Apple ID", text: $typedRecipient, prompt: Text(verbatim: "+15551234567 or name@example.com").foregroundColor(Color(nsColor: .labelColor)))
                    .textFieldStyle(.roundedBorder).foregroundColor(Color(nsColor: .labelColor))
                if !typedRecipient.isEmpty {
                    TextField("Name (optional)", text: $typedName).textFieldStyle(.roundedBorder)
                    if let contact = typedContact {
                        if alreadyAdded(contact) { Text("Already added").font(.caption).foregroundStyle(Color.squadGreen) }
                        else if recipient(contact) == nil { Text("Enter an international number with country code or an Apple ID email.").font(.caption).foregroundStyle(.orange) }
                    }
                }
            }
            Divider()
            if !businessContacts.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Business conversations").font(.headline)
                    ScrollView {
                        VStack(alignment: .leading, spacing: 0) {
                            ForEach(businessContacts.filter { query.isEmpty || $0.name.localizedStandardContains(query) }) { contact in contactRow(contact) }
                        }
                    }.frame(maxHeight: 110)
                }
                Divider()
            }
            if let businessError {
                HStack {
                    Text(businessError).font(.caption).foregroundStyle(.secondary)
                    Button("Retry") { Task { await loadBusinessChats() } }
                }
            }
            Text("Contacts").font(.headline)
            contactsContent
            if let error { Text(error).font(.caption).foregroundStyle(.red).textSelection(.enabled) }
            Divider()
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
                Button(saving ? "Adding…" : numberToAdd == 0 ? "Add Selected" : "Add \(numberToAdd) \(numberToAdd == 1 ? "Agent" : "Agents")") { addSelected() }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                    .disabled(numberToAdd == 0 || hasInvalidSelection || gateway.state == nil)
            }
        }
        .task { await directory.load(); await loadBusinessChats() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active && !saving { Task { await directory.load(); await loadBusinessChats() } }
        }
    }

    private func loadBusinessChats() async {
        do {
            let rows = try await gateway.action("imessageBusinessChats") as? [[String: String]] ?? []
            businessContacts = rows.compactMap { row in
                guard let recipient = row["recipient"], let name = row["name"] else { return nil }
                return ContactCandidate(id: "business:" + recipient, name: name, addresses: [ContactAddress(id: recipient, label: "Messages for Business", value: recipient, isEmail: false)], profilePhoto: row["profilePhoto"])
            }
            businessError = nil
        } catch { businessError = error.localizedDescription }
    }

    @ViewBuilder private var contactsContent: some View {
        switch directory.status {
        case .idle:
            permissionPanel(title: "Choose from your Contacts", detail: "Connect Contacts to select agents by name. Only contacts you add become part of your squad.", button: "Connect Contacts") {
                Task { await directory.load(requestPermission: true) }
            }
        case .loading:
            ProgressView("Loading Contacts…").frame(maxWidth: .infinity, maxHeight: .infinity)
        case .denied:
            permissionPanel(title: "Allow access to Contacts", detail: "Enable Agent Squad in System Settings → Privacy & Security → Contacts, then return here.", button: "Open Contacts Settings", secondary: ("Check Again", { Task { await directory.load(); await loadBusinessChats() } })) {
                openURL("x-apple.systempreferences:com.apple.preference.security?Privacy_Contacts")
            }
        case .failed:
            permissionPanel(title: "Couldn’t load Contacts", detail: directory.error ?? "Please try again.", button: "Try Again") { Task { await directory.load(); await loadBusinessChats() } }
        case .ready:
            HStack {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Search names, numbers, or emails", text: $query).textFieldStyle(.roundedBorder)
                Button { Task { await directory.load(); await loadBusinessChats() } } label: { Image(systemName: "arrow.clockwise") }.help("Refresh Contacts")
            }
            Toggle("Use +1 for US/Canada numbers without a country code", isOn: $useNANP).font(.caption)
            if visibleContacts.isEmpty {
                Text(directory.contacts.isEmpty ? "No contacts with phone numbers or email addresses were found." : "No matching iMessage contacts.")
                    .foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(visibleContacts) { contact in
                            contactRow(contact)
                            Divider()
                        }
                    }
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            HStack {
                Text("\(numberToAdd) selected").font(.caption).foregroundStyle(.secondary)
                Spacer()
                if !selected.isEmpty { Button("Clear Selection") { selected = [] }.font(.caption) }
            }
            if hasInvalidSelection { Text("Enter a full international number, including + and country code, for the marked contacts.").font(.caption).foregroundStyle(.orange) }
        }
    }

    private func permissionPanel(title: String, detail: String, button: String, secondary: (String, () -> Void)? = nil, action: @escaping () -> Void) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "person.crop.rectangle.stack").font(.system(size: 30)).foregroundStyle(Color.squadGreen)
            Text(title).font(.headline)
            Text(detail).foregroundStyle(.secondary).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
            HStack {
                Button(button, action: action).buttonStyle(.borderedProminent)
                if let secondary { Button(secondary.0, action: secondary.1) }
            }
        }.padding(.vertical, 12).frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func contactRow(_ contact: ContactCandidate) -> some View {
        let added = alreadyAdded(contact)
        let checked = selected.contains(contact.id)
        let addresses = contact.addresses
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Toggle(contact.name, isOn: Binding(get: { checked || added }, set: { enabled in
                    if enabled { selected.insert(contact.id) } else { selected.remove(contact.id) }
                })).toggleStyle(.checkbox).disabled(added)
                Spacer()
                if added { Text("Already added").font(.caption).foregroundStyle(Color.squadGreen) }
            }
            HStack {
                if addresses.count > 1 {
                    Picker("Contact address", selection: Binding(get: { rawRecipient(contact) }, set: { recipients[contact.id] = $0 })) {
                        if !addresses.contains(where: { $0.value == rawRecipient(contact) }) {
                            Text(rawRecipient(contact)).tag(rawRecipient(contact))
                        }
                        ForEach(addresses) { Text("\($0.label): \($0.value)").tag($0.value) }
                    }.labelsHidden().accessibilityLabel("Address for \(contact.name)")
                } else {
                    Text(contact.id.hasPrefix("business:") ? "Messages for Business" : (recipient(contact) ?? rawRecipient(contact))).font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }.padding(.leading, 22)
            if checked && !added && !contact.id.hasPrefix("business:") {
                TextField("Recipient", text: Binding(get: { rawRecipient(contact) }, set: { recipients[contact.id] = $0 }), prompt: Text("+15551234567"))
                    .textFieldStyle(.roundedBorder).accessibilityLabel("Recipient for \(contact.name)").padding(.leading, 22)
                if recipient(contact) == nil { Text("Country code or valid address needed").font(.caption).foregroundStyle(.orange).padding(.leading, 22) }
            }
        }.padding(.vertical, 12)
    }

    private func addSelected() {
        guard !saving, !hasInvalidSelection else { return }
        let contacts = selectedContacts
        saving = true; error = nil
        Task {
            defer { saving = false }
            var failures: [String] = []
            var savedRecipients: Set<String> = []
            for contact in contacts {
                guard let address = recipient(contact) else { continue }
                if alreadyAdded(contact) || savedRecipients.contains(address) { selected.remove(contact.id); continue }
                let id = agentIDs[contact.id] ?? UUID().uuidString
                agentIDs[contact.id] = id
                var agent = SquadAgent(id: id, name: String(contact.name.prefix(100)), adapterType: transport, recipient: address, recipientAliases: Array(Set(contact.addresses.compactMap { ContactCandidate.recipient($0.value, useNANP: useNANP) })).filter { $0 != address })
                agent.profilePhoto = contact.profilePhoto ?? directory.contacts.first(where: { candidate in
                    candidate.addresses.contains { ContactCandidate.recipient($0.value, useNANP: useNANP) == address }
                })?.profilePhoto
                do {
                    try await gateway.action("saveAgent", ["agent": try agent.jsonObject()])
                    savedRecipients.insert(address); selected.remove(contact.id)
                } catch { failures.append("\(contact.name): \(error.localizedDescription)") }
            }
            if failures.isEmpty { dismiss() }
            else { error = "Some agents could not be added. Your other selections were saved.\n" + failures.joined(separator: "\n") }
        }
    }
}
