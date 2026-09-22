import AppKit
import SQLite3
import ImageIO

/// Invoked by the bundled gateway in a child copy of this executable.
/// Only the registered one-to-one iMessage conversation is queried.
enum MessagesHelper {
    static func run(_ args: [String]) -> Int32 {
        do {
            let result: [String: Any]
            switch args.first {
            case "--messages-business-chats": result = ["chats": try businessChats()]
            case "--messages-baseline": result = ["cursor": try query(recipient: nil, after: 0).cursor]
            case "--messages-read":
                guard args.count == 3, let after = Int64(args[2]), after >= 0 else { throw problem("Invalid receive cursor.") }
                let data = FileHandle.standardInput.readDataToEndOfFile()
                let aliases = data.isEmpty ? [] : try JSONDecoder().decode([String].self, from: data)
                guard aliases.count <= 30 else { throw problem("Too many reply addresses.") }
                let batch = try query(recipient: args[1], after: after, aliases: aliases)
                result = ["cursor": batch.cursor, "messages": batch.messages]
            case "--messages-send":
                guard args.count == 2 else { throw problem("Missing recipient.") }
                let text = String(decoding: FileHandle.standardInput.readDataToEndOfFile(), as: UTF8.self)
                guard !text.isEmpty, text.count <= 50000 else { throw problem("Invalid message text.") }
                try send(recipient: args[1], text: text); result = ["sent": true]
            default: throw problem("Unknown helper operation.")
            }
            let data = try JSONSerialization.data(withJSONObject: result)
            FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data([10])); return 0
        } catch {
            FileHandle.standardError.write(Data((error.localizedDescription + "\n").utf8)); return 1
        }
    }
    private static func problem(_ text: String) -> NSError { NSError(domain: "Messages", code: 1, userInfo: [NSLocalizedDescriptionKey: text]) }
    private static func literal(_ value: String) -> String { "\"" + value.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"").replacingOccurrences(of: "\r", with: "\\r").replacingOccurrences(of: "\n", with: "\\n") + "\"" }
    static func businessChats() throws -> [[String: String]] {
        var db: OpaquePointer?
        let path = ProcessInfo.processInfo.environment["AGENT_SQUAD_MESSAGES_DB"] ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Messages/chat.db").path
        guard sqlite3_open_v2(path, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
            if db != nil { sqlite3_close(db) }
            throw problem("Allow Full Disk Access in Settings to find business conversations.")
        }
        defer { sqlite3_close(db) }
        sqlite3_busy_timeout(db, 3000)
        let sql = """
        SELECT c.guid, c.chat_identifier, COALESCE(NULLIF(c.display_name,''), 'Business conversation')
        FROM chat c WHERE c.service_name='iMessage' AND c.chat_identifier LIKE 'urn:biz:%'
          AND (SELECT COUNT(*) FROM chat_handle_join j WHERE j.chat_id=c.ROWID)=1
        ORDER BY (SELECT MAX(message_id) FROM chat_message_join m WHERE m.chat_id=c.ROWID) DESC
        """
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else { throw problem("Could not load business conversations.") }
        defer { sqlite3_finalize(statement) }
        var result = [[String: String]]()
        var step = sqlite3_step(statement)
        while step == SQLITE_ROW {
            let value: (Int32) -> String = { sqlite3_column_text(statement, $0).map { String(cString: $0) } ?? "" }
            var row = ["guid": value(0), "recipient": value(1), "name": value(2)]
            row["profilePhoto"] = businessPhoto(recipient: value(1))
            result.append(row)
            step = sqlite3_step(statement)
        }
        guard step == SQLITE_DONE else { throw problem("Could not finish loading business conversations.") }
        return result
    }
    private static func businessPhoto(recipient: String) -> String? {
        guard recipient.lowercased().hasPrefix("urn:biz:"), let id = UUID(uuidString: String(recipient.dropFirst(8))) else { return nil }
        let root = ProcessInfo.processInfo.environment["AGENT_SQUAD_BUSINESS_CONTAINERS"].map { URL(fileURLWithPath: $0) }
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Daemon Containers")
        let containers = (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? []
        for container in containers {
            let folder = container.appendingPathComponent("Data/Library/com.apple.businessservicesd/BrandLogos/" + id.uuidString.lowercased())
            let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey])) ?? []
            for file in files.sorted(by: { ((try? $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast) > ((try? $1.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast) }) {
                guard let size = try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= 5 * 1024 * 1024,
                      let source = CGImageSourceCreateWithURL(file as CFURL, nil),
                      let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
                      let width = properties[kCGImagePropertyPixelWidth] as? Int,
                      let height = properties[kCGImagePropertyPixelHeight] as? Int,
                      width > 0, height > 0, abs(Double(width) / Double(height) - 1) < 0.15,
                      let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: 256] as CFDictionary),
                      let data = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]), data.count <= 512 * 1024 else { continue }
                return "data:image/png;base64," + data.base64EncodedString()
            }
        }
        return nil
    }
    private static func send(recipient: String, text: String) throws {
        let source: String
        if recipient.lowercased().hasPrefix("urn:biz:") {
            guard let chat = try businessChats().first(where: { $0["recipient"]?.lowercased() == recipient.lowercased() }), let guid = chat["guid"] else {
                throw problem("Open this business conversation in Messages on this Mac first.")
            }
            source = """
            tell application "Messages"
                send \(literal(text)) to chat id \(literal(guid))
            end tell
            """
        } else {
        source = """
        tell application "Messages"
            set targetService to first service whose service type = iMessage
            set targetBuddy to buddy \(literal(recipient)) of targetService
            send \(literal(text)) to targetBuddy
        end tell
        """
        }
        var error: NSDictionary?
        guard let script = NSAppleScript(source: source) else { throw problem("Could not prepare Messages automation.") }
        script.executeAndReturnError(&error)
        if let error { throw problem("Messages could not send: \(error[NSAppleScript.errorMessage] ?? "Allow Agent Squad in System Settings → Privacy & Security → Automation.")") }
    }
    private static func query(recipient: String?, after: Int64, aliases: [String] = []) throws -> (cursor: String, messages: [[String: String]]) {
        var db: OpaquePointer?
        let path = ProcessInfo.processInfo.environment["AGENT_SQUAD_MESSAGES_DB"] ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Messages/chat.db").path
        guard sqlite3_open_v2(path, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
            if db != nil { sqlite3_close(db) }
            throw problem("Messages is unavailable. Grant Agent Squad Full Disk Access in System Settings → Privacy & Security, then restart Agent Squad.")
        }
        defer { sqlite3_close(db) }
        sqlite3_busy_timeout(db, 3000)
        var maximum: OpaquePointer?
        guard sqlite3_prepare_v2(db, "SELECT COALESCE(MAX(ROWID), 0) FROM message", -1, &maximum, nil) == SQLITE_OK else { throw problem("Could not read the Messages database.") }
        defer { sqlite3_finalize(maximum) }
        guard sqlite3_step(maximum) == SQLITE_ROW else { throw problem("Messages database is busy. Try again.") }
        let cursor = sqlite3_column_int64(maximum, 0)
        guard let recipient else { return (String(cursor), []) }
        let addresses = Array(Set([recipient] + aliases))
        let placeholders = Array(repeating: "?", count: addresses.count).joined(separator: ",")
        let sql = """
        SELECT DISTINCT m.ROWID, m.guid, m.text, m.attributedBody, m.date
        FROM message m JOIN handle h ON h.ROWID=m.handle_id
        JOIN chat_message_join cm ON cm.message_id=m.ROWID
        WHERE m.ROWID>? AND m.ROWID<=? AND m.is_from_me=0 AND m.service='iMessage'
          AND lower(h.id) IN (\(placeholders)) AND COALESCE(m.associated_message_type,0)=0
          AND (SELECT COUNT(*) FROM chat_handle_join ch WHERE ch.chat_id=cm.chat_id)=1
        ORDER BY m.ROWID ASC
        """
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else { throw problem("This Messages database schema is not supported.") }
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_int64(statement, 1, after); sqlite3_bind_int64(statement, 2, cursor)
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        for (index, address) in addresses.enumerated() { sqlite3_bind_text(statement, Int32(index + 3), address.lowercased(), -1, transient) }
        var messages = [[String: String]]()
        var step = sqlite3_step(statement)
        while step == SQLITE_ROW {
            let id = sqlite3_column_text(statement, 1).map { String(cString: $0) } ?? String(sqlite3_column_int64(statement, 0))
            var text = sqlite3_column_text(statement, 2).map { String(cString: $0) }
            if text == nil, let bytes = sqlite3_column_blob(statement, 3) {
                let data = Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 3)))
                if let attributed = NSUnarchiver.unarchiveObject(with: data) as? NSAttributedString { text = attributed.string }
            }
            if let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                let date = Date(timeIntervalSince1970: Double(sqlite3_column_int64(statement, 4)) / 1_000_000_000 + 978307200)
                messages.append(["id": id, "text": text, "timestamp": ISO8601DateFormatter().string(from: date)])
            }
            step = sqlite3_step(statement)
        }
        guard step == SQLITE_DONE else { throw problem("Could not finish reading Messages. Try again.") }
        return (String(cursor), messages)
    }
}
