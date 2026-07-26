import Combine
import Foundation

struct AgentSessionGroup: Identifiable, Equatable {
    let id: String
    let label: String
    let sessions: [AgentSession]
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
                    sessions: sortedSessions(unteamed)
                )
            )
        }
        for (index, teamID) in teamIDs.enumerated() {
            groups.append(
                AgentSessionGroup(
                    id: "\(project)\u{0000}\(teamID)",
                    label: "\(project) · Team \(index + 1)",
                    sessions: sortedSessions(
                        projectSessions.filter { $0.teamID == teamID }
                    )
                )
            )
        }
        return groups
    }
}

private func sortedSessions(_ sessions: [AgentSession]) -> [AgentSession] {
    sessions.sorted {
        if $0.status.priority != $1.status.priority {
            return $0.status.priority < $1.status.priority
        }
        return $0.updatedAtMilliseconds > $1.updatedAtMilliseconds
    }
}

final class IslandModel: ObservableObject {
    @Published private(set) var sessions: [AgentSession] = []
    @Published private(set) var settings: IslandSettings?
    @Published var expanded = false
    @Published private(set) var preview = false
    @Published private(set) var latestOutcome: String?
    @Published private var replyDrafts: [String: String] = [:]

    private let speech = SpeechController()
    private var outgoingSequence: UInt64 = 0
    private let outputLock = NSLock()

    var primarySession: AgentSession? {
        sessions.sorted {
            if $0.status.priority != $1.status.priority {
                return $0.status.priority < $1.status.priority
            }
            return $0.updatedAtMilliseconds > $1.updatedAtMilliseconds
        }.first
    }

    var groupedSessions: [AgentSessionGroup] {
        stableSessionGroups(sessions)
    }

    var projectCount: Int {
        Set(sessions.map(\.project)).count
    }

    func apply(_ snapshot: IslandSnapshot) {
        let previous = sessions
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
            expanded = false
        }
    }

    func toggleExpanded() {
        expanded.toggle()
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
