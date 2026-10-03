import SwiftUI

struct AddAgentsView: View {
    @State private var transport = NativeSurfaces.all[0].id
    @State private var saving = false
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Add Agents").font(.title2.weight(.semibold))
            HStack(spacing: 4) {
                ForEach(NativeSurfaces.all) { surface in
                    Button { transport = surface.id } label: {
                        Text(surface.name)
                            .font(.callout.weight(.medium))
                            .multilineTextAlignment(.center)
                            .lineLimit(2)
                            .frame(maxWidth: .infinity)
                            .frame(height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .background(transport == surface.id ? Color.squadGreen.opacity(0.2) : .clear,
                                in: RoundedRectangle(cornerRadius: 8))
                    .accessibilityAddTraits(transport == surface.id ? .isSelected : [])
                }
            }
            .padding(4)
            .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
            .fixedSize(horizontal: false, vertical: true)
            NativeSurfaces.find(transport)?.addAgents($saving)
                .id(transport)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .padding(28).frame(width: 740, height: 680, alignment: .topLeading)
        .disabled(saving).interactiveDismissDisabled(saving)
    }
}
