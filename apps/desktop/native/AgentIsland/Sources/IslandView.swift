import AppKit
import SwiftUI

private enum IslandPalette {
    static let background = Color.black
    static let surface = Color.white.opacity(0.075)
    static var line: Color {
        Color.white.opacity(NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast ? 0.32 : 0.12)
    }
    static let primary = Color.white.opacity(0.94)
    static let secondary = Color.white.opacity(0.67)
    static let amber = Color(red: 0.83, green: 0.63, blue: 0.22)
    static let green = Color(red: 0.38, green: 0.83, blue: 0.65)
    static let red = Color(red: 0.93, green: 0.42, blue: 0.43)
}

struct IslandView: View {
    @ObservedObject var model: IslandModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            if model.expanded {
                expandedBody
                    .transition(.opacity.combined(with: .scale(scale: 0.98, anchor: .top)))
            } else {
                collapsedBody
                    .transition(.opacity)
            }
        }
        .background(IslandPalette.background)
        .clipShape(RoundedRectangle(cornerRadius: model.expanded ? 18 : 14, style: .continuous))
        .shadow(color: Color.black.opacity(0.55), radius: 8, x: 0, y: 4)
        .animation(
            reduceMotion ? nil : .easeOut(duration: 0.18),
            value: model.presentation
        )
        .transaction { transaction in
            if reduceMotion {
                transaction.animation = nil
            }
        }
        .onHover(perform: model.setPointerInside)
        .onExitCommand {
            if model.expanded {
                model.toggleExpanded()
            }
        }
    }

    private var collapsedBody: some View {
        Button(action: model.toggleExpanded) {
            HStack(spacing: 10) {
                statusDot(model.primarySession?.status)
                VStack(alignment: .leading, spacing: 1) {
                    Text(collapsedTitle)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(IslandPalette.primary)
                        .lineLimit(1)
                    Text(collapsedSubtitle)
                        .font(.system(size: 11, weight: .regular))
                        .foregroundColor(IslandPalette.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 5)
                CollapsedTeamRail(summary: model.teamSummary)
                Image(systemName: "chevron.down")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(IslandPalette.secondary)
            }
            .padding(.horizontal, 15)
            .frame(width: 320, height: 48)
            .contentShape(Rectangle())
        }
        .buttonStyle(PlainButtonStyle())
        .accessibilityLabel(collapsedAccessibilityLabel)
    }

    private var expandedBody: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Agents")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(IslandPalette.primary)
                    Text(model.latestOutcome ?? summaryText)
                        .font(.system(size: 11))
                        .foregroundColor(
                            model.latestOutcome == nil ? IslandPalette.secondary : IslandPalette.amber
                        )
                }
                Spacer()
                Button(action: model.toggleExpanded) {
                    Image(systemName: "chevron.up")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(IslandPalette.secondary)
                        .frame(width: 28, height: 28)
                        .background(IslandPalette.surface)
                        .clipShape(Circle())
                }
                .buttonStyle(PlainButtonStyle())
                .accessibilityLabel("Collapse agent island")
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 15)

            Rectangle()
                .fill(IslandPalette.line)
                .frame(height: 1)

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    ForEach(model.groupedSessions) { group in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(group.label)
                                .font(.system(size: 10, weight: .medium))
                                .foregroundColor(IslandPalette.secondary)
                                .padding(.horizontal, 10)
                                .padding(.bottom, 2)
                            ForEach(group.sessions) { session in
                                sessionRow(session)
                            }
                        }
                    }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 10)
            }
            .frame(maxHeight: 390)
        }
        .frame(width: 420)
    }

    private func sessionRow(_ session: AgentSession) -> some View {
        AgentSessionRow(model: model, session: session)
    }

    private var collapsedTitle: String {
        guard let session = model.primarySession else { return "CodeVetter" }
        return "\(session.displayName) · \(session.status.label)"
    }

    private var collapsedSubtitle: String {
        guard let session = model.primarySession else { return "No active agents" }
        if session.roleLabel != nil {
            return "\(session.providerDisplayName) · \(session.project) · \(session.reason)"
        }
        return "\(session.project) · \(session.reason)"
    }

    private var collapsedAccessibilityLabel: String {
        guard let session = model.primarySession else { return "CodeVetter, no active agents" }
        let primary = accessibilitySnapshot(for: session, expanded: false).summary
        return "\(primary) Current team: \(model.teamSummary.accessibilityLabel)."
    }

    private var summaryText: String {
        let help = model.sessions.filter { $0.status == .needsHelp }.count
        let working = model.sessions.filter { $0.status == .working }.count
        if help > 0 { return "\(help) need\(help == 1 ? "s" : "") you · \(working) working" }
        if working > 0 { return "\(working) working across \(model.projectCount) projects" }
        return "\(model.sessions.count) recent sessions"
    }

    private func statusDot(_ status: AgentStatus?) -> some View {
        Circle()
            .fill(statusColor(status ?? .paused))
            .frame(width: 8, height: 8)
            .shadow(color: statusColor(status ?? .paused).opacity(0.35), radius: 5)
            .accessibilityHidden(true)
    }

    private func statusColor(_ status: AgentStatus) -> Color {
        switch status {
        case .needsHelp: return IslandPalette.amber
        case .failed: return IslandPalette.red
        case .completed: return IslandPalette.green
        case .working: return IslandPalette.green
        case .paused, .disconnected: return IslandPalette.secondary
        }
    }
}

