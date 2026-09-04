# Product

<!-- impeccable:product-schema 1 -->

## Platform

Native macOS desktop application (SwiftUI + AppKit), with CLI/MCP and
machine-readable local artifacts as primary verification surfaces.

## Users

CodeVetter serves developers and technical product owners who use coding agents
against real repositories and need to understand whether the resulting change
is correct. They work locally, often in unfamiliar or large codebases, and need
both a human-readable view of the system and compact evidence that another
agent can query.

## Product Purpose

CodeVetter determines whether a coding agent completed a software task
correctly using reproducible execution evidence. Success means the user can
move from a task and an agent-authored change to executable verification,
inspectable evidence, and a measurable verdict without trusting another model's
opinion alone.

## Positioning

CodeVetter is an execution-backed verification and evaluation system rather
than a generic code reviewer or agent control center. Its durable mechanism is
the connection between task intent, source-backed repository context,
executable checks, captured evidence, and measurable outcomes.

## Operating Context

The primary workflow is local and repository-scoped:

`task → agent change → executable verification → evidence → measurable verdict`

The CLI/MCP and machine-readable verification bundle are primary product
surfaces. The native macOS application is a local viewer over the same
evidence, graph, history, review, and testing systems. Users bring their own
Codex or Claude CLI/provider access and keep project data in a local SQLite
database.

## Capabilities and Constraints

- The active core is TypeScript/Node web-task evaluation with browser and API
  behavior, deterministic graders, benchmark cases, failure taxonomy, and
  reliability/cost/latency measurement.
- The canonical structural graph is local, syntax-aware, source-backed,
  trust-qualified, and queryable by both humans and agents.
- Structural topology is navigation evidence, not runtime proof and not an
  independent source of findings.
- CodeVetter has no hosted review server, multi-tenant collaboration layer, or
  automatic authority to publish local evidence.
- Desktop, CLI, MCP, JSON, Markdown, and offline HTML outputs must preserve the
  same evidence identities and limitations.

## Brand Commitments

The product name is CodeVetter. Product language is direct, technically honest,
and explicit about what is verified, inferred, stale, partial, blocked, or
unsupported. It avoids theatrical agent metaphors on verification surfaces and
does not present correlations, graph paths, model judgments, or fixture results
as executable proof.

## Evidence on Hand

- The committed benchmark cases, graph qualifications, warm-verification
  receipts, differential-verification receipts, and release artifacts are the
  available evidence.
- Synthetic or sample fixtures demonstrate contracts only; they must not be
  presented as proof of real agent improvement.
- No real paired evidence currently establishes that structural context
  improves coding-agent task outcomes.

## Product Principles

1. Executable outcomes outrank model opinion.
2. Every useful claim carries source identity, scope, and limitations.
3. Human views and agent tools share one canonical evidence model.
4. Local, bounded, reversible workflows are the default.
5. New capability earns investment through measured reliability, not feature
   accumulation.

## Accessibility & Inclusion

Human-facing evidence must remain understandable without color alone, usable by
keyboard, responsive at narrow and wide widths, and available through a
non-visual machine-readable representation.
