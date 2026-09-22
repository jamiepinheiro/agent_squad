import SwiftUI

struct AddAgentsView: View {
    @State private var transport = NativeSurfaces.all[0].id
    @State private var saving = false
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Add Agents").font(.title2.weight(.semibold))
            Picker("Connect through", selection: $transport) {
                ForEach(NativeSurfaces.all) { Text($0.name).tag($0.id) }
            }.pickerStyle(.segmented)
            NativeSurfaces.find(transport)?.addAgents($saving)
        }
        .padding(28).frame(width: 650, height: 680)
        .disabled(saving).interactiveDismissDisabled(saving)
    }
}
