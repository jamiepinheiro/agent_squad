import Foundation

struct ContactAddress: Identifiable, Sendable {
    var id: String
    var label: String
    var value: String
    var isEmail: Bool
}

struct ContactCandidate: Identifiable, Sendable {
    var id: String
    var name: String
    var addresses: [ContactAddress]
    var profilePhoto: String? = nil

    /// Never guess international country codes or discard extensions.
    static func recipient(_ value: String, useNANP: Bool) -> String? {
        let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.range(of: #"^urn:biz:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"#, options: [.regularExpression, .caseInsensitive]) != nil { return text.lowercased() }
        if text.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) != nil {
            return text.lowercased()
        }
        let punctuation = CharacterSet(charactersIn: " ()-.\u{00a0}\u{202f}")
        var number = String(text.unicodeScalars.filter { !punctuation.contains($0) })
        if useNANP, number.range(of: #"^[2-9][0-9]{2}[2-9][0-9]{6}$"#, options: .regularExpression) != nil {
            number = "+1" + number
        } else if useNANP, number.range(of: #"^1[2-9][0-9]{2}[2-9][0-9]{6}$"#, options: .regularExpression) != nil {
            number = "+" + number
        }
        return number.range(of: #"^\+[1-9][0-9]{6,14}$"#, options: .regularExpression) == nil ? nil : number
    }
}
