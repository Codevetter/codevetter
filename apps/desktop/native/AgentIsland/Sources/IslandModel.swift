import Combine
import Foundation

struct AgentSessionGroup: Identifiable, Equatable {
    let id: String
    let label: String
    let sessions: [AgentSession]
}

enum AutomaticPresentationKind: Equatable {
    case attention
    case informational
}

struct AutomaticPresentation: Equatable {
    let sessionID: String
    let eventID: String
    let kind: AutomaticPresentationKind
}

enum IslandPresentation: Equatable {
    case collapsed
    case userExpanded
    case automatic(AutomaticPresentation)

    var expanded: Bool {
        self != .collapsed
    }

    var requiresKeyboardActivation: Bool {
        self == .userExpanded
    }

    var isInformationalAutomatic: Bool {
        guard case let .automatic(presentation) = self else { return false }
        return presentation.kind == .informational
    }
}

struct CollapsedTeamMarker: Identifiable, Equatable {
    let sessionID: String
    let label: String
    let status: AgentStatus
    let accessibilityLabel: String

    var id: String { sessionID }
}

struct CollapsedTeamSummary: Equatable {
    let markers: [CollapsedTeamMarker]
    let remainingCount: Int

    var accessibilityLabel: String {
        let visible = markers.map(\.accessibilityLabel).joined(separator: "; ")
        guard remainingCount > 0 else { return visible }
        return "\(visible); \(remainingCount) more"
    }
}

func stableSessionGroups(_ sessions: [AgentSession]) -> [AgentSessionGroup] {
    let projects = Dictionary(grouping: sessions, by: \.project)
    return projects.keys.sorted().flatMap { project -> [AgentSessionGroup] in
        let projectSessions = projects[project, default: []]
        let unteamed = projectSessions.filter { $0.teamID == nil }
        let teamIDs = Set(projectSessions.compactMap(\.teamID)).sorted()
        var groups = [AgentSessionGroup]()
        if !unteamed.isEmpty {
            groups.append(
                AgentSessionGroup(
                    id: "\(project)\u{0000}legacy",
                    label: project,
                    sessions: orderedSessions(unteamed)
                )
            )
        }
        for (index, teamID) in teamIDs.enumerated() {
            groups.append(
                AgentSessionGroup(
                    id: "\(project)\u{0000}\(teamID)",
                    label: "\(project) · Team \(index + 1)",
                    sessions: orderedSessions(
                        projectSessions.filter { $0.teamID == teamID }
                    )
                )
            )
        }
        return groups
    }
}

func orderedSessions(_ sessions: [AgentSession]) -> [AgentSession] {
    sessions.sorted {
        if $0.status.priority != $1.status.priority {
            return $0.status.priority < $1.status.priority
        }
        return $0.updatedAtMilliseconds > $1.updatedAtMilliseconds
    }
}

func automaticPresentationCandidate(
    previous: [AgentSession],
    current: [AgentSession],
    preview: Bool
) -> AutomaticPresentation? {
    guard !preview else { return nil }
    let previousEvents = Dictionary(
        uniqueKeysWithValues: previous.map { ($0.sessionID, $0.eventID) }
    )
    let eligible = orderedSessions(current).filter { session in
        guard previousEvents[session.sessionID] != session.eventID else { return false }
        switch session.status {
        case .needsHelp:
            return session.confirmed
        case .failed, .completed:
            return true
        case .working, .paused, .disconnected:
            return false
        }
    }
    guard let session = eligible.first else { return nil }
    return AutomaticPresentation(
        sessionID: session.sessionID,
        eventID: session.eventID,
        kind: session.status == .needsHelp ? .attention : .informational
    )
}

func collapsedTeamSummary(
    _ sessions: [AgentSession],
    maximumVisible: Int = 3
) -> CollapsedTeamSummary {
    let ordered = orderedSessions(sessions)
    let visibleCount = max(0, maximumVisible)
    let markers = ordered.prefix(visibleCount).map { session in
        CollapsedTeamMarker(
            sessionID: session.sessionID,
            label: compactMarkerLabel(for: session),
            status: session.status,
            accessibilityLabel:
                "\(session.displayName) using \(session.providerDisplayName), "
                + "\(session.project), \(session.status.label)"
        )
    }
    return CollapsedTeamSummary(
        markers: Array(markers),
        remainingCount: max(0, ordered.count - markers.count)
    )
}

private func compactMarkerLabel(for session: AgentSession) -> String {
    let source = session.displayName.trimmingCharacters(in: .whitespacesAndNewlines)
    let words = source.split(whereSeparator: \.isWhitespace)
    if words.count > 1 {
        return words.prefix(2).compactMap(\.first).map(String.init).joined().uppercased()
    }
    return source.first.map { String($0).uppercased() } ?? "A"
}

final class IslandModel: ObservableObject {
    @Published private(set) var sessions: [AgentSession] = []
    @Published private(set) var settings: IslandSettings?
    @Published private(set) var presentation: IslandPresentation = .collapsed
    @Published private(set) var preview = false
    @Published private(set) var latestOutcome: String?
    @Published private var replyDrafts: [String: String] = [:]

    private let speech = SpeechController()
    private let automaticCollapseDelay: TimeInterval
    private var outgoingSequence: UInt64 = 0
    private let outputLock = NSLock()
    private var automaticCollapseWorkItem: DispatchWorkItem?
    private var pointerInside = false

    init(automaticCollapseDelay: TimeInterval = 10) {
        self.automaticCollapseDelay = automaticCollapseDelay
    }

    var expanded: Bool {
        presentation.expanded
    }

    var primarySession: AgentSession? {
        orderedSessions(sessions).first
    }

    var groupedSessions: [AgentSessionGroup] {
        stableSessionGroups(sessions)
    }