private struct CollapsedTeamRail: View {
    let summary: CollapsedTeamSummary

    var body: some View {
        HStack(spacing: 3) {
            ForEach(summary.markers) { marker in
                ZStack(alignment: .bottomTrailing) {
                    Text(marker.label)
                        .font(.system(size: 8, weight: .bold, design: .rounded))
                        .foregroundColor(IslandPalette.primary)
                        .frame(width: 20, height: 20)
                        .background(IslandPalette.surface)
                        .clipShape(Circle())
                    Circle()
                        .fill(statusColor(marker.status))
                        .frame(width: 6, height: 6)
                        .overlay(
                            Circle()
                                .stroke(IslandPalette.background, lineWidth: 1.5)
                        )
                }
            }
            if summary.remainingCount > 0 {
                Text("+\(summary.remainingCount)")
                    .font(.system(size: 8, weight: .semibold, design: .rounded))
                    .foregroundColor(IslandPalette.secondary)
                    .padding(.horizontal, 5)
                    .frame(height: 20)
                    .background(IslandPalette.surface)
                    .clipShape(Capsule())
            }
        }
        .accessibilityHidden(true)
    }

    private func statusColor(_ status: AgentStatus) -> Color {
        switch status {
        case .needsHelp: return IslandPalette.amber
        case .failed: return IslandPalette.red
        case .completed, .working: return IslandPalette.green
        case .paused, .disconnected: return IslandPalette.secondary
        }
    }
}

