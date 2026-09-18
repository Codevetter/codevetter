import Foundation

extension WorkbenchModel {
  func refreshSelectedSettings() {
    switch settingsSection {
    case .mcp: loadMcpSettings()
    case .usage: loadHistoryRoots()
    case .rubrics: loadRubrics()
    case .memories: loadMemories()
    case .ops: loadOpsStatus()
    case .capabilities: break
    default: loadNativeSettings()
    }
  }

  var selectedSettingsLoading: Bool {
    switch settingsSection {
    case .mcp: mcpLoading
    case .usage: historyRootsLoading
    case .rubrics: rubricLoading
    case .memories: memoryLoading
    case .ops: opsLoading
    case .capabilities: false
    default: settingsLoading
    }
  }

  var selectedSettingsIssue: String? {
    switch settingsSection {
    case .mcp: mcpIssue
    case .usage: historyRootsIssue
    case .rubrics: rubricIssue
    case .memories: memoryIssue
    case .ops: opsIssue
    case .capabilities: registryIssue
    default: settingsIssue
    }
  }
}
