// swift-tools-version: 6.0
import PackageDescription
let package = Package(
    name: "AgentSquad", platforms: [.macOS(.v14)],
    products: [.executable(name: "AgentSquad", targets: ["AgentSquad"])],
    targets: [.executableTarget(name: "AgentSquad", path: ".", sources: ["macos/Sources/AgentSquad", "libraries/surfaces/imessage/macos", "libraries/surfaces/whatsapp/macos", "libraries/surfaces/a2a/macos"], linkerSettings: [.linkedLibrary("sqlite3")])],
    swiftLanguageModes: [.v5]
)