private struct AgentSessionRow: View {
    @ObservedObject var model: IslandModel
    let session: AgentSession

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 8) {
                statusGlyph
                Text("\(session.project) · \(session.displayName)")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(IslandPalette.primary)
                    .lineLimit(1)
                Spacer(minLength: 8)
                metadataPill(providerName, color: IslandPalette.secondary)
                metadataPill(session.status.label, color: statusColor)
                Text(ageLabel)
                    .font(.system(size: 9, weight: .medium, design: .rounded))
                    .foregroundColor(IslandPalette.secondary)
                    .monospacedDigit()
            }

            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(session.reason)
                    .font(.system(size: 11))
                    .foregroundColor(session.status == .needsHelp ? statusColor : IslandPalette.secondary)
                    .lineLimit(2)
                Spacer(minLength: 8)
                if session.capabilities.canDeny {
                    Button("Deny") {
                        model.send(action: "deny", for: session)
                    }
                    .buttonStyle(IslandActionButtonStyle())
                    .accessibilityLabel("Deny \(session.accessibilitySubject) request")
                }
                if session.capabilities.canApprove {
                    Button("Approve once") {
                        model.send(action: "approve", for: session)
                    }
                    .buttonStyle(IslandPrimaryButtonStyle())
                    .accessibilityLabel(
                        "Approve \(session.accessibilitySubject) request once"
                    )
                }
                if session.capabilities.canFocus {
                    Button("Open") {
                        model.send(action: "focus_session", for: session)
                    }
                    .buttonStyle(IslandActionButtonStyle())
                    .accessibilityLabel(
                        "Open \(session.accessibilitySubject) in \(session.project)"
                    )
                }
                if session.capabilities.canDismiss {
                    Button(action: { model.send(action: "dismiss", for: session) }) {
                        Image(systemName: "xmark")
                            .font(.system(size: 9, weight: .semibold))
                    }
                    .buttonStyle(IslandIconButtonStyle())
                    .accessibilityLabel("Dismiss \(session.accessibilitySubject) status")
                }
            }

            if session.capabilities.canReply {
                HStack(spacing: 8) {
                    TextField("Reply…", text: replyBinding, onCommit: sendReply)
                        .textFieldStyle(PlainTextFieldStyle())
                        .font(.system(size: 11))
                        .foregroundColor(IslandPalette.primary)
                        .padding(.horizontal, 10)
                        .frame(height: 30)
                        .background(Color.black.opacity(0.28))
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .accessibilityLabel("Reply to \(session.accessibilitySubject)")
                    Button("Send", action: sendReply)
                        .buttonStyle(IslandPrimaryButtonStyle())
                        .disabled(replyValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .accessibilityLabel("Send reply to \(session.accessibilitySubject)")
                }
                .padding(.leading, 18)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, session.status == .needsHelp ? 9 : 7)
        .background(
            session.status == .needsHelp
                ? IslandPalette.amber.opacity(0.075)
                : Color.clear
        )
        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(accessibilitySnapshot(for: session, expanded: true).summary)
    }

    private func sendReply() {
        let value = replyValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return }
        model.send(action: "submit_reply", for: session, value: value)
        model.clearReplyDraft(for: session.sessionID)
    }

    private var replyValue: String {
        model.replyDraft(for: session.sessionID)
    }

    private var replyBinding: Binding<String> {
        Binding(
            get: { model.replyDraft(for: session.sessionID) },
            set: { model.setReplyDraft($0, for: session.sessionID) }
        )
    }

    private var providerName: String {
        session.providerDisplayName
    }

    private var ageLabel: String {
        let now = UInt64(Date().timeIntervalSince1970 * 1_000)
        let seconds = now > session.updatedAtMilliseconds
            ? (now - session.updatedAtMilliseconds) / 1_000
            : 0
        if seconds < 60 { return "\(seconds)s" }
        if seconds < 3_600 { return "\(seconds / 60)m" }
        return "\(seconds / 3_600)h"
    }

    private var statusGlyph: some View {
        Image(systemName: statusSymbol)
            .font(.system(size: 9, weight: .bold))
            .foregroundColor(statusColor)
            .frame(width: 12)
            .accessibilityHidden(true)
    }

    private var statusSymbol: String {
        switch session.status {
        case .needsHelp: return "exclamationmark.circle.fill"
        case .failed: return "xmark.circle.fill"
        case .completed: return "checkmark.circle.fill"
        case .working: return "circle.fill"
        case .paused: return "pause.circle.fill"
        case .disconnected: return "wifi.slash"
        }
    }

    private func metadataPill(_ label: String, color: Color) -> some View {
        Text(label)
            .font(.system(size: 9, weight: .medium))
            .foregroundColor(color)
            .padding(.horizontal, 6)
            .frame(height: 18)
            .background(color.opacity(0.1))
            .clipShape(Capsule())
    }

    private var statusColor: Color {
        switch session.status {
        case .needsHelp: return IslandPalette.amber
        case .failed: return IslandPalette.red
        case .completed, .working: return IslandPalette.green
        case .paused, .disconnected: return IslandPalette.secondary
        }
    }
}

private struct IslandActionButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 10, weight: .semibold))
            .foregroundColor(IslandPalette.primary)
            .padding(.horizontal, 10)
            .frame(height: 28)
            .background(configuration.isPressed ? Color.white.opacity(0.13) : Color.white.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

private struct IslandPrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 10, weight: .semibold))
            .foregroundColor(Color.black.opacity(0.88))
            .padding(.horizontal, 11)
            .frame(height: 28)
            .background(configuration.isPressed ? IslandPalette.amber.opacity(0.75) : IslandPalette.amber)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

private struct IslandIconButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundColor(IslandPalette.secondary)
            .frame(width: 28, height: 28)
            .background(configuration.isPressed ? Color.white.opacity(0.1) : Color.clear)
            .clipShape(Circle())
    }
}
