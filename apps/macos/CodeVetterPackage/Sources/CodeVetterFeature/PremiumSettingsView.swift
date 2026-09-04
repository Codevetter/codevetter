import AppKit
import SwiftUI
import UniformTypeIdentifiers

struct PremiumSettingsView: View {
  @Bindable var model: WorkbenchModel
  @State private var copiedMcpValue: String?
  @State private var confirmingAuditClear = false
  @State private var confirmingRetentionApply = false
  @State private var confirmingRetentionVacuum = false
  @State private var retentionAgeDays = "90"
  @State private var retentionMaxMiB = "2048"
  @State private var expandedRubricID: String?
  @State private var creatingRubric = false
  @State private var showsCapabilityGlossary = false
  @State private var newRubricName = ""
  @State private var newRubricFocus = ""
  @State private var newRubricChecks = ""
  @State private var memorySourceQuery = ""
  @State private var memoryContentQuery = ""
  @State private var copiedMemory = false

  var body: some View {
    VStack(spacing: 0) {
      header
      Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
      HStack(spacing: 0) {
        sectionRail
          .frame(width: 230)
        Rectangle().fill(EvidenceStyle.separator).frame(width: 1)
        settingsDesk
      }
    }
    .background(EvidenceStyle.canvas)
    .fileImporter(
      isPresented: $model.choosingRepository,
      allowedContentTypes: [.folder],
      allowsMultipleSelection: false
    ) { result in
      guard case .success(let urls) = result, let url = urls.first else { return }
      model.selectRepository(url)
      if model.settingsSection == .mcp { model.loadMcpSettings() }
    }
    .fileImporter(
      isPresented: $model.choosingHistoryRoot,
      allowedContentTypes: [.folder],
      allowsMultipleSelection: false
    ) { result in
      guard case .success(let urls) = result, let url = urls.first else { return }
      model.addHistoryRoot(url)
    }
    .task(id: model.settingsSection) {
      if model.settingsSection == .mcp, !model.repositoryPath.isEmpty,
        model.mcpSettingsReceipt == nil
      {
        model.loadMcpSettings()
      } else if model.settingsSection == .rubrics, model.rubricReceipt == nil {
        model.loadRubrics()
      } else if model.settingsSection == .usage, model.historyRootsReceipt == nil {
        model.loadHistoryRoots()
      } else if model.settingsSection == .memories, model.memoryReceipt == nil {
        model.loadMemories()
      } else if model.settingsSection == .ops, model.opsReceipt == nil {
        model.loadOpsStatus()
      }
    }
    .confirmationDialog(
      "Clear bounded MCP access metadata?",
      isPresented: $confirmingAuditClear,
      titleVisibility: .visible
    ) {
      Button("Clear access audit", role: .destructive) {
        model.runMcpSettings(operation: .clearAudit)
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text(
        "This removes operational access rows only. It does not change repository evidence or MCP enablement."
      )
    }
    .confirmationDialog(
      "Apply this exact retention plan?",
      isPresented: $confirmingRetentionApply,
      titleVisibility: .visible
    ) {
      Button("Apply reviewed plan", role: .destructive) {
        model.applyReviewedRetentionPlan()
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text(retentionApplyConfirmation)
    }
    .confirmationDialog(
      "Checkpoint and compact the local archive?",
      isPresented: $confirmingRetentionVacuum,
      titleVisibility: .visible
    ) {
      Button("Checkpoint + VACUUM", role: .destructive) {
        model.checkpointSessionArchive(vacuum: true)
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text(
        "VACUUM rewrites the local SQLite archive after checkpointing. It does not remove provider transcripts or apply a retention plan."
      )
    }
  }

  private var header: some View {
    PremiumPageHeader(
      eyebrow: "Local control plane",
      title: "Settings",
      subtitle: "Rust-persisted preferences with a deliberately non-secret native projection"
    ) {
      if model.settingsSection == .capabilities {
        StatusPill(label: "Bundled registry", color: EvidenceStyle.success)
      } else {
        StatusPill(
          label: model.opsLoading
            ? "Reading aggregates"
            : (model.settingsLoading ? "Reading preferences" : "Secrets excluded"),
          color: (model.settingsIssue == nil && model.opsIssue == nil)
            ? EvidenceStyle.success : EvidenceStyle.warning
        )
        Button {
          if model.settingsSection == .ops {
            model.loadOpsStatus()
          } else {
            model.loadNativeSettings()
          }
        } label: {
          Label("Refresh", systemImage: "arrow.clockwise")
        }
        .buttonStyle(.bordered)
        .disabled(model.settingsLoading || model.opsLoading)
        .accessibilityLabel(
          model.settingsSection == .ops
            ? "Refresh operational evidence" : "Refresh native settings"
        )
      }
    }
  }

  private var sectionRail: some View {
    VStack(alignment: .leading, spacing: 0) {
      PremiumFieldLabel("SETTINGS SECTIONS")
        .padding(16)
      Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 14) {
          ForEach(Array(settingsGroups.enumerated()), id: \.offset) { _, group in
            VStack(alignment: .leading, spacing: 4) {
              Text(group.0.uppercased())
                .font(.system(size: 8, weight: .bold, design: .monospaced))
                .tracking(0.8)
                .foregroundStyle(.tertiary)
                .padding(.horizontal, 12)
              ForEach(group.1) { section in
                Button {
                  model.settingsSection = section
                } label: {
                  HStack(spacing: 10) {
                    Image(systemName: section.systemImage)
                      .frame(width: 18)
                      .foregroundStyle(
                        model.settingsSection == section
                          ? EvidenceStyle.amberForeground : Color.secondary)
                    Text(section.label).font(.system(size: 10, weight: .semibold))
                    Spacer()
                    if !settings(in: section).isEmpty {
                      Text("\(settings(in: section).count)")
                        .font(.system(size: 8, design: .monospaced))
                        .foregroundStyle(.secondary)
                    }
                  }
                  .padding(.horizontal, 12)
                  .premiumHitTarget(minHeight: PremiumPageLayout.navigationControlHeight)
                  .background(
                    model.settingsSection == section
                      ? Color.primary.opacity(0.035) : Color.clear
                  )
                  .overlay(alignment: .leading) {
                    if model.settingsSection == section {
                      Rectangle()
                        .fill(EvidenceStyle.amberForeground)
                        .frame(width: 2)
                    }
                  }
                }
                .buttonStyle(.plain)
                .accessibilityLabel(section.label)
                .accessibilityIdentifier("settings-section-\(section.rawValue)")
                .accessibilityValue(model.settingsSection == section ? "Selected" : "")
                .accessibilityAddTraits(model.settingsSection == section ? .isSelected : [])
                .accessibilityRemoveTraits(model.settingsSection == section ? [] : .isSelected)
              }
            }
          }
        }
        .padding(10)
      }
      Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
      VStack(alignment: .leading, spacing: 6) {
        Label("Rust owns persistence", systemImage: "lock.shield.fill")
          .foregroundStyle(EvidenceStyle.success)
        Text(
          "Swift receives declared values only. Credentials and provider tokens never enter this receipt."
        )
        .foregroundStyle(.secondary)
      }
      .font(.system(size: 8))
      .padding(14)
    }
    .background(EvidenceStyle.inspector)
  }

  private var settingsGroups: [(String, [NativeSettingsSection])] {
    [
      ("Product", [.general, .appearance, .notifications, .usage]),
      ("Agents", [.agents, .agentIsland, .rubrics, .memories]),
      ("Connections", [.integrations, .capabilities, .mcp]),
      ("System", [.ops, .about]),
    ]
  }

  @ViewBuilder
  private var settingsDesk: some View {
    if model.settingsLoading, model.settingsReceipt == nil,
      ![NativeSettingsSection.capabilities, .mcp, .usage, .rubrics, .memories, .ops, .about]
        .contains(
          model.settingsSection)
    {
      VStack(spacing: 12) {
        ProgressView().controlSize(.small).tint(EvidenceStyle.amber)
        Text("Opening declared settings…").font(.system(size: 12, weight: .medium))
        Text("No credential value is requested by this projection.")
          .font(.system(size: 9))
          .foregroundStyle(.secondary)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    } else {
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 14) {
          sectionHeader
          if let issue = model.settingsIssue {
            Label(issue, systemImage: "exclamationmark.triangle.fill")
              .font(.system(size: 10))
              .foregroundStyle(EvidenceStyle.warning)
              .padding(14)
              .frame(maxWidth: .infinity, alignment: .leading)
              .background(
                EvidenceStyle.warning.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
          }
          if model.settingsSection == .capabilities {
            capabilitiesPanel
          } else if model.settingsSection == .mcp {
            mcpPanel
          } else if model.settingsSection == .usage {
            usagePanel
          } else if model.settingsSection == .rubrics {
            rubricPanel
          } else if model.settingsSection == .memories {
            memoryPanel
          } else if model.settingsSection == .agentIsland {
            agentIslandPanel
          } else if model.settingsSection == .ops {
            opsPanel
          } else if model.settingsSection == .about {
            aboutPanel
          } else if settings(in: model.settingsSection).isEmpty {
            transferredSurface
          } else {
            VStack(spacing: 0) {
              ForEach(Array(settings(in: model.settingsSection).enumerated()), id: \.element.id) {
                index, setting in
                NativeSettingRow(
                  setting: setting,
                  saving: model.settingsSavingKeys.contains(setting.key),
                  save: { model.saveNativeSetting(key: setting.key, value: $0) }
                )
                if index < settings(in: model.settingsSection).count - 1 {
                  Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
                }
              }
            }
            .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 14))
            .overlay { RoundedRectangle(cornerRadius: 14).stroke(EvidenceStyle.separator) }
          }
          projectionBoundary
        }
        .padding(22)
        .frame(maxWidth: 820, alignment: .leading)
      }
    }
  }

  private var sectionHeader: some View {
    HStack(alignment: .top) {
      VStack(alignment: .leading, spacing: 5) {
        PremiumFieldLabel(model.settingsSection.rawValue.uppercased())
        Text(model.settingsSection.label).font(.system(size: 22, weight: .semibold))
        Text(sectionDescription)
          .font(.system(size: 10))
          .foregroundStyle(.secondary)
      }
      Spacer()
      Text(sectionStatusLabel)
        .font(.system(size: 8, weight: .bold, design: .monospaced))
        .foregroundStyle(sectionStatusColor)
    }
  }

  private var transferredSurface: some View {
    VStack(alignment: .leading, spacing: 14) {
      Label(transferTitle, systemImage: model.settingsSection.systemImage)
        .font(.system(size: 14, weight: .semibold))
      Text(transferDetail)
        .font(.system(size: 10))
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
      HStack(spacing: 8) {
        StatusPill(label: "Incumbent authority retained", color: EvidenceStyle.warning)
        Text("No preference, credential, or destructive action is silently substituted.")
          .font(.system(size: 8))
          .foregroundStyle(.secondary)
      }
    }
    .padding(18)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 14))
    .overlay { RoundedRectangle(cornerRadius: 14).stroke(EvidenceStyle.separator) }
  }

  private var capabilitiesPanel: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack {
        Label("One authority registry", systemImage: "point.3.connected.trianglepath.dotted")
          .font(.system(size: 11, weight: .semibold))
        Spacer()
        Text(model.registry.schemaVersion)
          .font(.system(size: 8, weight: .semibold, design: .monospaced))
          .foregroundStyle(.secondary)
          .padding(.horizontal, 9)
          .frame(height: 25)
          .background(EvidenceStyle.inspector, in: Capsule())
          .overlay { Capsule().stroke(EvidenceStyle.separator) }
      }

      if let capability = model.selectedCapability {
        VStack(alignment: .leading, spacing: 10) {
          HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
              Text(capability.name).font(.system(size: 16, weight: .semibold))
              Text(capability.purpose)
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
            }
            Spacer()
            StatusPill(
              label: capability.qualification.rawValue,
              color: capability.qualification.rawValue == "qualified"
                ? EvidenceStyle.success : EvidenceStyle.warning
            )
          }
          HStack(spacing: 8) {
            settingsMetric("STAGE", capability.stage.rawValue.capitalized)
            settingsMetric("TOOLS", capability.underlyingTools.count.formatted())
          }
          Label(capability.dataBoundary, systemImage: "lock.shield")
            .font(.system(size: 9))
            .foregroundStyle(.secondary)
            .lineLimit(2)
          DisclosureGroup("Tools, limitations, and next step") {
            VStack(alignment: .leading, spacing: 12) {
              CapabilityInspector(capability: capability)
            }
            .padding(.top, 10)
          }
          .font(.system(size: 10, weight: .semibold))
          .tint(EvidenceStyle.amberForeground)
        }
        .padding(16)
        .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 12))
        .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }
      }

      DisclosureGroup("Browse capability glossary", isExpanded: $showsCapabilityGlossary) {
        CapabilityCatalogView(model: model, showsHeader: false)
          .frame(maxWidth: .infinity, alignment: .topLeading)
          .padding(.top, 10)
      }
      .font(.system(size: 10, weight: .semibold))
      .tint(EvidenceStyle.amberForeground)
    }
    .padding(18)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 14))
    .overlay { RoundedRectangle(cornerRadius: 14).stroke(EvidenceStyle.separator) }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("settings-capabilities")
  }

  private var agentIslandPanel: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack(alignment: .center, spacing: 18) {
        VStack(alignment: .leading, spacing: 7) {
          PremiumFieldLabel("PRESENTATION CONTRACT")
          Text("A calm status surface, not another agent runtime")
            .font(.system(size: 15, weight: .semibold))
          Text(
            "These preferences are shared with the retained supervised helper. The new Evidence Workbench does not yet launch it, read transcripts, or action provider requests."
          )
          .font(.system(size: 9))
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
          HStack(spacing: 7) {
            StatusPill(
              label: agentIslandEnabled ? "Preference enabled" : "Off by default",
              color: agentIslandEnabled ? EvidenceStyle.success : EvidenceStyle.warning
            )
            StatusPill(label: "Runtime transfer pending", color: EvidenceStyle.warning)
          }
        }
        Spacer(minLength: 18)
        VStack(spacing: 8) {
          HStack(spacing: 7) {
            Circle().fill(EvidenceStyle.amber).frame(width: 7, height: 7)
            Text("CODEX · REVIEW READY")
              .font(.system(size: 8, weight: .bold, design: .monospaced))
              .foregroundStyle(Color.white.opacity(0.86))
            Text("+2")
              .font(.system(size: 8, weight: .bold, design: .monospaced))
              .foregroundStyle(EvidenceStyle.amber)
          }
          .padding(.horizontal, 13)
          .frame(height: 30)
          .background(Color.black, in: Capsule())
          .overlay { Capsule().stroke(EvidenceStyle.amber.opacity(0.32)) }
          Text("Non-activating preview · no live session content")
            .font(.system(size: 7, design: .monospaced))
            .foregroundStyle(.secondary)
        }
      }
      .padding(18)
      .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 14))
      .overlay { RoundedRectangle(cornerRadius: 14).stroke(EvidenceStyle.separator) }

      VStack(spacing: 0) {
        ForEach(Array(settings(in: .agentIsland).enumerated()), id: \.element.id) {
          index, setting in
          NativeSettingRow(
            setting: setting,
            saving: model.settingsSavingKeys.contains(setting.key),
            save: { model.saveNativeSetting(key: setting.key, value: $0) }
          )
          if index < settings(in: .agentIsland).count - 1 {
            Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
          }
        }
      }
      .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 14))
      .overlay { RoundedRectangle(cornerRadius: 14).stroke(EvidenceStyle.separator) }

      HStack(alignment: .top, spacing: 10) {
        Image(systemName: "lock.shield.fill").foregroundStyle(EvidenceStyle.success)
        Text(
          "Swift receives preference labels and values only. Session identities, prompts, output, commands, paths, provider responses, and credentials are excluded from this settings receipt."
        )
        .font(.system(size: 9))
        .foregroundStyle(.secondary)
      }
      .padding(.horizontal, 4)
    }
  }

  private var usagePanel: some View {
    VStack(alignment: .leading, spacing: 14) {
      historyRootsPanel
      retentionPanel
    }
  }

  private var opsPanel: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack(alignment: .top, spacing: 18) {
        VStack(alignment: .leading, spacing: 7) {
          PremiumFieldLabel("READ-ONLY OPERATIONS RECEIPT")
          Text("Operational evidence without credential exposure")
            .font(.system(size: 15, weight: .semibold))
          Text(
            "Rust reads aggregate local evidence and configuration presence. This path never fetches a provider invoice, returns a key or endpoint, or sends a webhook."
          )
          .font(.system(size: 9))
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
        }
        Spacer(minLength: 12)
        StatusPill(
          label: model.opsReceipt?.databaseAvailable == true ? "LOCAL EVIDENCE" : "NO LOCAL STORE",
          color: model.opsReceipt?.databaseAvailable == true
            ? EvidenceStyle.success : EvidenceStyle.warning
        )
      }
      .padding(18)
      .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 14))
      .overlay { RoundedRectangle(cornerRadius: 14).stroke(EvidenceStyle.separator) }

      HStack(spacing: 7) {
        PremiumFieldLabel("AGGREGATE WINDOW")
        Spacer()
        ForEach([7, 30, 90], id: \.self) { days in
          Button {
            model.loadOpsStatus(windowDays: days)
          } label: {
            Text("\(days)d")
              .font(.system(size: 9, weight: .semibold, design: .monospaced))
              .padding(.horizontal, 10)
              .frame(height: 26)
              .foregroundStyle(
                model.opsWindowDays == days ? EvidenceStyle.amberForeground : .secondary
              )
              .background(
                model.opsWindowDays == days ? EvidenceStyle.amber.opacity(0.12) : Color.clear,
                in: RoundedRectangle(cornerRadius: 7)
              )
              .overlay {
                RoundedRectangle(cornerRadius: 7).stroke(
                  model.opsWindowDays == days
                    ? EvidenceStyle.amber.opacity(0.35) : EvidenceStyle.separator)
              }
          }
          .buttonStyle(.plain)
          .disabled(model.opsLoading)
          .accessibilityLabel("Show \(days) day operational evidence")
        }
      }

      if model.opsLoading, model.opsReceipt == nil {
        HStack(spacing: 10) {
          ProgressView().controlSize(.small).tint(EvidenceStyle.amber)
          Text("Reading bounded local aggregates…")
            .font(.system(size: 10, weight: .medium))
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 14))
      } else if let issue = model.opsIssue, model.opsReceipt == nil {
        Label(issue, systemImage: "exclamationmark.triangle.fill")
          .font(.system(size: 10))
          .foregroundStyle(EvidenceStyle.warning)
          .padding(18)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 14))
      } else if let receipt = model.opsReceipt {
        HStack(spacing: 10) {
          settingsMetric(
            "ANTHROPIC BILLING",
            receipt.billing.anthropicConfigured ? "Configured" : "Not configured")
          settingsMetric(
            "OPENAI BILLING",
            receipt.billing.openaiConfigured ? "Configured" : "Not configured")
          settingsMetric(
            "WEBHOOK",
            receipt.webhook.configured ? "Configured · \(receipt.webhook.flavor)" : "Not configured"
          )
        }

        VStack(spacing: 0) {
          HStack(spacing: 10) {
            PremiumFieldLabel("TASK TYPE").frame(maxWidth: .infinity, alignment: .leading)
            PremiumFieldLabel("SESSIONS").frame(width: 62, alignment: .trailing)
            PremiumFieldLabel("SUCCESS").frame(width: 62, alignment: .trailing)
            PremiumFieldLabel("FAIL").frame(width: 52, alignment: .trailing)
            PremiumFieldLabel("RATE").frame(width: 58, alignment: .trailing)
            PremiumFieldLabel("P50").frame(width: 62, alignment: .trailing)
            PremiumFieldLabel("P95").frame(width: 62, alignment: .trailing)
          }
          .padding(.horizontal, 14)
          .frame(height: 34)
          .background(EvidenceStyle.inspector)

          if receipt.observability.isEmpty {
            Text("No stored operational rows in this window.")
              .font(.system(size: 10))
              .foregroundStyle(.secondary)
              .padding(18)
              .frame(maxWidth: .infinity, alignment: .leading)
          } else {
            ForEach(Array(receipt.observability.enumerated()), id: \.element.id) { index, row in
              HStack(spacing: 10) {
                Text(row.taskType)
                  .font(.system(size: 10, weight: .semibold, design: .monospaced))
                  .frame(maxWidth: .infinity, alignment: .leading)
                Text(row.sessionCount.formatted()).frame(width: 62, alignment: .trailing)
                Text(row.successCount.formatted())
                  .foregroundStyle(EvidenceStyle.success)
                  .frame(width: 62, alignment: .trailing)
                Text(row.failureCount.formatted())
                  .foregroundStyle(row.failureCount > 0 ? EvidenceStyle.failure : .secondary)
                  .frame(width: 52, alignment: .trailing)
                Text("\(row.successRatePercent, specifier: "%.1f")%")
                  .frame(width: 58, alignment: .trailing)
                Text(opsDuration(row.medianDurationSeconds)).frame(width: 62, alignment: .trailing)
                Text(opsDuration(row.p95DurationSeconds)).frame(width: 62, alignment: .trailing)
              }
              .font(.system(size: 9, design: .monospaced))
              .padding(.horizontal, 14)
              .frame(height: 38)
              if index < receipt.observability.count - 1 {
                Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
              }
            }
          }
        }
        .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 14))
        .overlay { RoundedRectangle(cornerRadius: 14).stroke(EvidenceStyle.separator) }

        VStack(alignment: .leading, spacing: 6) {
          PremiumFieldLabel("AUTHORITY HELD BACK")
          ForEach(receipt.limitations, id: \.self) { limitation in
            Label(limitation, systemImage: "lock.fill")
              .font(.system(size: 8))
              .foregroundStyle(.secondary)
          }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 12))
      }
    }
  }

  private var memoryPanel: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 8) {
        StatusPill(
          label: "\(model.memoryReceipt?.sources.filter(\.readable).count ?? 0) readable",
          color: EvidenceStyle.success
        )
        if let checked = model.memoryReceipt?.candidateLocationsChecked {
          Text("\(checked) known locations checked")
            .font(.system(size: 8, design: .monospaced))
            .foregroundStyle(.secondary)
        }
        if model.memoryReceipt?.limits.sourcesTruncated == true {
          StatusPill(label: "Catalog bounded", color: EvidenceStyle.warning)
        }
        Spacer()
        Button {
          model.loadMemories()
        } label: {
          Label("Refresh", systemImage: "arrow.clockwise")
        }
        .buttonStyle(.bordered)
        .disabled(model.memoryLoading)
      }

      if let issue = model.memoryIssue {
        Label(issue, systemImage: "exclamationmark.triangle.fill")
          .font(.system(size: 10))
          .foregroundStyle(EvidenceStyle.warning)
          .padding(12)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(EvidenceStyle.warning.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
      }

      HStack(alignment: .top, spacing: 12) {
        VStack(alignment: .leading, spacing: 10) {
          Label("SOURCE CATALOG", systemImage: "memorychip")
            .font(.system(size: 9, weight: .bold, design: .monospaced))
            .foregroundStyle(EvidenceStyle.amberForeground)
          TextField("Filter sources", text: $memorySourceQuery)
            .textFieldStyle(.roundedBorder)
            .font(.system(size: 10))

          ScrollView {
            LazyVStack(spacing: 6) {
              ForEach(filteredMemorySources) { source in
                Button {
                  guard source.readable else { return }
                  memoryContentQuery = ""
                  model.selectMemorySource(source.id)
                } label: {
                  VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 7) {
                      Circle()
                        .fill(
                          source.readable ? EvidenceStyle.success : Color.secondary.opacity(0.4)
                        )
                        .frame(width: 6, height: 6)
                      Text(source.label)
                        .font(.system(size: 10, weight: .semibold))
                        .lineLimit(1)
                      Spacer()
                      Text(source.tool.uppercased())
                        .font(.system(size: 7, weight: .bold, design: .monospaced))
                        .foregroundStyle(.secondary)
                    }
                    Text(source.displayPath)
                      .font(.system(size: 8, design: .monospaced))
                      .foregroundStyle(.secondary)
                      .lineLimit(1)
                    Text(source.preview.isEmpty ? source.note : source.preview)
                      .font(.system(size: 8))
                      .foregroundStyle(.secondary)
                      .lineLimit(2)
                  }
                  .padding(10)
                  .frame(maxWidth: .infinity, alignment: .leading)
                  .background(
                    model.selectedMemorySourceID == source.id
                      ? EvidenceStyle.amber.opacity(0.09) : EvidenceStyle.inspector,
                    in: RoundedRectangle(cornerRadius: 9)
                  )
                  .overlay {
                    RoundedRectangle(cornerRadius: 9).stroke(
                      model.selectedMemorySourceID == source.id
                        ? EvidenceStyle.amber.opacity(0.35) : EvidenceStyle.separator)
                  }
                }
                .buttonStyle(.plain)
                .disabled(!source.readable)
                .accessibilityLabel("\(source.label), \(source.tool)")
              }
            }
          }
          .frame(height: 390)
        }
        .padding(12)
        .frame(width: 270, alignment: .topLeading)
        .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 12))
        .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }

        memoryDocumentPanel
      }

      Label(
        "Rust admits only known sources, emits opaque identities and display paths, redacts secret-like lines, and caps one read at 512 KiB / 120,000 characters.",
        systemImage: "lock.shield.fill"
      )
      .font(.system(size: 9))
      .foregroundStyle(.secondary)
      .padding(12)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 10))
    }
  }

  private var memoryDocumentPanel: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 8) {
        VStack(alignment: .leading, spacing: 2) {
          Text(selectedMemorySource?.label ?? "Select a memory source")
            .font(.system(size: 12, weight: .semibold))
          if let selectedMemorySource {
            Text(
              [
                selectedMemorySource.sourceKind,
                memoryByteLabel(selectedMemorySource.fileSizeBytes),
              ]
              .filter { !$0.isEmpty }.joined(separator: " · ")
            )
            .font(.system(size: 8, design: .monospaced))
            .foregroundStyle(.secondary)
          }
        }
        Spacer()
        if model.memoryDiff != nil {
          Button("Document") { model.showSelectedMemoryDocument() }
            .buttonStyle(.bordered)
        } else {
          Button("Git diff") { model.loadSelectedMemoryDiff() }
            .buttonStyle(.bordered)
            .disabled(model.selectedMemorySourceID == nil || model.memoryLoading)
        }
        Button(copiedMemory ? "Copied" : "Copy") {
          copyToPasteboard(memoryVisibleText)
          copiedMemory = true
          Task { @MainActor in
            try? await Task.sleep(for: .seconds(1.2))
            copiedMemory = false
          }
        }
        .buttonStyle(PremiumPrimaryButtonStyle())
        .disabled(memoryVisibleText.isEmpty)
      }

      TextField("Filter lines or /regular expression/", text: $memoryContentQuery)
        .textFieldStyle(.roundedBorder)
        .font(.system(size: 10))
        .disabled(memoryVisibleText.isEmpty)

      if model.memoryLoading, memoryVisibleText.isEmpty {
        VStack(spacing: 8) {
          ProgressView().controlSize(.small).tint(EvidenceStyle.amber)
          Text("Reading bounded source…").font(.system(size: 9)).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, minHeight: 340)
      } else if memoryVisibleText.isEmpty {
        VStack(spacing: 8) {
          Image(systemName: "doc.text.magnifyingglass")
            .font(.system(size: 24))
            .foregroundStyle(EvidenceStyle.amberForeground)
          Text("No readable document selected").font(.system(size: 11, weight: .semibold))
          Text("Unavailable sources remain visible without expanding file authority.")
            .font(.system(size: 9))
            .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, minHeight: 340)
      } else {
        ScrollView([.horizontal, .vertical]) {
          Text(filteredMemoryText)
            .font(.system(size: 9, design: .monospaced))
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .padding(12)
        }
        .frame(height: 340)
        .background(EvidenceStyle.canvas, in: RoundedRectangle(cornerRadius: 9))
        .overlay { RoundedRectangle(cornerRadius: 9).stroke(EvidenceStyle.separator) }
      }

      if let document = model.memoryDocument, model.memoryDiff == nil {
        HStack(spacing: 7) {
          StatusPill(
            label: document.truncated ? "Truncated safely" : "Complete bounded read",
            color: document.truncated ? EvidenceStyle.warning : EvidenceStyle.success
          )
          Text(document.extractionNote).font(.system(size: 8)).foregroundStyle(.secondary)
        }
      } else if let diff = model.memoryDiff {
        StatusPill(
          label: diff.hasChanges
            ? "Modified vs HEAD"
            : diff.status.replacingOccurrences(
              of: "_", with: " "
            ).capitalized,
          color: diff.hasChanges ? EvidenceStyle.warning : EvidenceStyle.success
        )
      }
    }
    .padding(12)
    .frame(maxWidth: .infinity, alignment: .topLeading)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 12))
    .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }
  }

  private var filteredMemorySources: [MemorySourceReceipt] {
    let sources = model.memoryReceipt?.sources ?? []
    let query = memorySourceQuery.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !query.isEmpty else { return sources }
    return sources.filter {
      [$0.label, $0.tool, $0.displayPath, $0.preview, $0.note]
        .joined(separator: " ").localizedCaseInsensitiveContains(query)
    }
  }

  private var selectedMemorySource: MemorySourceReceipt? {
    model.memoryReceipt?.sources.first { $0.id == model.selectedMemorySourceID }
  }

  private var memoryVisibleText: String {
    model.memoryDiff?.diff ?? model.memoryDocument?.content ?? ""
  }

  private var filteredMemoryText: String {
    let query = memoryContentQuery.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !query.isEmpty else { return memoryVisibleText }
    let lines = memoryVisibleText.split(separator: "\n", omittingEmptySubsequences: false)
    if query.hasPrefix("/"), query.hasSuffix("/"), query.count > 2,
      let expression = try? NSRegularExpression(pattern: String(query.dropFirst().dropLast()))
    {
      return lines.filter { line in
        let value = String(line)
        let range = NSRange(value.startIndex..<value.endIndex, in: value)
        return expression.firstMatch(in: value, range: range) != nil
      }.joined(separator: "\n")
    }
    return lines.filter { $0.localizedCaseInsensitiveContains(query) }.joined(separator: "\n")
  }

  private func memoryByteLabel(_ bytes: UInt64?) -> String {
    guard let bytes else { return "" }
    if bytes >= 1_048_576 { return String(format: "%.1f MiB", Double(bytes) / 1_048_576) }
    if bytes >= 1024 { return String(format: "%.1f KiB", Double(bytes) / 1024) }
    return "\(bytes) B"
  }

  private var historyRootsPanel: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack(alignment: .top, spacing: 16) {
        VStack(alignment: .leading, spacing: 5) {
          PremiumFieldLabel("CODEX HISTORY RECOVERY")
          Text("Additional Codex homes").font(.system(size: 15, weight: .semibold))
          Text(
            "Restore sessions outside the active CODEX_HOME. Rust normalizes, bounds, and deduplicates roots before Usage or reconciliation can consume them."
          )
          .font(.system(size: 9))
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
        }
        Spacer()
        Button {
          model.choosingHistoryRoot = true
        } label: {
          Label("Add history root", systemImage: "folder.badge.plus")
        }
        .buttonStyle(.bordered)
        .disabled(model.historyRootsLoading)
        .accessibilityIdentifier("add-history-root")
      }

      if let issue = model.historyRootsIssue {
        Label(issue, systemImage: "exclamationmark.triangle.fill")
          .font(.system(size: 9))
          .foregroundStyle(EvidenceStyle.warning)
          .padding(12)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(EvidenceStyle.warning.opacity(0.08), in: RoundedRectangle(cornerRadius: 9))
      }

      if model.historyRootsLoading, model.historyRootsReceipt == nil {
        HStack(spacing: 10) {
          ProgressView().controlSize(.small).tint(EvidenceStyle.amber)
          Text("Reading bounded history-root configuration…").font(.system(size: 9))
        }
        .padding(.vertical, 8)
      } else if let receipt = model.historyRootsReceipt, !receipt.roots.isEmpty {
        VStack(spacing: 0) {
          ForEach(Array(receipt.roots.enumerated()), id: \.element.id) { index, root in
            HStack(spacing: 12) {
              Image(
                systemName: root.exists
                  ? "externaldrive.fill.badge.checkmark" : "externaldrive.badge.xmark"
              )
              .foregroundStyle(root.exists ? EvidenceStyle.success : EvidenceStyle.warning)
              .frame(width: 20)
              VStack(alignment: .leading, spacing: 3) {
                Text(root.displayPath)
                  .font(.system(size: 10, weight: .medium, design: .monospaced))
                  .lineLimit(1)
                  .truncationMode(.middle)
                  .help(root.path)
                Text(historyRootState(root))
                  .font(.system(size: 8))
                  .foregroundStyle(.secondary)
              }
              Spacer()
              StatusPill(
                label: root.exists ? "Available" : "Missing",
                color: root.exists ? EvidenceStyle.success : EvidenceStyle.warning
              )
              Button("Remove") { model.removeHistoryRoot(path: root.path) }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .disabled(model.historyRootsLoading)
                .accessibilityLabel("Remove Codex history root \(root.displayPath)")
            }
            .padding(.horizontal, 13)
            .padding(.vertical, 11)
            if index < receipt.roots.count - 1 {
              Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
            }
          }
        }
        .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 10))
        .overlay { RoundedRectangle(cornerRadius: 10).stroke(EvidenceStyle.separator) }
      } else {
        HStack(alignment: .top, spacing: 11) {
          Image(systemName: "checkmark.shield.fill").foregroundStyle(EvidenceStyle.success)
          VStack(alignment: .leading, spacing: 4) {
            Text("The active Codex home is already automatic")
              .font(.system(size: 10, weight: .semibold))
            Text("Add a root only when older sessions live elsewhere.")
              .font(.system(size: 8))
              .foregroundStyle(.secondary)
          }
        }
        .padding(13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 10))
      }

      Label(
        "Adding or removing a root never reads or deletes transcript content. Reconcile from Usage when ready.",
        systemImage: "lock.shield.fill"
      )
      .font(.system(size: 8))
      .foregroundStyle(.secondary)
    }
    .padding(18)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 14))
    .overlay { RoundedRectangle(cornerRadius: 14).stroke(EvidenceStyle.separator) }
  }

  private func historyRootState(_ root: HistoryRoot) -> String {
    switch (root.sessionsAvailable, root.archivedSessionsAvailable) {
    case (true, true): "Active and archived sessions available"
    case (true, false): "Active sessions available"
    case (false, true): "Archived sessions available"
    case (false, false): "Configured path is currently unavailable"
    }
  }

  private var retentionPanel: some View {
    VStack(alignment: .leading, spacing: 14) {
      VStack(alignment: .leading, spacing: 14) {
        HStack(alignment: .top) {
          VStack(alignment: .leading, spacing: 4) {
            PremiumFieldLabel("INDEXED SESSION ARCHIVE")
            Text("Dry run before cleanup").font(.system(size: 15, weight: .semibold))
            Text(
              "Only CodeVetter archive and FTS rows are candidates. Provider transcripts and source sessions stay untouched."
            )
            .font(.system(size: 9))
            .foregroundStyle(.secondary)
          }
          Spacer()
          StatusPill(label: "Identity rechecked", color: EvidenceStyle.success)
        }
        HStack(spacing: 12) {
          retentionInput("MAXIMUM AGE", suffix: "days", value: $retentionAgeDays)
          retentionInput("MAXIMUM ARCHIVE", suffix: "MiB", value: $retentionMaxMiB)
        }
        HStack(spacing: 9) {
          Button {
            model.previewSessionRetention(
              maxAgeDays: Int(retentionAgeDays),
              maxArchiveMiB: Int(retentionMaxMiB)
            )
          } label: {
            Text("Preview cleanup")
              .fixedSize(horizontal: true, vertical: false)
          }
          .buttonStyle(PremiumPrimaryButtonStyle())
          .disabled(model.retentionLoading || retentionInputsInvalid)
          .accessibilityLabel("Preview session retention")
          .accessibilityIdentifier("preview-session-retention")

          Button("Apply reviewed plan") { confirmingRetentionApply = true }
            .buttonStyle(.bordered)
            .disabled(
              model.retentionLoading
                || model.retentionReceipt?.plan?.candidates.isEmpty != false)

          Spacer()
          Button("Checkpoint") { model.checkpointSessionArchive(vacuum: false) }
            .buttonStyle(.bordered)
            .disabled(model.retentionLoading)
            .accessibilityIdentifier("checkpoint-session-archive")
          Button("Checkpoint + VACUUM") { confirmingRetentionVacuum = true }
            .buttonStyle(.bordered)
            .disabled(model.retentionLoading)
            .accessibilityIdentifier("vacuum-session-archive")
        }
      }
      .padding(18)
      .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 14))
      .overlay { RoundedRectangle(cornerRadius: 14).stroke(EvidenceStyle.separator) }

      if let issue = model.retentionIssue {
        Label(issue, systemImage: "exclamationmark.triangle.fill")
          .font(.system(size: 9))
          .foregroundStyle(EvidenceStyle.warning)
          .padding(14)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(EvidenceStyle.warning.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
      }

      if model.retentionLoading {
        HStack(spacing: 10) {
          ProgressView().controlSize(.small).tint(EvidenceStyle.amber)
          Text("Rust is checking archive identity and protected references…")
            .font(.system(size: 10))
        }
        .padding(14)
      } else if let plan = model.retentionReceipt?.plan {
        retentionPlanCard(plan)
      } else if let receipt = model.retentionReceipt {
        retentionOperationCard(receipt)
      } else {
        HStack(alignment: .top, spacing: 12) {
          Image(systemName: "shield.checkered").foregroundStyle(EvidenceStyle.amberForeground)
          VStack(alignment: .leading, spacing: 5) {
            Text("No cleanup plan has been created").font(.system(size: 11, weight: .semibold))
            Text(
              "Previewing persists a stable plan identity. Applying it later fails closed if the archive or protected-reference set changed."
            )
            .font(.system(size: 9))
            .foregroundStyle(.secondary)
          }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 12))
        .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }
      }
    }
  }

  private func retentionInput(_ label: String, suffix: String, value: Binding<String>) -> some View
  {
    VStack(alignment: .leading, spacing: 7) {
      PremiumFieldLabel(label)
      HStack {
        TextField("", text: value)
          .textFieldStyle(.plain)
          .font(.system(size: 15, weight: .semibold, design: .monospaced))
          .onChange(of: value.wrappedValue) { _, _ in model.clearRetentionPreview() }
        Text(suffix).font(.system(size: 9)).foregroundStyle(.secondary)
      }
      .padding(.horizontal, 12)
      .frame(height: 38)
      .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 9))
      .overlay { RoundedRectangle(cornerRadius: 9).stroke(EvidenceStyle.separator) }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func retentionPlanCard(_ plan: SessionRetentionPlan) -> some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack {
        VStack(alignment: .leading, spacing: 4) {
          PremiumFieldLabel("REVIEWED PLAN")
          Text(plan.id).font(.system(size: 9, design: .monospaced)).textSelection(.enabled)
        }
        Spacer()
        StatusPill(label: "Dry run", color: EvidenceStyle.amber)
      }
      HStack(spacing: 8) {
        settingsMetric("REMOVABLE", "\(plan.candidates.count) sessions")
        settingsMetric("ROWS", plan.candidateRows.formatted())
        settingsMetric("RECLAIM", formatStorage(plan.candidateBytes))
        settingsMetric("PROJECTED", formatStorage(plan.projectedBytes))
      }
      if plan.candidates.isEmpty {
        Label("Nothing matches this policy.", systemImage: "checkmark.circle.fill")
          .font(.system(size: 9, weight: .semibold))
          .foregroundStyle(EvidenceStyle.success)
      }
      if !plan.protected.isEmpty {
        VStack(alignment: .leading, spacing: 8) {
          HStack {
            PremiumFieldLabel("PROTECTED REFERENCES")
            Spacer()
            Text(
              "\(plan.protected.count) \(plan.protected.count == 1 ? "session" : "sessions")"
            )
            .font(.system(size: 8, weight: .semibold, design: .monospaced))
            .foregroundStyle(EvidenceStyle.success)
          }
          ForEach(plan.protected.prefix(8)) { entry in
            HStack(alignment: .firstTextBaseline, spacing: 10) {
              Text(String(entry.sessionID.prefix(14)))
                .font(.system(size: 8, design: .monospaced))
                .foregroundStyle(.secondary)
              Text(entry.reasons.joined(separator: " · "))
                .font(.system(size: 8))
              Spacer()
              Text("\(entry.rows) rows")
                .font(.system(size: 8, design: .monospaced))
                .foregroundStyle(.secondary)
            }
          }
        }
        .padding(14)
        .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 10))
      }
      Label(
        "Provider-owned transcripts are never deleted by this plan.",
        systemImage: "lock.shield.fill"
      )
      .font(.system(size: 8, weight: .semibold))
      .foregroundStyle(EvidenceStyle.success)
    }
    .padding(18)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 14))
    .overlay { RoundedRectangle(cornerRadius: 14).stroke(EvidenceStyle.amber.opacity(0.35)) }
  }

  private func retentionOperationCard(_ receipt: SessionRetentionReceipt) -> some View {
    HStack(spacing: 12) {
      Image(systemName: "checkmark.seal.fill").foregroundStyle(EvidenceStyle.success)
      VStack(alignment: .leading, spacing: 4) {
        Text(receipt.operation == .apply ? "Reviewed plan applied" : "Archive checkpoint complete")
          .font(.system(size: 12, weight: .semibold))
        Text(receipt.generatedAt)
          .font(.system(size: 8, design: .monospaced))
          .foregroundStyle(.secondary)
      }
      Spacer()
      StatusPill(label: receipt.operation.rawValue.uppercased(), color: EvidenceStyle.success)
    }
    .padding(18)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 14))
    .overlay { RoundedRectangle(cornerRadius: 14).stroke(EvidenceStyle.separator) }
  }

  private var retentionInputsInvalid: Bool {
    guard let age = Int(retentionAgeDays), let size = Int(retentionMaxMiB) else { return true }
    return !(1...3650).contains(age) || !(1...524_288).contains(size)
  }

  private var retentionApplyConfirmation: String {
    guard let plan = model.retentionReceipt?.plan else {
      return "No reviewed retention plan is available."
    }
    return
      "Remove \(plan.candidateRows.formatted()) indexed archive rows from \(plan.candidates.count) unprotected sessions? Rust will reject the operation if the plan identity changed."
  }

  private func formatStorage(_ bytes: Int64) -> String {
    ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
  }

  @ViewBuilder
  private var rubricPanel: some View {
    Group {
      if model.rubricLoading, model.rubricReceipt == nil {
        HStack(spacing: 10) {
          ProgressView().controlSize(.small).tint(EvidenceStyle.amber)
          Text("Loading Rust-owned review standards…").font(.system(size: 10))
        }
        .padding(18)
      } else {
        VStack(alignment: .leading, spacing: 14) {
          if let issue = model.rubricIssue {
            Label(issue, systemImage: "exclamationmark.triangle.fill")
              .font(.system(size: 9))
              .foregroundStyle(EvidenceStyle.warning)
              .padding(14)
              .frame(maxWidth: .infinity, alignment: .leading)
              .background(
                EvidenceStyle.warning.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
          }
          if let receipt = model.rubricReceipt {
            LazyVStack(spacing: 10) {
              ForEach(receipt.packs) { pack in rubricPackCard(pack) }
            }
            DisclosureGroup(isExpanded: $creatingRubric) {
              customRubricCard(existing: receipt.packs)
                .padding(.top, 12)
            } label: {
              VStack(alignment: .leading, spacing: 3) {
                Text("Create a custom rubric").font(.system(size: 11, weight: .semibold))
                Text("Add a focused review standard only when the built-in packs do not fit.")
                  .font(.system(size: 9)).foregroundStyle(.secondary)
              }
            }
            .tint(EvidenceStyle.amberForeground)
            .padding(14)
            .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 11))
            .overlay { RoundedRectangle(cornerRadius: 11).stroke(EvidenceStyle.separator) }
            HStack(spacing: 8) {
              StatusPill(
                label: receipt.activePackID == nil
                  ? "Default not attributed" : "Selection attributed",
                color: receipt.activePackID == nil ? EvidenceStyle.warning : EvidenceStyle.success)
              Text("Each completed review stores the selected pack id with its evidence.")
                .font(.system(size: 8))
                .foregroundStyle(.secondary)
              Spacer()
              Button {
                model.loadRubrics()
              } label: {
                Label("Refresh", systemImage: "arrow.clockwise")
              }
              .buttonStyle(.bordered)
              .disabled(model.rubricLoading)
              .accessibilityIdentifier("refresh-rubrics")
            }
            .padding(14)
            .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 11))
          } else {
            ContentUnavailableView(
              "Rubrics unavailable",
              systemImage: "checklist",
              description: Text("The canonical Rust rubric receipt could not be loaded.")
            )
            .frame(maxWidth: .infinity, minHeight: 240)
          }
        }
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("rubric-settings-workspace")
  }

  private func rubricPackCard(_ pack: RubricPackReceipt) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(alignment: .top) {
        VStack(alignment: .leading, spacing: 4) {
          HStack(spacing: 7) {
            Text(pack.name).font(.system(size: 14, weight: .semibold))
            if pack.builtIn { StatusPill(label: "Built in", color: Color.secondary) }
          }
          Text(pack.focus).font(.system(size: 9)).foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
        }
        Spacer()
        if pack.active {
          StatusPill(label: "Selected", color: EvidenceStyle.success)
            .accessibilityLabel("Active rubric pack")
            .accessibilityIdentifier("active-rubric-\(pack.id)")
        } else {
          Button {
            model.selectRubricPack(pack.id)
          } label: {
            Text("Use pack").fixedSize(horizontal: true, vertical: false)
          }
          .buttonStyle(PremiumPrimaryButtonStyle())
          .disabled(model.rubricLoading)
          .accessibilityIdentifier("select-rubric-\(pack.id)")
        }
      }
      HStack(spacing: 10) {
        Text(
          "\(pack.reviewCount.formatted()) reviews · \(pack.totalFindings.formatted()) findings · \(pack.checks.count.formatted()) checks"
        )
        .font(.system(size: 9, weight: .medium, design: .monospaced))
        .foregroundStyle(.secondary)
        Spacer()
        Button(expandedRubricID == pack.id ? "Hide details" : "View details") {
          expandedRubricID = expandedRubricID == pack.id ? nil : pack.id
        }
        .buttonStyle(.bordered)
      }
      if expandedRubricID == pack.id {
        VStack(alignment: .leading, spacing: 8) {
          HStack {
            PremiumFieldLabel("REVIEW CHECKS")
            Spacer()
            Button("Duplicate") { duplicateRubric(pack) }.buttonStyle(.bordered)
          }
          ForEach(pack.checks, id: \.self) { check in
            HStack(alignment: .firstTextBaseline, spacing: 8) {
              Circle().fill(EvidenceStyle.amber).frame(width: 4, height: 4)
              Text(check).font(.system(size: 10)).fixedSize(horizontal: false, vertical: true)
            }
          }
          DisclosureGroup("Exact prompt preview") {
            Text(pack.promptPreview)
              .font(.system(size: 9, design: .monospaced))
              .textSelection(.enabled)
              .frame(maxWidth: .infinity, alignment: .leading)
              .padding(.top, 8)
          }
        }
        .padding(12)
        .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 9))
      }
    }
    .padding(16)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 13))
    .overlay {
      RoundedRectangle(cornerRadius: 13).stroke(EvidenceStyle.separator)
    }
    .overlay(alignment: .leading) {
      if pack.active {
        Rectangle()
          .fill(EvidenceStyle.amberForeground)
          .frame(width: 2)
          .padding(.vertical, 10)
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("rubric-pack-\(pack.id)")
  }

  private func customRubricCard(existing: [RubricPackReceipt]) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      PremiumFieldLabel("CUSTOM PACK")
      Text("Create and use").font(.system(size: 14, weight: .semibold))
      Text("The Rust core validates ids, text bounds, and 1–32 checks before persistence.")
        .font(.system(size: 8))
        .foregroundStyle(.secondary)
      rubricTextField("Pack name", text: $newRubricName)
      rubricTextField("Review focus", text: $newRubricFocus)
      VStack(alignment: .leading, spacing: 5) {
        PremiumFieldLabel("ONE CHECK PER LINE")
        TextEditor(text: $newRubricChecks)
          .font(.system(size: 9))
          .scrollContentBackground(.hidden)
          .padding(8)
          .frame(minHeight: 145)
          .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 8))
          .overlay { RoundedRectangle(cornerRadius: 8).stroke(EvidenceStyle.separator) }
      }
      Button {
        createRubric(existing: existing)
      } label: {
        Label("Save and use pack", systemImage: "square.and.arrow.down")
          .frame(maxWidth: .infinity)
      }
      .buttonStyle(PremiumPrimaryButtonStyle())
      .disabled(!customRubricIsValid || model.rubricLoading)
      .accessibilityIdentifier("save-custom-rubric")
    }
    .padding(16)
    .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 13))
    .overlay { RoundedRectangle(cornerRadius: 13).stroke(EvidenceStyle.separator) }
  }

  private func rubricTextField(_ label: String, text: Binding<String>) -> some View {
    TextField(label, text: text)
      .textFieldStyle(.plain)
      .font(.system(size: 9))
      .padding(.horizontal, 10)
      .frame(height: 36)
      .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 8))
      .overlay { RoundedRectangle(cornerRadius: 8).stroke(EvidenceStyle.separator) }
  }

  private var customRubricChecks: [String] {
    newRubricChecks.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }
      .filter { !$0.isEmpty }
  }

  private var customRubricIsValid: Bool {
    !newRubricName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && !newRubricFocus.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && (1...32).contains(customRubricChecks.count)
  }

  private func createRubric(existing: [RubricPackReceipt]) {
    let id = uniqueRubricID(for: newRubricName, existing: existing)
    model.saveRubricPack(
      RubricPackInput(
        id: id,
        name: newRubricName.trimmingCharacters(in: .whitespacesAndNewlines),
        focus: newRubricFocus.trimmingCharacters(in: .whitespacesAndNewlines),
        checks: customRubricChecks
      ))
    newRubricName = ""
    newRubricFocus = ""
    newRubricChecks = ""
  }

  private func duplicateRubric(_ pack: RubricPackReceipt) {
    let packs = model.rubricReceipt?.packs ?? []
    let name = "\(pack.name) (copy)"
    model.saveRubricPack(
      RubricPackInput(
        id: uniqueRubricID(for: name, existing: packs),
        name: name,
        focus: pack.focus,
        checks: pack.checks
      ))
  }

  private func uniqueRubricID(for name: String, existing: [RubricPackReceipt]) -> String {
    let base = String(
      name.lowercased().map { $0.isLetter || $0.isNumber ? $0 : "-" }
    )
    .split(separator: "-").joined(separator: "-").prefix(48)
    let normalized = base.isEmpty ? "custom-pack" : String(base)
    let taken = Set(existing.map(\.id))
    if !taken.contains(normalized) { return normalized }
    for suffix in 2...99 {
      let candidate = String("\(normalized)-\(suffix)".prefix(64))
      if !taken.contains(candidate) { return candidate }
    }
    return String("\(normalized)-copy".prefix(64))
  }

  private var aboutPanel: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack(alignment: .center, spacing: 16) {
        CodeVetterBrandMark(size: 58)
        VStack(alignment: .leading, spacing: 4) {
          Text("CodeVetter").font(.system(size: 20, weight: .semibold))
          Text("Execution-backed verification for coding agents")
            .font(.system(size: 10))
            .foregroundStyle(.secondary)
        }
        Spacer()
        Button("Welcome tour") { model.presentOnboarding() }
          .buttonStyle(.bordered)
          .accessibilityLabel("Open the CodeVetter welcome tour")
        StatusPill(label: "Native preview", color: EvidenceStyle.amber)
      }
      .padding(18)
      .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 14))
      .overlay { RoundedRectangle(cornerRadius: 14).stroke(EvidenceStyle.separator) }

      VStack(spacing: 0) {
        aboutRow(
          "VERSION",
          Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "Development")
        Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
        aboutRow("BUILD", "AppKit + SwiftUI over the Rust core")
        Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
        aboutRow("LICENSE", "ISC")
        Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
        aboutRow(
          "IDENTIFIER", Bundle.main.bundleIdentifier ?? "com.codevetter.desktop.native-preview")
      }
      .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 14))
      .overlay { RoundedRectangle(cornerRadius: 14).stroke(EvidenceStyle.separator) }

      HStack(alignment: .top, spacing: 12) {
        VStack(alignment: .leading, spacing: 8) {
          PremiumFieldLabel("UPDATES")
          Text("Sparkle 2.9.6 selected · preview disabled")
            .font(.system(size: 11, weight: .semibold))
          Text(
            "The updater stays off unless the production bundle has an HTTPS appcast and a real EdDSA public key. Preview builds fail closed."
          )
          .font(.system(size: 9))
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 12))
        .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }

        VStack(alignment: .leading, spacing: 10) {
          PremiumFieldLabel("LINKS")
          Link(
            "GitHub Repository",
            destination: URL(string: "https://github.com/Codevetter/codevetter")!)
          Link("Product", destination: URL(string: "https://codevetter.com")!)
          Link("Documentation", destination: URL(string: "https://docs.codevetter.com")!)
        }
        .font(.system(size: 10, weight: .semibold))
        .tint(EvidenceStyle.amber)
        .padding(16)
        .frame(width: 230, alignment: .topLeading)
        .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 12))
        .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }
      }
    }
  }

  private func aboutRow(_ label: String, _ value: String) -> some View {
    HStack {
      PremiumFieldLabel(label)
      Spacer()
      Text(value)
        .font(.system(size: 9, design: label == "IDENTIFIER" ? .monospaced : .default))
        .foregroundStyle(.secondary)
        .textSelection(.enabled)
    }
    .padding(.horizontal, 16)
    .frame(height: 44)
  }

  @ViewBuilder
  private var mcpPanel: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack(alignment: .center, spacing: 14) {
        VStack(alignment: .leading, spacing: 5) {
          PremiumFieldLabel("REPOSITORY SCOPE")
          Text(model.repositoryPath.isEmpty ? "No repository selected" : model.repositoryPath)
            .font(.system(size: 9, design: .monospaced))
            .foregroundStyle(model.repositoryPath.isEmpty ? Color.secondary : Color.primary)
            .lineLimit(1)
        }
        Spacer()
        Button {
          model.choosingRepository = true
        } label: {
          Label(
            model.repositoryPath.isEmpty ? "Choose repository" : "Change", systemImage: "folder")
        }
        .buttonStyle(.bordered)
        .accessibilityLabel("Choose MCP repository")
        .accessibilityIdentifier("choose-mcp-repository")
        Button {
          model.loadMcpSettings()
        } label: {
          Image(systemName: "arrow.clockwise")
        }
        .buttonStyle(.bordered)
        .disabled(model.repositoryPath.isEmpty || model.mcpLoading)
        .accessibilityLabel("Refresh MCP settings")
      }
      .padding(16)
      .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 12))
      .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }

      if let issue = model.mcpIssue {
        Label(issue, systemImage: "exclamationmark.triangle.fill")
          .font(.system(size: 9))
          .foregroundStyle(EvidenceStyle.warning)
          .padding(14)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(EvidenceStyle.warning.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
      }

      if model.mcpLoading, model.mcpSettingsReceipt == nil {
        HStack(spacing: 10) {
          ProgressView().controlSize(.small).tint(EvidenceStyle.amber)
          Text("Resolving repository-scoped MCP authority…").font(.system(size: 10))
        }
        .padding(18)
      } else if let receipt = model.mcpSettingsReceipt {
        mcpAuthorityCard(receipt.settings)
        mcpClientCard(receipt.settings)
        mcpAuditCard(receipt.settings)
        mcpBoundaryLists(receipt.settings)
      } else if model.repositoryPath.isEmpty {
        ContentUnavailableView(
          "Choose one repository",
          systemImage: "arrow.trianglehead.branch",
          description: Text("MCP authority is always explicit and repository-scoped.")
        )
        .frame(maxWidth: .infinity, minHeight: 220)
      }
    }
  }

  private func mcpAuthorityCard(_ settings: McpRepositorySettings) -> some View {
    VStack(alignment: .leading, spacing: 15) {
      HStack(alignment: .top, spacing: 16) {
        VStack(alignment: .leading, spacing: 5) {
          HStack(spacing: 8) {
            Text("Repository history over MCP").font(.system(size: 15, weight: .semibold))
            StatusPill(
              label: settings.enabled ? "Enabled" : "Disabled",
              color: settings.enabled ? EvidenceStyle.success : Color.secondary)
          }
          Text(
            "Local stdio only · no file writes, provider calls, index refresh, or network listener"
          )
          .font(.system(size: 9))
          .foregroundStyle(.secondary)
        }
        Spacer()
        Button(settings.enabled ? "Disable" : "Enable") {
          model.runMcpSettings(operation: settings.enabled ? .disable : .enable)
        }
        .buttonStyle(PremiumPrimaryButtonStyle())
        .disabled(model.mcpLoading || (!settings.enabled && !settings.indexed))
        .accessibilityLabel(settings.enabled ? "Disable repository MCP" : "Enable repository MCP")
      }
      if !settings.indexed {
        Label(
          "Build release history in Repo Unpack before enabling MCP.",
          systemImage: "clock.badge.exclamationmark"
        )
        .font(.system(size: 9))
        .foregroundStyle(EvidenceStyle.warning)
      }
      HStack(spacing: 8) {
        settingsMetric(
          "HISTORY", settings.indexed ? (settings.stale ? "Stale" : "Current") : "Not built")
        settingsMetric("TOOLS", "\(settings.toolNames.count)")
        settingsMetric("RESOURCES", "\(settings.resourceKinds.count)")
        settingsMetric("RECENT ACCESS", "\(settings.recentAudit.count)")
      }
      HStack(spacing: 8) {
        Circle()
          .fill(
            settings.enabled && settings.indexed ? EvidenceStyle.success : EvidenceStyle.warning
          )
          .frame(width: 7, height: 7)
        Text(mcpReadiness(settings))
          .font(.system(size: 9, weight: .semibold))
        Spacer()
        Text("prepare_review")
          .font(.system(size: 8, design: .monospaced))
          .foregroundStyle(.secondary)
      }
    }
    .padding(18)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 14))
    .overlay { RoundedRectangle(cornerRadius: 14).stroke(EvidenceStyle.separator) }
  }

  private func mcpClientCard(_ settings: McpRepositorySettings) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        VStack(alignment: .leading, spacing: 3) {
          PremiumFieldLabel("CLIENT CONFIGURATION")
          Text("Exact local stdio connection").font(.system(size: 14, weight: .semibold))
        }
        Spacer()
        Button(copiedMcpValue == "config" ? "Copied" : "Copy config") {
          copyToPasteboard(settings.clientConfigJSON ?? "")
          copiedMcpValue = "config"
        }
        .buttonStyle(.bordered)
        .disabled(settings.clientConfigJSON == nil)
      }
      Text(settings.serverPath)
        .font(.system(size: 8, design: .monospaced))
        .foregroundStyle(.secondary)
        .textSelection(.enabled)
      ScrollView(.horizontal) {
        Text(settings.clientConfigJSON ?? "Configuration unavailable for this repository.")
          .font(.system(size: 8, design: .monospaced))
          .textSelection(.enabled)
          .padding(12)
      }
      .frame(height: 126)
      .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 9))
      .overlay { RoundedRectangle(cornerRadius: 9).stroke(EvidenceStyle.separator) }
      HStack {
        VStack(alignment: .leading, spacing: 3) {
          Text("Prepare one review").font(.system(size: 10, weight: .semibold))
          Text("Context and suggested checks—not a verdict.")
            .font(.system(size: 8))
            .foregroundStyle(.secondary)
        }
        Spacer()
        Button(copiedMcpValue == "invocation" ? "Copied" : "Copy invocation") {
          copyToPasteboard(mcpReviewInvocation)
          copiedMcpValue = "invocation"
        }
        .buttonStyle(.bordered)
        .disabled(!settings.toolNames.contains("prepare_review"))
      }
    }
    .padding(18)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 14))
    .overlay { RoundedRectangle(cornerRadius: 14).stroke(EvidenceStyle.separator) }
  }

  private func mcpAuditCard(_ settings: McpRepositorySettings) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        VStack(alignment: .leading, spacing: 3) {
          PremiumFieldLabel("LOCAL ACCESS AUDIT")
          Text("Operational metadata only").font(.system(size: 14, weight: .semibold))
        }
        Spacer()
        Button("Clear access audit") { confirmingAuditClear = true }
          .buttonStyle(.bordered)
          .disabled(model.mcpLoading || settings.recentAudit.isEmpty)
      }
      Text("Arguments, prompts, query text, credentials, and evidence are never recorded here.")
        .font(.system(size: 9))
        .foregroundStyle(.secondary)
      if settings.recentAudit.isEmpty {
        Text("No MCP accesses recorded for this repository.")
          .font(.system(size: 9))
          .foregroundStyle(.secondary)
          .padding(.vertical, 12)
      } else {
        ForEach(settings.recentAudit.prefix(12)) { entry in
          HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
              Text(entry.operation).font(.system(size: 9, weight: .medium, design: .monospaced))
              Text(entry.createdAt).font(.system(size: 7, design: .monospaced)).foregroundStyle(
                .secondary)
            }
            Spacer()
            Text(entry.status)
              .font(.system(size: 8, weight: .semibold, design: .monospaced))
              .foregroundStyle(entry.status == "ok" ? EvidenceStyle.success : EvidenceStyle.warning)
            Text("\(entry.durationMS) ms · \(entry.responseBytes) B")
              .font(.system(size: 8, design: .monospaced))
              .foregroundStyle(.secondary)
          }
          .padding(.vertical, 5)
        }
      }
    }
    .padding(18)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 14))
    .overlay { RoundedRectangle(cornerRadius: 14).stroke(EvidenceStyle.separator) }
  }

  private func mcpBoundaryLists(_ settings: McpRepositorySettings) -> some View {
    HStack(alignment: .top, spacing: 12) {
      mcpListCard("EXPOSED KINDS", settings.resourceKinds)
      mcpListCard("REDACTION", settings.redactionRules)
    }
  }

  private func mcpListCard(_ title: String, _ values: [String]) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      PremiumFieldLabel(title)
      Text(values.joined(separator: " · "))
        .font(.system(size: 9))
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
    }
    .padding(16)
    .frame(maxWidth: .infinity, alignment: .topLeading)
    .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 12))
    .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }
  }

  private func settingsMetric(_ label: String, _ value: String) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      PremiumFieldLabel(label)
      Text(value).font(.system(size: 11, weight: .semibold))
    }
    .padding(11)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 9))
  }

  private func opsDuration(_ seconds: Double?) -> String {
    guard let seconds else { return "—" }
    if seconds < 60 { return String(format: "%.0fs", seconds) }
    if seconds < 3_600 { return String(format: "%.1fm", seconds / 60) }
    return String(format: "%.1fh", seconds / 3_600)
  }

  private func mcpReadiness(_ settings: McpRepositorySettings) -> String {
    if !settings.indexed { return "Build release history before agent setup" }
    if !settings.toolNames.contains("prepare_review") { return "prepare_review is unavailable" }
    if !settings.enabled { return "Enable this repository to authorize local review preparation" }
    return settings.stale ? "Ready with stale context" : "Ready for review agents"
  }

  private func copyToPasteboard(_ value: String) {
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(value, forType: .string)
  }

  private var mcpReviewInvocation: String {
    """
    {
      "tool": "prepare_review",
      "arguments": {
        "task": "Review this change against its task and acceptance criteria.",
        "change": "main...feature"
      }
    }
    """
  }

  private var projectionBoundary: some View {
    VStack(alignment: .leading, spacing: 8) {
      PremiumFieldLabel("AUTHORITY BOUNDARY")
      Label(projectionCommand, systemImage: "terminal")
        .font(.system(size: 10, weight: .semibold, design: .monospaced))
      Text(projectionDetail)
        .font(.system(size: 9))
        .foregroundStyle(.secondary)
    }
    .padding(16)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 12))
    .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }
  }

  private var projectionCommand: String {
    switch model.settingsSection {
    case .capabilities: "codevetter capabilities --json"
    case .mcp: "codevetter mcp"
    case .agentIsland: "codevetter settings --set native_agent_island_…"
    case .usage: "codevetter history-roots · codevetter retention"
    case .rubrics: "codevetter rubrics"
    case .memories: "codevetter memories"
    case .ops: "codevetter ops --window-days \(model.opsWindowDays)"
    default: "codevetter settings"
    }
  }

  private var projectionDetail: String {
    switch model.settingsSection {
    case .capabilities:
      "The bundled registry is the shared glossary for the native UI, CLI, and agent surfaces. Availability and limitations remain explicit instead of being inferred from navigation visibility."
    case .mcp:
      "The CLI and native UI share codevetter.mcp-settings/v1. Repository authority changes are explicit; credentials and evidence payloads never enter the access audit."
    case .agentIsland:
      "The CLI and native UI share the same twelve non-secret preferences through codevetter.native-settings/v1. This host stores configuration only; runtime actions remain explicitly authorized."
    case .usage:
      "The CLI and native UI share codevetter.history-roots/v1 and codevetter.session-retention/v1. Root changes are bounded and never read or delete transcripts; retention preview, apply, checkpoint, and VACUUM remain separate operations."
    case .rubrics:
      "The CLI and native UI share codevetter.rubric-settings/v1. Rust owns validation, active selection, custom packs, usage attribution, and the exact prompt preview passed into reviews."
    case .memories:
      "The CLI and native UI share codevetter.memories/v1. Rust owns source discovery, opaque identity, canonical admission, redaction, payload bounds, and supervised Git diff; agents and MCP receive no memory authority."
    case .ops:
      "The CLI and native UI share codevetter.ops-status/v1. Only aggregate local rows and configuration presence cross the boundary; credentials, endpoint values, provider fetches, webhook sends, and configuration writes remain excluded."
    default:
      "The CLI and native UI share codevetter.native-settings/v1. Only one validated, allowlisted value is saved per receipt; github_token and all credential material are excluded."
    }
  }

  private func settings(in section: NativeSettingsSection) -> [NativeSettingValue] {
    model.settingsReceipt?.settings.filter { $0.section == section.rawValue } ?? []
  }

  private var sectionIsLive: Bool {
    if model.settingsSection == .capabilities { return !model.registry.capabilities.isEmpty }
    if model.settingsSection == .mcp { return model.mcpSettingsReceipt != nil }
    if model.settingsSection == .usage { return true }
    if model.settingsSection == .rubrics { return model.rubricReceipt != nil }
    if model.settingsSection == .memories { return model.memoryReceipt != nil }
    if model.settingsSection == .ops { return model.opsReceipt != nil }
    if model.settingsSection == .about { return true }
    return !settings(in: model.settingsSection).isEmpty
  }

  private var sectionStatusLabel: String {
    if model.settingsSection == .agentIsland {
      return settings(in: .agentIsland).isEmpty ? "TRANSFER TRACKED" : "CONFIG LIVE"
    }
    if model.settingsSection == .ops {
      return model.opsReceipt == nil ? "TRANSFER TRACKED" : "READ-ONLY LIVE"
    }
    return sectionIsLive ? "LIVE" : "TRANSFER TRACKED"
  }

  private var sectionStatusColor: Color {
    if model.settingsSection == .agentIsland { return EvidenceStyle.warning }
    return sectionIsLive ? EvidenceStyle.success : EvidenceStyle.warning
  }

  private var agentIslandEnabled: Bool {
    settings(in: .agentIsland)
      .first(where: { $0.key == "native_agent_island_enabled" })?.value == "true"
  }

  private var sectionDescription: String {
    switch model.settingsSection {
    case .general: "Review defaults and deliberate indexing behavior."
    case .appearance: "Visual density and evidence presentation preferences."
    case .integrations: "External connection readiness without credential exposure."
    case .capabilities: "The shared UI, CLI, and AI-agent glossary and authority map."
    case .agents: "Default agent roles, concurrency, and local executable discovery."
    case .agentIsland: "Opt-in native presentation, speech, and privacy-safe preferences."
    case .mcp: "Repository-scoped machine access, tools, resources, and audit."
    case .notifications: "Observed local events and provider-telemetry thresholds."
    case .usage: "History recovery and guarded local archive retention."
    case .rubrics: "Review rubric packs and deterministic review policy."
    case .ops: "Operational evidence and local system readiness."
    case .memories: "Bounded local agent-memory inspection."
    case .about: "Native build, update, license, and product identity."
    }
  }

  private var transferTitle: String {
    switch model.settingsSection {
    case .integrations: "Credential-safe integration transfer"
    case .agentIsland: "Agent Island runtime transfer"
    case .mcp: "Repository-scoped MCP transfer"
    case .usage: "Retention and recovery transfer"
    case .rubrics: "Rubric editor transfer"
    case .ops: "Operations workspace transfer"
    case .memories: "Memory inspector transfer"
    case .about: "Native packaging and updater transfer"
    default: "No declared settings in this section"
    }
  }

  private var transferDetail: String {
    switch model.settingsSection {
    case .integrations:
      "GitHub and Linear connection state must move through a status-only Rust projection. Existing tokens and OAuth material stay in their current owner until secure native storage is separately qualified."
    case .agentIsland:
      "All twelve non-secret preferences now share the Rust-owned settings contract across native UI, CLI, and the retained helper. Live session status, preview, presentation, speech execution, and identity-checked actions remain incumbent authority until the helper is integrated and requalified in the new host."
    case .mcp:
      "The native surface must preserve repository selection, indexed/stale state, tool and resource catalogs, copyable client configuration, audit history, enablement, review readiness, and clear-audit confirmation."
    case .usage:
      "Additional Codex roots, dry-run retention planning, protected-session reasons, apply confirmation, checkpoint, and VACUUM remain to be transferred through Rust-owned commands."
    case .rubrics:
      "Rubric packs, editing, preview, validation, and review handoff remain reachable in the incumbent while their canonical Rust boundary is defined."
    case .ops:
      "Operational diagnostics remain in the incumbent until their read and execute authorities are enumerated and qualified."
    case .memories:
      "Memory source discovery, content inspection, search, copy, and redacted Git diff now share a bounded read-only Rust receipt across native UI and CLI. Editing and deletion remain unavailable."
    case .about:
      "Sparkle 2.9.6 owns update discovery, signed installation, and relaunch. The preview cannot update; Developer ID notarization, a real EdDSA key, dual-feed cutover, and installed-upgrade proof remain packaging gates."
    default:
      "This section has no current declared non-secret setting."
    }
  }
}

