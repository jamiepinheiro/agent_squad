import SwiftUI

/// The desktop composition root. Add a surface's descriptor here.
@MainActor enum NativeSurfaces {
    static let all: [NativeSurface] = [iMessageSurfaceUI, whatsAppSurfaceUI, a2aSurfaceUI]
    static func find(_ id: String) -> NativeSurface? { all.first { $0.id == id } }
    static func handle(_ arguments: [String]) -> Int32? {
        for surface in all { if let status = surface.handle(arguments) { return status } }
        return nil
    }
}
