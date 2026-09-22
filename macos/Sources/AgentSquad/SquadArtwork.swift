import AppKit

/// Bundle artwork is shared by the sidebar, empty state, and menu bar.
enum SquadArtwork {
    static let appIcon: NSImage = {
        guard let url = Bundle.main.url(forResource: "AppIconPreview", withExtension: "png"),
              let image = NSImage(contentsOf: url) else { return NSApp.applicationIconImage }
        return image
    }()
    static let menuIcon: NSImage = {
        let image = Bundle.main.url(forResource: "SquadMenuTemplate", withExtension: "png")
            .flatMap(NSImage.init(contentsOf:)) ?? NSImage(size: NSSize(width: 22, height: 18))
        image.size = NSSize(width: 22, height: 18)
        image.isTemplate = true
        return image
    }()
}
