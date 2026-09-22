import SwiftUI

struct AgentAvatar: View {
    var agent: SquadAgent
    var size: CGFloat = 44
    @State private var image: NSImage?
    var body: some View {
        Group {
            if let image {
                Image(nsImage: image).resizable().scaledToFill()
            } else {
                Image(systemName: agent.symbol).font(.title2).foregroundStyle(Color.squadGreen)
                    .frame(width: size, height: size).background(Color.squadMint.opacity(0.6))
            }
        }
        .frame(width: size, height: size).clipShape(RoundedRectangle(cornerRadius: size * 0.28))
        .accessibilityHidden(true)
        .task(id: agent.profilePhoto) {
            image = agent.profilePhoto.flatMap { photo in
                guard let comma = photo.firstIndex(of: ","), let data = Data(base64Encoded: String(photo[photo.index(after: comma)...])) else { return nil }
                return NSImage(data: data)
            }
        }
    }
}
