import Foundation

func runSelfTests() -> Int32 {
    do {
        let payload = """
        {
          "v": 1,
          "seq": 2,
          "sent_at_ms": 100,
          "kind": "snapshot",
          "payload": {
            "sessions": [],
            "settings": {
              "enabled": true,
              "speech": {
                "muted": false,
                "completion_enabled": true,
                "attention_enabled": true,
                "failure_enabled": true,
                "codex_voice": null,
                "claude_voice": null,
                "rate": 0.48,
                "volume": 0.8,
                "quiet_hours_start": null,
                "quiet_hours_end": null,
                "cooldown_seconds": 30
              }
            },
            "preview": false
          }
        }
        """
        let envelope = try ProtocolParser.decode(Data(payload.utf8))
        try require(envelope.version == 1, "protocol version")
        try require(envelope.payload?.sessions == [], "empty snapshot")

        let actionPayload = """
        {
          "v": 1,
          "seq": 3,
          "sent_at_ms": 101,
          "kind": "action_result",
          "payload": {
            "request_seq": 2,
            "session_id": "session-1",
            "event_id": "event-1",
            "disposition": "rejected",
            "error": "Request is stale"
          }
        }
        """
        let actionEnvelope = try ProtocolParser.decode(Data(actionPayload.utf8))
        try require(actionEnvelope.actionResult?.requestSequence == 2, "action result identity")
        try require(actionEnvelope.actionResult?.disposition == "rejected", "action disposition")

        let legacySessionPayload = """
        {
          "session_id": "legacy-session",
          "event_id": "legacy-event",
          "provider": "codex",
          "project": "CodeVetter",
          "status": "working",
          "reason": "Running",
          "confirmed": true,
          "started_at_ms": 1,
          "updated_at_ms": 2,
          "capabilities": {
            "can_focus": true,
            "can_reply": false,
            "can_approve": false,
            "can_deny": false,
            "can_snooze": true,
            "can_dismiss": true
          }
        }
        """
        let legacySession = try JSONDecoder().decode(
            AgentSession.self,
            from: Data(legacySessionPayload.utf8)
        )
        try require(legacySession.roleLabel == nil, "legacy role omission")
        try require(legacySession.teamID == nil, "legacy team omission")
        try require(legacySession.displayName == "Codex", "legacy presentation")

        let teamSessionPayload = legacySessionPayload
            .replacingOccurrences(
                of: #""project": "CodeVetter","#,
                with: """
                "project": "CodeVetter",
                "role_label": "Verification",
                "team_id": "team-1",
                """
            )
        let teamSession = try JSONDecoder().decode(
            AgentSession.self,
            from: Data(teamSessionPayload.utf8)
        )
        try require(teamSession.displayName == "Verification", "role rendering")
        try require(teamSession.teamDisplayName == "Team member", "team rendering")
        let teamAccessibility = accessibilitySnapshot(for: teamSession, expanded: true)
        try require(
            teamAccessibility.summary.contains("Verification role"),
            "role accessibility summary"
        )
        try require(
            teamAccessibility.summary.contains("team member"),
            "team accessibility summary"
        )
        try require(
            !teamAccessibility.summary.contains("team-1"),
            "opaque team identity remains hidden"
        )
        try require(
            teamAccessibility.actions.first
                == "Open Verification agent using Codex in CodeVetter",
            "role accessibility action"
        )
        let secondTeamSession = try JSONDecoder().decode(
            AgentSession.self,
            from: Data(
                teamSessionPayload
                    .replacingOccurrences(of: "legacy-session", with: "second-session")
                    .replacingOccurrences(of: "legacy-event", with: "second-event")
                    .replacingOccurrences(of: "team-1", with: "team-2")
                    .utf8
            )
        )
        let teamGroups = stableSessionGroups([secondTeamSession, teamSession])
        try require(
            teamGroups.map(\.label) == ["CodeVetter · Team 1", "CodeVetter · Team 2"],
            "same-project teams are disambiguated"
        )
        try require(
            stableSessionGroups([legacySession]).map(\.label) == ["CodeVetter"],
            "legacy project grouping"
        )

        do {
            _ = try ProtocolParser.decode(
                Data(repeating: 0x41, count: maximumMessageBytes + 1)
            )
            throw SelfTestError.failed("oversized message was accepted")
        } catch ProtocolError.invalidSize {
            // Expected.
        }

        try require(
            AgentStatus.needsHelp.priority < AgentStatus.failed.priority,
            "attention priority"
        )
        try require(
            AgentStatus.failed.priority < AgentStatus.completed.priority,
            "failure priority"
        )
        try require(
            AgentStatus.completed.priority < AgentStatus.working.priority,
            "completion priority"
        )
        try require(
            islandTopBoundary(
                frameMaxY: 1_000,
                visibleFrameMaxY: 980,
                safeAreaTop: 42
            ) == 958,
            "notch-safe top boundary"
        )
        try require(
            islandTopBoundary(
                frameMaxY: 1_000,
                visibleFrameMaxY: 975,
                safeAreaTop: 0
            ) == 975,
            "no-notch top boundary"
        )
        let accessibleSession = AgentSession(
            sessionID: "session-1",
            eventID: "event-1",
            provider: "codex",
            project: "CodeVetter",
            roleLabel: nil,
            teamID: nil,
            status: .needsHelp,
            reason: "Waiting for approval",
            confirmed: true,
            startedAtMilliseconds: 1,
            updatedAtMilliseconds: 2,
            capabilities: AgentCapabilities(
                canFocus: true,
                canReply: true,
                canApprove: true,
                canDeny: true,
                canSnooze: true,
                canDismiss: true
            )
        )
        let compactAccessibility = accessibilitySnapshot(
            for: accessibleSession,
            expanded: false
        )
        try require(
            compactAccessibility.summary.contains("Expand agent island"),
            "compact accessibility summary"
        )
        let expandedAccessibility = accessibilitySnapshot(
            for: accessibleSession,
            expanded: true
        )
        try require(
            expandedAccessibility.actions == [
                "Open Codex in CodeVetter",
                "Deny Codex request",
                "Approve Codex request once",
                "Reply to Codex",
                "Send reply to Codex",
                "Dismiss Codex status",
            ],
            "expanded keyboard and VoiceOver action order"
        )
        try require(
            isQuietHour(start: 22, end: 7, hour: 23),
            "overnight quiet hours"
        )
        try require(
            !isQuietHour(start: 22, end: 7, hour: 12),
            "quiet hours allow daytime"
        )
        FileHandle.standardError.write(Data("Agent Island self-tests passed\n".utf8))
        return 0
    } catch {
        FileHandle.standardError.write(Data("Agent Island self-test failed: \(error)\n".utf8))
        return 1
    }
}

private func require(_ condition: @autoclosure () -> Bool, _ label: String) throws {
    if !condition() {
        throw SelfTestError.failed(label)
    }
}

private enum SelfTestError: Error, CustomStringConvertible {
    case failed(String)

    var description: String {
        switch self {
        case let .failed(label): return label
        }
    }
}
