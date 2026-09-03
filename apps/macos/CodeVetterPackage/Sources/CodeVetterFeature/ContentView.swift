import SwiftUI

public struct ContentView: View {
  @State private var model = WorkbenchModel()

  public var body: some View {
    EvidenceWorkbenchView(model: model)
  }

  public init() {}
}
