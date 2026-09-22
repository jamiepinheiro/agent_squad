import Contacts
import AppKit
import Observation

@MainActor @Observable final class ContactDirectory {
    enum Status { case idle, loading, ready, denied, failed }
    var status: Status = .idle
    var contacts: [ContactCandidate] = []
    var error: String?

    func load(requestPermission: Bool = false) async {
        guard status != .loading else { return }
        let authorization = CNContactStore.authorizationStatus(for: .contacts)
        if authorization == .notDetermined && !requestPermission { return }
        status = .loading
        error = nil
        do {
            if authorization == .notDetermined {
                guard try await CNContactStore().requestAccess(for: .contacts) else {
                    contacts = []; status = .denied; return
                }
            } else if authorization == .denied || authorization == .restricted {
                contacts = []; status = .denied; return
            }
            contacts = try await Task.detached(priority: .userInitiated) {
                let store = CNContactStore()
                let request = CNContactFetchRequest(keysToFetch: [
                    CNContactIdentifierKey as CNKeyDescriptor,
                    CNContactFormatter.descriptorForRequiredKeys(for: .fullName),
                    CNContactOrganizationNameKey as CNKeyDescriptor,
                    CNContactPhoneNumbersKey as CNKeyDescriptor,
                    CNContactEmailAddressesKey as CNKeyDescriptor,
                    CNContactThumbnailImageDataKey as CNKeyDescriptor
                ])
                request.sortOrder = .userDefault
                var result: [ContactCandidate] = []
                try store.enumerateContacts(with: request) { contact, _ in
                    var addresses = contact.phoneNumbers.map {
                        ContactAddress(id: $0.identifier, label: $0.label.map { CNLabeledValue<CNPhoneNumber>.localizedString(forLabel: $0) } ?? "Phone", value: $0.value.stringValue, isEmail: false)
                    }
                    addresses += contact.emailAddresses.map {
                        ContactAddress(id: $0.identifier, label: $0.label.map { CNLabeledValue<NSString>.localizedString(forLabel: $0) } ?? "Email", value: String($0.value), isEmail: true)
                    }
                    guard !addresses.isEmpty else { return }
                    let name = CNContactFormatter.string(from: contact, style: .fullName) ?? contact.organizationName
                    result.append(ContactCandidate(id: contact.identifier, name: name.isEmpty ? addresses[0].value : name, addresses: addresses, profilePhoto: contact.thumbnailImageData.flatMap { data in
                        guard let bitmap = NSBitmapImageRep(data: data), let jpeg = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.85]), jpeg.count <= 512 * 1024 else { return nil }
                        return "data:image/jpeg;base64," + jpeg.base64EncodedString()
                    }))
                }
                return result
            }.value
            status = .ready
        } catch {
            contacts = []
            self.error = error.localizedDescription
            status = .failed
        }
    }
}