private struct NativeSettingRow: View {
  let setting: NativeSettingValue
  let saving: Bool
  let save: (String) -> Void
  @State private var draft: String

  init(setting: NativeSettingValue, saving: Bool, save: @escaping (String) -> Void) {
    self.setting = setting
    self.saving = saving
    self.save = save
    _draft = State(initialValue: setting.value)
  }

  var body: some View {
    HStack(alignment: .center, spacing: 20) {
      VStack(alignment: .leading, spacing: 4) {
        HStack(spacing: 7) {
          Text(setting.label).font(.system(size: 11, weight: .semibold))
          if saving { ProgressView().controlSize(.mini).tint(EvidenceStyle.amber) }
        }
        Text(setting.description)
          .font(.system(size: 9))
          .foregroundStyle(.secondary)
      }
      Spacer(minLength: 28)
      control
        .frame(width: setting.kind == .text ? 300 : 180, alignment: .trailing)
    }
    .padding(.horizontal, 18)
    .padding(.vertical, 14)
    .onChange(of: setting.value) { _, value in draft = value }
  }

  @ViewBuilder
  private var control: some View {
    switch setting.kind {
    case .toggle:
      Toggle(
        "",
        isOn: Binding(
          get: { setting.value == "true" },
          set: { save($0 ? "true" : "false") }
        )
      )
      .labelsHidden()
      .toggleStyle(.switch)
      .tint(EvidenceStyle.amber)
      .disabled(saving)
      .accessibilityLabel(setting.label)
    case .choice:
      Picker(
        setting.label,
        selection: Binding(
          get: { setting.value },
          set: { save($0) }
        )
      ) {
        ForEach(setting.options) { option in
          Text(option.label).tag(option.value)
        }
      }
      .labelsHidden()
      .pickerStyle(.menu)
      .disabled(saving)
      .accessibilityLabel(setting.label)
    case .text:
      HStack(spacing: 7) {
        TextField(setting.defaultValue, text: $draft)
          .textFieldStyle(.roundedBorder)
          .font(.system(size: 9, design: .monospaced))
          .onSubmit { if draft != setting.value { save(draft) } }
          .accessibilityLabel(setting.label)
        Button("Save") {
          save(draft)
        }
        .buttonStyle(.bordered)
        .disabled(saving || draft == setting.value)
      }
    }
  }
}
