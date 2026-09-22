import SwiftUI

@MainActor func refreshIMessagePhoto(_ savedAgent: SquadAgent, gateway: Gateway) async throws -> String? {

    if savedAgent.recipient.lowercased().hasPrefix("urn:biz:") {
        let rows = try await gateway.action("imessageBusinessChats") as? [[String: String]] ?? []
        guard let photo = rows.first(where: { $0["recipient"]?.lowercased() == savedAgent.recipient.lowercased() })?["profilePhoto"] else {
            return "Open this business conversation in Messages to load its logo, then try again."
        }
        try await gateway.action("setContactPhoto", ["agentId": savedAgent.id, "photo": photo])
        
        return "Image refreshed from Messages."
    }
    let directory = ContactDirectory()
    await directory.load(requestPermission: true)
    guard directory.status == .ready else {
        return directory.error ?? "Allow Contacts access in System Settings → Privacy & Security → Contacts."
    }
    let addresses = Set(([savedAgent.recipient] + savedAgent.recipientAliases).map { $0.lowercased() })
    let useNANP = ["US", "CA"].contains(Locale.current.region?.identifier ?? "")
    let photo = directory.contacts.first { contact in
        contact.profilePhoto != nil && contact.addresses.contains {
            guard let value = ContactCandidate.recipient($0.value, useNANP: useNANP) else { return false }
            return addresses.contains(value.lowercased())
        }
    }?.profilePhoto
    guard let photo else { return "No photo found in Contacts." }
    try await gateway.action("setContactPhoto", ["agentId": savedAgent.id, "photo": photo])
    
    return "Image refreshed from Contacts."

}
