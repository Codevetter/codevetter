---
name: CodeVetter
description: An evidence-first verification workbench in ink, warm amber, and explicit semantic state.
colors:
  canvas-ink: "#000000"
  surface-ink: "#050506"
  raised-ink: "#09090b"
  elevated-ink: "#0d0d10"
  evidence-white: "#f4f4f5"
  secondary-gray: "#a1a1aa"
  muted-gray: "#8a8a93"
  action-amber: "#b87824"
  action-amber-strong: "#c9903c"
  failure-rose: "#fb7185"
  warning-gold: "#fbbf24"
  verified-green: "#4ade80"
  information-blue: "#93c5fd"
typography:
  title:
    fontFamily: "SF Pro Display, -apple-system, BlinkMacSystemFont, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.018em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-0.006em"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "0.005em"
  evidence:
    fontFamily: "SFMono-Regular, ui-monospace, Menlo, Monaco, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  compact: "0.25rem"
  control: "0.375rem"
  surface: "0.375rem"
  pill: "0.25rem"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.25rem"
  section: "1.5rem"
components:
  button-primary:
    backgroundColor: "{colors.surface-ink}"
    textColor: "{colors.action-amber-strong}"
    rounded: "{rounded.control}"
    padding: "0.5rem 1rem"
    height: "2.5rem"
  button-outline:
    backgroundColor: "{colors.raised-ink}"
    textColor: "{colors.evidence-white}"
    rounded: "{rounded.control}"
    padding: "0.5rem 1rem"
    height: "2.5rem"
  card:
    backgroundColor: "{colors.surface-ink}"
    textColor: "{colors.evidence-white}"
    rounded: "{rounded.surface}"
    padding: "{spacing.xl}"
  input:
    backgroundColor: "{colors.raised-ink}"
    textColor: "{colors.evidence-white}"
    rounded: "{rounded.control}"
    padding: "0.5rem 0.75rem"
    height: "2.5rem"
  badge:
    backgroundColor: "{colors.raised-ink}"
    textColor: "{colors.secondary-gray}"
    rounded: "{rounded.pill}"
    padding: "0.25rem 0.625rem"
---

# Design System: CodeVetter

## Overview

**Creative North Star: "The Evidence Bench"**

CodeVetter feels like a precise local instrument: dark, quiet, dense enough for
technical work, and candid about the strength of every claim. Warm amber marks
the next intentional action. Semantic colors communicate verified, warning, or
failure states only when the same meaning is also written in text or expressed
with an icon.

The interface should recede behind source identities, runtime results, and
limitations. It avoids theatrical agent imagery, decorative dashboards, and
oversized presentation typography on operating surfaces.

**Key Characteristics:**

- A true-black canvas with near-black working planes separated by restrained
  hairline borders.
- Compact native-feeling controls with generous focus treatment.
- Muted amber used sparingly as a line, label, or focus marker rather than an
  ambient fill.
- Monospace reserved for paths, revisions, commands, and evidence identities.
- Every state remains understandable without color alone.

## Colors

The palette is true-black ink with a single warm action voice and explicit
semantic evidence colors. Chrome remains true black; working planes rise only
1–5% above it so hierarchy survives without turning the product charcoal.
Hairline borders carry the remaining separation instead of grey fill.

Light appearance is a native counterpart, not an inverted dark skin. It uses a
warm `#f7f6f3` canvas, quieter `#f1f0ed` chrome, white evidence planes, and a
soft `#f3f2ef` inspector. Amber keeps the same action and selection meaning;
amber text and icons deepen independently of the bright action fill, and
success, warning, and failure colors use darker light-mode counterparts so
normal-size evidence text retains at least 4.5:1 contrast. Semantic status
colors retain their written labels. Review, Testing,
Performance, and Runs must preserve the same evidence hierarchy and control
priority in both appearances.

### Primary

- **Action Amber:** the border or marker for the single primary action and
  selected navigation.
- **Action Amber Strong:** readable action text and keyboard focus, not a large
  decorative fill.

### Neutral

- **Canvas Ink:** the true-black application background and deepest plane.
- **Surface Ink:** the almost-black default card and panel plane.
- **Raised Ink:** a subtly lighter control and nested-evidence plane.
- **Elevated Ink:** the highest near-black overlay or inspector plane.
- **Evidence White:** primary text and decisive result labels.
- **Secondary Gray:** supporting explanations and metadata.
- **Muted Gray:** placeholders and low-priority context.

### Named Rules

**The One Warm Voice Rule.** Amber identifies intentional action or active
verification context; it is not ambient decoration.

**The Written State Rule.** Green, gold, rose, and blue may reinforce meaning,
but a label or icon must communicate the same state.

## Typography

**Display Font:** SF Pro Display with system sans-serif fallbacks  
**Body Font:** SF Pro Text with native system fallbacks  
**Label/Mono Font:** SFMono-Regular with platform monospace fallbacks