    var teamSummary: CollapsedTeamSummary {
        collapsedTeamSummary(sessions)
    }

    var projectCount: Int {
        Set(sessions.map(\.project)).count
    }

    var hasPendingAutomaticCollapse: Bool {
        automaticCollapseWorkItem != nil
    }

    func apply(_ snapshot: IslandSnapshot) {
        let previous = sessions
        let candidate = automaticPresentationCandidate(
            previous: previous,
            current: snapshot.sessions,
            preview: snapshot.preview
        )
        let previousEvents = Dictionary(uniqueKeysWithValues: previous.map { ($0.sessionID, $0.eventID) })
        if snapshot.sessions.contains(where: { session in
            previousEvents[session.sessionID].map { $0 != session.eventID } ?? false
        }) {
            latestOutcome = nil
        }
        speech.apply(previous: previous, snapshot: snapshot)
        sessions = snapshot.sessions
        settings = snapshot.settings
        preview = snapshot.preview
        if sessions.isEmpty {
            setPresentation(.collapsed)
            return
        }
        reconcilePresentation(candidate: candidate)
    }

    func toggleExpanded() {
        switch presentation {
        case .collapsed:
            setPresentation(.userExpanded)
        case .userExpanded, .automatic:
            setPresentation(.collapsed)
        }
    }

    func setPointerInside(_ inside: Bool) {
        pointerInside = inside
        guard presentation.isInformationalAutomatic else { return }
        if inside {
            cancelAutomaticCollapse()
        } else {
            scheduleAutomaticCollapse()
        }
    }

    func apply(_ result: ActionResult) {
        latestOutcome = result.disposition == "accepted"
            ? "Action sent"
            : (result.error ?? "Action is no longer available")
    }

    func replyDraft(for sessionID: String) -> String {
        replyDrafts[sessionID, default: ""]
    }

    func setReplyDraft(_ value: String, for sessionID: String) {
        replyDrafts[sessionID] = value
    }

    func clearReplyDraft(for sessionID: String) {
        replyDrafts.removeValue(forKey: sessionID)
    }

    func send(action: String, for session: AgentSession, value: String? = nil) {
        sendEnvelope(
            kind: "intent",
            payload: AgentIntent(
                action: action,
                sessionID: session.sessionID,
                eventID: session.eventID,
                value: value
            )
        )
    }

    private func reconcilePresentation(candidate: AutomaticPresentation?) {
        switch presentation {
        case .userExpanded:
            cancelAutomaticCollapse()
        case let .automatic(current):
            if let candidate,
               candidate != current,
               candidate.kind == .attention || current.kind == .informational {
                setPresentation(.automatic(candidate))
            } else if automaticPresentationIsCurrent(current) {
                refreshAutomaticCollapse()
            } else if let candidate {
                setPresentation(.automatic(candidate))
            } else {
                setPresentation(.collapsed)
            }
        case .collapsed:
            guard let candidate else { return }
            setPresentation(.automatic(candidate))
        }
    }

    private func automaticPresentationIsCurrent(_ automatic: AutomaticPresentation) -> Bool {
        guard let session = sessions.first(where: {
            $0.sessionID == automatic.sessionID && $0.eventID == automatic.eventID
        }) else {
            return false
        }
        switch automatic.kind {
        case .attention:
            return session.status == .needsHelp && session.confirmed
        case .informational:
            return session.status == .failed || session.status == .completed
        }
    }

    private func setPresentation(_ next: IslandPresentation) {
        guard presentation != next else {
            refreshAutomaticCollapse()
            return
        }
        cancelAutomaticCollapse()
        presentation = next
        refreshAutomaticCollapse()
    }

    private func refreshAutomaticCollapse() {
        guard presentation.isInformationalAutomatic, !pointerInside else {
            cancelAutomaticCollapse()
            return
        }
        guard automaticCollapseWorkItem == nil else { return }
        scheduleAutomaticCollapse()
    }

    private func scheduleAutomaticCollapse() {
        cancelAutomaticCollapse()
        guard presentation.isInformationalAutomatic, !pointerInside else { return }
        let item = DispatchWorkItem { [weak self] in
            guard let self,
                  self.presentation.isInformationalAutomatic,
                  !self.pointerInside else {
                return
            }
            self.automaticCollapseWorkItem = nil
            self.presentation = .collapsed
        }
        automaticCollapseWorkItem = item
        DispatchQueue.main.asyncAfter(
            deadline: .now() + automaticCollapseDelay,
            execute: item
        )
    }

    private func cancelAutomaticCollapse() {
        automaticCollapseWorkItem?.cancel()
        automaticCollapseWorkItem = nil
    }

    func acknowledgeRender(
        sourceSequence: UInt64,
        receivedAtMilliseconds: UInt64,
        appliedAtMilliseconds: UInt64
    ) {
        sendEnvelope(
            kind: "render_ack",
            payload: RenderAcknowledgement(
                sourceSequence: sourceSequence,
                receivedAtMilliseconds: receivedAtMilliseconds,
                appliedAtMilliseconds: appliedAtMilliseconds
            )
        )
    }

    private func sendEnvelope<Payload: Encodable>(kind: String, payload: Payload) {
        outputLock.lock()
        defer { outputLock.unlock() }
        outgoingSequence &+= 1
        let envelope = OutgoingEnvelope(
            version: protocolVersion,
            sequence: max(outgoingSequence, 1),
            sentAtMilliseconds: UInt64(Date().timeIntervalSince1970 * 1_000),
            kind: kind,
            payload: payload
        )
        guard var data = try? JSONEncoder().encode(envelope),
              data.count < maximumMessageBytes
        else {
            return
        }
        data.append(0x0A)
        FileHandle.standardOutput.write(data)
    }
}
