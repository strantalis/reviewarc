# Product

## Register

product

## Platform

web

## Users

ReviewArc is for experienced software engineers who review pull requests across codebases they know partially but not completely. They need to build a defensible understanding of behavioral changes, risk, evidence, and test coverage without surrendering the approval decision to automation.

The primary user is often moving across many repositories, resuming interrupted reviews, and deciding whether a change is safe enough to approve. They value dense information, keyboard efficiency, accurate provenance, private working notes, and clear boundaries between local work and externally visible GitHub actions.

## Product Purpose

ReviewArc is a local-first desktop review client for understanding and reviewing GitHub pull requests. It replaces the checkout-first workflow with a unified inbox, fetches exact base and head revisions into ReviewArc-owned managed Git storage, and turns analysis from Codex or Claude Code into a guided, evidence-backed review journey.

The current product flow is to authenticate through the installed GitHub CLI, select repository sources, open a pull request, inspect its overview and real diffs, work chapter by chapter through validated findings, preserve private notes and progress, draft review feedback, and explicitly preview and confirm anything published to GitHub.

Trust is part of the product surface. Facts, paths, and line ranges are checked against pinned Git objects. Unsupported claims remain visibly unverified. Stale analysis is identified when the pull request changes. ReviewArc does not run project commands, modify a user's working checkout, or publish feedback without confirmation.

## Positioning

ReviewArc is a focused review instrument, not an automated reviewer. It helps engineers construct and verify their own understanding of a change while keeping the human reviewer responsible for the final judgment.

Its distinguishing qualities are local-first operation, exact-revision provenance, a guided narrative through complex changes, explicit uncertainty, resumable private state, and deliberate publication boundaries. It complements GitHub's collaboration surface rather than replacing GitHub or pretending that generated analysis is authoritative.

## Brand Personality

Rigorous, calm, and confidence-building. ReviewArc should feel candid about uncertainty, precise about provenance, and quietly helpful during sustained daily use.

The writing voice is direct and technical without sounding robotic. It names what happened, what is known, what remains uncertain, and what the reviewer can do next. It never uses hype, false certainty, or playful language around consequential actions.

## Anti-references

- Generic SaaS dashboards and card soup that flatten every piece of information into an equal container.
- AI review autopilots that replace reviewer judgment or imply that approval can be delegated to a model.
- Glossy, neon, glassy, or playful visual treatments that weaken the product's technical credibility.
- Black-box confidence, hidden uncertainty, or unsupported claims presented as facts.
- Over-spacious marketing layouts or compressed microtype that make sustained review slower.
- Decorative motion, gamification, and celebration around routine or consequential review actions.

## Design Principles

1. **Evidence before assertion.** Every risk, inference, and unknown should lead back to real code or metadata.
2. **Preserve the review arc.** Orient reviewers from inbox to change summary to guided chapters to a deliberate decision.
3. **Dense, never cramped.** Prioritize scanability, stable panel geometry, and progressive disclosure over decorative whitespace.
4. **Make uncertainty visible.** Distinguish facts, inferences, unsupported claims, stale analysis, and operational errors in both language and presentation.
5. **Keep agency explicit.** Local progress can be optimistic; publishing feedback always requires a clear confirmation boundary.
6. **Respect local trust boundaries.** Show when data leaves the machine, avoid touching user checkouts, and never disguise externally visible actions as local state changes.

## Accessibility & Inclusion

All primary workflows must be keyboard-operable with visible focus and clear focus order. Interactive targets should remain usable at compact desktop widths and on coarse pointers. Motion must be limited to purposeful state feedback and respect reduced-motion preferences.

Status must never rely on color alone: pair semantic color with text, icons, or shape. Maintain readable contrast in light, dark, and system themes; preserve text resizing and overflow behavior; and keep body and control type large enough for sustained technical reading.

Use plain, specific language for model output, failures, stale state, and publication consequences. Avoid idioms, blame, and confidence theater. Confirmation dialogs must identify the external effect before the user commits it.
