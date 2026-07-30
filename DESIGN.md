---
name: CodeVetter
description: An evidence-first verification workbench in ink, warm amber, and explicit semantic state.
colors:
  canvas-ink: "#060708"
  surface-ink: "#0c0d0f"
  raised-ink: "#111316"
  elevated-ink: "#17191d"
  evidence-white: "#f4f4f5"
  secondary-gray: "#a1a1aa"
  muted-gray: "#8a8a93"
  action-amber: "#f3ad3d"
  action-amber-strong: "#ffc75e"
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
  compact: "0.5rem"
  control: "0.625rem"
  surface: "0.75rem"
  pill: "9999px"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.25rem"
  section: "1.5rem"
components:
  button-primary:
    backgroundColor: "{colors.action-amber}"
    textColor: "{colors.canvas-ink}"
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

- Ink surfaces separated by restrained tonal steps and hairline borders.
- Compact native-feeling controls with generous focus treatment.
- Warm amber used sparingly for action, selection, and verification emphasis.
- Monospace reserved for paths, revisions, commands, and evidence identities.
- Every state remains understandable without color alone.

## Colors

The palette is near-black ink with a single warm action voice and explicit
semantic evidence colors.

### Primary

- **Action Amber:** the primary action, selected navigation, and focused
  verification emphasis.
- **Action Amber Strong:** hover and high-attention action state.

### Neutral

- **Canvas Ink:** the application background and deepest visual plane.
- **Surface Ink:** the default card and panel plane.
- **Raised Ink:** controls and nested evidence tiles.
- **Elevated Ink:** overlays or deliberately elevated sub-surfaces.
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

## Layout

The desktop shell has a persistent top navigation and repository sidebar, with
a configured minimum window width of 900px. Operating pages use a centered,
wide workbench column and stack compact bordered panels vertically.

Cards use 20px internal padding and 24px section rhythm by default. Dense form
rows may align horizontally when space permits, then stack without changing
task order. Nested evidence moves from multi-column to single-column before
labels or values are compressed. Long paths and URLs truncate locally rather
than widening the page.

## Elevation & Depth

Depth is primarily tonal and structural. Hairline translucent borders, subtle
top-edge highlights, and inset highlights separate planes. Large diffuse
shadows support major cards or glass overlays but never imitate floating
marketing tiles.

**The Flat Evidence Rule.** Evidence rows are stable nested planes; hover lift
and decorative transform are reserved for actionable controls.

## Shapes

Controls use gently curved 8–10px corners. Primary panels and cards use 12px
corners. Status badges are full pills, while evidence rows and metric tiles use
compact corners so dense results remain orderly. Borders are low-contrast at
rest and strengthen on hover or focus.

## Components

### Buttons

- **Shape:** compact rounded controls at a 40px default height.
- **Primary:** amber fill, ink text, restrained warm shadow, and a brighter
  amber hover.
- **Secondary / Outline:** raised ink or translucent white with a hairline
  border.
- **Focus:** visible amber ring offset against the canvas.
- **Disabled:** lower opacity with pointer and pressed motion removed.

### Chips

- **Style:** full-pill or compact status forms with a translucent fill,
  hairline border, short text, and optional 12–14px icon.
- **State:** selected or semantic variants pair color with explicit wording.

### Cards / Containers

- **Corner Style:** 12px primary cards; 8–10px nested evidence.
- **Background:** ink surfaces in deliberate tonal steps.
- **Shadow Strategy:** diffuse only on major planes, inset highlight on raised
  controls and cards.
- **Border:** translucent white by default; amber tint for a verification focus.
- **Internal Padding:** 20px primary, 12–16px nested.

### Inputs / Fields

- **Style:** 40px raised-ink control, light hairline border, evidence-white
  text, and muted placeholder.
- **Focus:** stronger amber border, faint amber ring, and slightly lighter fill.
- **Error / Disabled:** written error nearby; disabled fields visibly recede.

### Navigation

The top rail uses icon-and-label items with a quiet default state, subtle hover
fill, and amber-bordered active state. The repository sidebar stays structural,
separate from the current task surface.

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
