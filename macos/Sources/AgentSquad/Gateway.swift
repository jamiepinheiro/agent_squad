import AppKit
import Foundation
import Observation

@MainActor @Observable final class Gateway {
    var state: GatewayState?
    var error: String?
    var launchStatus = "Starting your squad…"
    var busy = false
    private var process: Process?
    private var input: Pipe?
    private var baseURL: URL?
    private var token = UUID().uuidString + UUID().uuidString
    private var refreshTask: Task<Void, Never>?
    private var starting = false
    private var startupDiagnostic: String?

    func start() {
        guard process == nil, !starting else { return }
        starting = true
        startupDiagnostic = nil
        let resources = Bundle.main.resourceURL!
        let node = resources.appendingPathComponent("runtime/node")
        let script = resources.appendingPathComponent("gateway/dist/index.js")
        guard FileManager.default.isExecutableFile(atPath: node.path), FileManager.default.fileExists(atPath: script.path) else {
            error = "The bundled gateway is missing. Build the app with scripts/build-app.sh."; starting = false; return
        }
        let child = Process()
        child.executableURL = node
        child.arguments = [script.path]
        child.currentDirectoryURL = resources
        var environment = ProcessInfo.processInfo.environment
        environment["AGENT_SQUAD_CONTROL_TOKEN"] = token
        environment["AGENT_SQUAD_HELPER"] = Bundle.main.executableURL!.path
        environment["AGENT_SQUAD_MANAGED"] = "1"
        environment["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
        child.environment = environment
        let output = Pipe(), errors = Pipe(), input = Pipe()
        self.input = input
        child.standardInput = input; child.standardOutput = output; child.standardError = errors
        child.terminationHandler = { [weak self] process in
            Task { @MainActor in
                guard let self, self.process === process else { return }
                self.process = nil; self.baseURL = nil; self.state = nil; self.starting = false
                self.refreshTask?.cancel()
                self.error = "The gateway stopped (exit \(process.terminationStatus)). Restart it from Settings → MCP." + (self.startupDiagnostic.map { "\n" + $0 } ?? "")
            }
        }
        do { try child.run(); process = child }
        catch { self.error = error.localizedDescription; starting = false; return }
        Task { [weak self, weak child] in
            try? await Task.sleep(for: .seconds(20))
            guard let self, let child, self.process === child, self.baseURL == nil else { return }
            self.stop(); self.starting = false
            self.error = "The gateway did not become ready. Restart it from Settings → MCP."
        }
        // Read the startup handshake off the main thread. Further output is drained.
        Task.detached { [weak self] in
            var buffer = Data()
            while true {
                let chunk = output.fileHandleForReading.availableData
                if chunk.isEmpty { break }
                buffer.append(chunk)
                if let newline = buffer.firstIndex(of: 10) {
                    let line = buffer[..<newline]
                    if let json = try? JSONSerialization.jsonObject(with: Data(line)) as? [String: Any], let port = json["port"] as? Int {
                        await self?.ready(port: port)
                        break
                    }
                    buffer.removeSubrange(...newline)
                }
                if buffer.count > 65536 { break }
            }
            while !output.fileHandleForReading.availableData.isEmpty {}
        }
        Task.detached { [weak self] in
            while true {
                let data = errors.fileHandleForReading.availableData
                if data.isEmpty { break }
                let message = String(decoding: data.prefix(2000), as: UTF8.self)
                await self?.reportStartupError(message)
            }
        }
    }
    private func reportStartupError(_ message: String) { if starting { startupDiagnostic = message } }
    private func ready(port: Int) {
        baseURL = URL(string: "http://127.0.0.1:\(port)")!; starting = false; launchStatus = "Gateway running"
        refreshTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }
    func refresh() async {
        do { state = try JSONDecoder().decode(GatewayState.self, from: await request("api/state")) }
        catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
    private func request(_ path: String, body: [String: Any]? = nil) async throws -> Data {
        guard let baseURL else { throw NSError(domain: "Gateway", code: 1, userInfo: [NSLocalizedDescriptionKey: "The gateway is still starting."]) }
        var request = URLRequest(url: baseURL.appendingPathComponent(path), timeoutInterval: 35)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body { request.httpMethod = "POST"; request.httpBody = try JSONSerialization.data(withJSONObject: body); request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            throw NSError(domain: "Gateway", code: 2, userInfo: [NSLocalizedDescriptionKey: json?["error"] as? String ?? "The gateway request failed."])
        }
        return data
    }
    @discardableResult func action(_ name: String, _ values: [String: Any] = [:]) async throws -> Any? {
        var body = values; body["action"] = name
        let data = try await request("api/action", body: body)
        await refresh()
        return (try JSONSerialization.jsonObject(with: data) as? [String: Any])?["result"]
    }
    func perform(_ name: String, _ values: [String: Any] = [:]) {
        Task { busy = true; defer { busy = false }
            do { try await action(name, values) } catch { self.error = error.localizedDescription }
        }
    }
    func stop() { refreshTask?.cancel(); refreshTask = nil; let child = process; process = nil; try? input?.fileHandleForWriting.close(); input = nil; child?.terminate(); state = nil; baseURL = nil }
    func restart() {
        let previous = process
        stop(); starting = false; error = nil; launchStatus = "Restarting your squad…"
        Task {
            for _ in 0..<100 {
                if previous?.isRunning != true { break }
                try? await Task.sleep(for: .milliseconds(100))
            }
            guard previous?.isRunning != true else {
                error = "The previous gateway is still stopping. Try restarting again shortly."
                return
            }
            start()
        }
    }
    func copy(_ text: String) { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(text, forType: .string) }
}
