import Foundation
import Security

enum Keychain {
    private static let service = "com.jamiepinheiro.agentsquad.credentials"
    private static let legacyService = "com.agentsquad.credentials"
    static func save(_ value: String, account: String) throws {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                   kSecAttrService as String: service,
                                   kSecAttrAccount as String: account]
        let data = Data(value.utf8)
        let update = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        var status = update
        if update == errSecItemNotFound {
            var item = query
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status = SecItemAdd(item as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw NSError(domain: "Keychain", code: Int(status), userInfo: [NSLocalizedDescriptionKey: "Could not save this credential to Keychain (\(status))."]) }
    }
    static func read(account: String) throws -> String? {
        if let value = try read(account: account, service: service) { return value }
        guard let value = try read(account: account, service: legacyService) else { return nil }
        try save(value, account: account)
        return value
    }
    private static func read(account: String, service: String) throws -> String? {
        var result: CFTypeRef?
        let status = SecItemCopyMatching([kSecClass: kSecClassGenericPassword,
            kSecAttrService: service, kSecAttrAccount: account,
            kSecReturnData: true, kSecMatchLimit: kSecMatchLimitOne] as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw NSError(domain: "Keychain", code: Int(status), userInfo: [NSLocalizedDescriptionKey: "Could not read credential from Keychain."])
        }
        return String(data: data, encoding: .utf8)
    }
    static func delete(account: String) {
        for service in [service, legacyService] {
        SecItemDelete([kSecClass: kSecClassGenericPassword, kSecAttrService: service, kSecAttrAccount: account] as CFDictionary)
        }
    }
}
