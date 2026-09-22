import SwiftUI

/// Desktop extension points. Implementations live beside each surface library.
@MainActor struct NativeSurface: Identifiable {
    let id: String
    let name: String
    let symbol: String
    var usesQuietInterval = true
    let addAgents: (Binding<Bool>) -> AnyView
    var settings: () -> AnyView = { AnyView(EmptyView()) }
    let connection: (Binding<SquadAgent>, Binding<String>, Binding<Bool>) -> AnyView
    var prepareSave: (SquadAgent, String, Gateway) async throws -> Void = { _, _, _ in }
    var refreshPhoto: (SquadAgent, Gateway) async throws -> String? = { agent, gateway in
        try await gateway.action("refreshProfilePhoto", ["agentId": agent.id])
        return nil
    }
    var refreshStatus: () async -> Void = {}
    var isDisconnected: (SquadAgent, GatewayState) -> Bool = { _, _ in false }
    var handle: ([String]) -> Int32? = { _ in nil }
}

func connectionCard<Content: View>(title: String, symbol: String, subtitle: String, @ViewBuilder content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 16) {
        HStack(spacing: 12) {
            Image(systemName: symbol).font(.title2).foregroundStyle(Color.squadGreen)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.headline)
                Text(subtitle).font(.caption).foregroundStyle(.secondary)
            }
        }
        Divider()
        content()
    }.padding(24).frame(maxWidth: .infinity, alignment: .leading).card()
}

/// Opaque connector state. Each surface decodes only the fields it owns.
indirect enum SurfaceValue: Codable {
    case string(String), number(Double), bool(Bool), object([String: SurfaceValue]), array([SurfaceValue]), null
    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() { self = .null }
        else if let x = try? value.decode(Bool.self) { self = .bool(x) }
        else if let x = try? value.decode(String.self) { self = .string(x) }
        else if let x = try? value.decode(Double.self) { self = .number(x) }
        else if let x = try? value.decode([String: SurfaceValue].self) { self = .object(x) }
        else { self = .array(try value.decode([SurfaceValue].self)) }
    }
    func encode(to encoder: Encoder) throws {
        var value = encoder.singleValueContainer()
        switch self {
        case .string(let x): try value.encode(x)
        case .number(let x): try value.encode(x)
        case .bool(let x): try value.encode(x)
        case .object(let x): try value.encode(x)
        case .array(let x): try value.encode(x)
        case .null: try value.encodeNil()
        }
    }
    func decode<T: Decodable>(_ type: T.Type) -> T? {
        guard let data = try? JSONEncoder().encode(self) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }
}