**Character:** Native, compact, and technically literate. Tight tracking makes
headings feel deliberate, while body copy stays readable at workbench density.

### Hierarchy

- **Title:** semibold, compact headings for pages, cards, and evidence sections.
- **Body:** regular system text for instructions and result summaries.
- **Label:** medium 12px text for fields, metrics, and quiet control context.
- **Evidence:** monospace 12px text for immutable or machine-relevant identity.

### Named Rules

**The Evidence Type Rule.** Monospace signals data a user may compare, copy, or
feed to another tool; prose and actions stay in the system sans.

## Brand Mark

The CodeVetter mark preserves its familiar code-scope brackets and central
verdict stroke, redrawn as a restrained native instrument. Amber brackets bound
the change under review; the evidence-white stroke records its verified
outcome. Semantic verification and security icons remain separate and may
continue to use platform symbols.

- Use the true-black squircle for application icons and identity lockups.
- Preserve generous optical padding and rounded stroke terminals from 16px to
  1024px; do not add gradients, glow, or extra status colors.
- Use `assets/brand/codevetter-mark.svg` as the canonical source and regenerate
  platform mirrors with `pnpm brand:generate`.
- Use `codevetter-glyph.svg` only where the surrounding platform supplies the
  background; use the opaque iOS master for platform icons that reject alpha.
- The amber brackets and white verdict must remain distinguishable without
  relying on shadows or fine border detail.

## Layout

The desktop shell has a persistent top navigation and repository sidebar, with
a configured minimum window size of 980 x 640 points. Operating pages use a
centered, wide workbench column and stack compact bordered panels vertically.

Cards use 20px internal padding and 24px section rhythm by default. Dense form
rows may align horizontally when space permits, then stack without changing
task order. Nested evidence moves from multi-column to single-column before
labels or values are compressed. Long paths and URLs truncate locally rather
than widening the page.

### Review Workbench

Completed reviews use a source-first desktop composition. The repository name
and local path precede the change range and reviewer in the persistent header,
so evidence is never detached from its project scope. The selected finding is
anchored over the relevant source, while findings, executable evidence,
history, and limitations live in a compact lower dock. The repository sidebar
and global command bar remain outside this workbench.

## Elevation & Depth

Depth is structural rather than glossy. Hairline borders and restrained tonal
steps separate planes. The operating surface uses no glow, glass, highlight,
or decorative shadow.

**The Flat Evidence Rule.** Evidence rows are stable nested planes; hover lift
and decorative transform are reserved for actionable controls.

## Shapes

Controls and evidence planes use restrained 4–6px corners. Status is an inline
dot and written label, not a filled capsule. Borders carry hierarchy and
strengthen on hover or focus.

## Components

### Buttons

- **Shape:** compact 6px controls at a 40px default height.
- **Primary:** near-black surface, muted amber label and hairline border, with
  no shadow or glow.
- **Secondary / Outline:** raised ink or translucent white with a hairline
  border.
- **Focus:** visible amber ring offset against the canvas.
- **Disabled:** lower opacity with pointer and pressed motion removed.

### Chips

Chips are reserved for interactive filters. Status never masquerades as a
filter: it uses an inline marker and text without a filled capsule.

- **Style:** compact interactive filters use a quiet outline and short text.
- **State:** selected filters use a bottom rule; semantic status stays inline
  and pairs color with explicit wording.

### Cards / Containers

- **Corner Style:** 6px primary cards; 4–6px nested evidence.
- **Background:** true black or a one-step ink surface.
- **Shadow Strategy:** none on operating surfaces.
- **Border:** neutral hairlines by default; amber only for current focus.
- **Internal Padding:** 20px primary, 12–16px nested.

### Inputs / Fields

- **Style:** 40px raised-ink control, light hairline border, evidence-white
  text, and muted placeholder.
- **Focus:** stronger amber border, faint amber ring, and slightly lighter fill.
- **Error / Disabled:** written error nearby; disabled fields visibly recede.

### Navigation

The top rail uses icon-and-label items with a quiet default state and a thin
amber active rule. The repository sidebar stays structural, separate from the
current task surface.

## Do's and Don'ts

### Do:

- **Do** lead with the action, exact identity, verdict, and limitation.
- **Do** reuse the established card, input, button, badge, and focus patterns.
- **Do** keep verification forms compact and preserve evidence below the action.
- **Do** provide loading, empty, error, limited, failed, and no-confidence
  states with plain-language labels.

### Don't:

- **Don't** present model opinion, topology, or a fixture as executable proof.
- **Don't** use amber across large decorative regions or for non-action accents.
- **Don't** communicate pass, warning, or failure through color alone.
- **Don't** add floating glass cards, hero typography, or agent theater to
  operating surfaces.
