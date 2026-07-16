---
name: ReviewArc
description: "A calm, evidence-first review instrument for complex pull requests."
colors:
  ink: "oklch(0.23 0.035 265)"
  muted: "oklch(0.43 0.03 265)"
  subtle: "oklch(0.52 0.025 265)"
  canvas: "oklch(0.975 0.006 260)"
  surface: "oklch(0.995 0.003 260)"
  panel: "oklch(0.955 0.012 260)"
  line: "oklch(0.88 0.018 260)"
  line-strong: "oklch(0.78 0.032 260)"
  accent: "oklch(0.55 0.19 265)"
  accent-dark: "oklch(0.42 0.17 265)"
  accent-soft: "oklch(0.94 0.035 265)"
  cyan: "oklch(0.67 0.13 215)"
  cyan-soft: "oklch(0.94 0.04 215)"
  green: "oklch(0.55 0.15 158)"
  green-soft: "oklch(0.94 0.045 158)"
  amber: "oklch(0.65 0.15 78)"
  amber-soft: "oklch(0.95 0.05 78)"
  red: "oklch(0.56 0.2 28)"
  red-dark: "oklch(0.46 0.18 28)"
  red-soft: "oklch(0.95 0.04 28)"
  on-accent: "oklch(0.985 0.005 260)"
  code-surface: "oklch(0.965 0.009 265)"
  code-add: "oklch(0.955 0.035 158)"
  code-delete: "oklch(0.96 0.03 28)"
typography:
  marketing-display:
    fontFamily: '"Commissioner", "Avenir Next", "Segoe UI", sans-serif'
    fontSize: "clamp(3rem, 7.7vw, 5.75rem)"
    fontWeight: 700
    lineHeight: 0.98
    letterSpacing: "-0.035em"
  desktop-display:
    fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "2.25rem"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.03em"
  heading:
    fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.4
  subheading:
    fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.4
  body:
    fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  ui:
    fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.4
  caption:
    fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.4
  code:
    fontFamily: '"SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace'
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.55
rounded:
  control: "7px"
  menu: "8px"
  modal: "10px"
  modal-large: "12px"
  pill: "999px"
  site-control: "0.65rem"
  site-surface: "0.9rem"
spacing:
  2xs: "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.ui}"
    rounded: "{rounded.control}"
    padding: "0 15px"
    height: "38px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.ui}"
    rounded: "{rounded.control}"
    padding: "0 15px"
    height: "38px"
  button-danger:
    backgroundColor: "{colors.red}"
    textColor: "{colors.on-accent}"
    typography: "{typography.ui}"
    rounded: "{rounded.control}"
    padding: "0 15px"
    height: "38px"
  search-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.ui}"
    rounded: "{rounded.control}"
    padding: "0 11px"
    height: "38px"
  status-badge:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.muted}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: "3px 7px"
  dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.modal}"
    width: "min(620px, 100%)"
  evidence-surface:
    backgroundColor: "{colors.code-surface}"
    textColor: "{colors.ink}"
    typography: "{typography.code}"
    rounded: "{rounded.menu}"
---

# Design System: ReviewArc

## 1. Overview

**Creative North Star: "The Evidence Desk"**

ReviewArc is a focused technical workbench where every conclusion has a visible path back to evidence. Its cool ink-and-paper foundation should feel calm during long review sessions, while the indigo-to-cyan arc accent supplies orientation and identity without turning the interface into decoration.

The desktop app is compact and information-dense, using stable panels, ruled lists, code-first layouts, and progressive disclosure. The public site can breathe more, but it must demonstrate the same evidence-first posture rather than becoming a generic marketing template. Both surfaces support light, dark, and system themes and share the arc mark, semantic palette, typographic discipline, and explicit trust language.

The system rejects generic SaaS dashboards and card soup, AI review autopilots, glossy or neon effects, hidden uncertainty, both over-spacious marketing layouts and compressed microtype, and decorative motion or gamification. Visual prominence must follow review consequence: change, evidence, uncertainty, and external action come before ornament.

**Key Characteristics:**

- Cool ink-and-paper surfaces with a restrained indigo-to-cyan identity.
- Dense, stable review geometry with progressive disclosure rather than nested cards.
- Evidence and code rendered as first-class reading material.
- Semantic state communicated with color, iconography, and direct language.
- Flat-by-default surfaces; elevation reserved for temporary overlays and focus.
- Compact, purposeful motion with a complete reduced-motion fallback.

## 2. Colors

The palette uses cool neutrals for sustained reading, indigo for navigation and primary action, cyan for the arc identity, and green, amber, and red only when they carry state.

### Primary

- **Review Indigo** (`--accent`): Primary actions, active navigation, focus, and analysis-ready emphasis. Its darker and soft variants provide hover and selected-state contrast.
- **Arc Cyan** (`--cyan`): Brand mark continuity, occasional secondary emphasis, and identity details. It does not compete with indigo for primary action.

### Secondary

- **Verified Green** (`--green`): Validated evidence, successful completion, and low-risk state.
- **Caution Amber** (`--amber`): Stale analysis, incomplete understanding, and recoverable warnings.
- **Decision Red** (`--red`): Destructive actions, high risk, failures, and externally consequential request-changes flows.

### Neutral

- **Cool Ink** (`--ink`): Primary text and high-confidence information.
- **Working Gray** (`--muted`, `--subtle`): Secondary copy and passive metadata; never use it for essential instructions at insufficient contrast.
- **Paper Canvas** (`--canvas`): Application background and broad page field.
- **Reading Surface** (`--surface`): Controls, dialogs, and primary content planes.
- **Context Panel** (`--panel`): Secondary rails, grouped metadata, and inactive controls.
- **Rules** (`--line`, `--line-strong`): Structure through one-pixel separators and control boundaries.

Dark mode reassigns the same semantic custom properties in `frontend/src/styles.css`; components must consume the semantic variables rather than hard-coding light values. The site maintains aligned, surface-specific mappings in `site/src/styles/landing.css` and Starlight mappings in `site/src/styles/starlight.css`.

**The Semantic Scarcity Rule.** Green, amber, and red are state, not decoration. If a semantic color does not clarify risk, validity, warning, failure, or consequence, use a neutral.

**The One Primary Voice Rule.** Indigo owns primary action and active orientation. Cyan supports the arc identity; it must not create a second competing call to action.

## 3. Typography

**Display Font:** Commissioner with Avenir Next and Segoe UI fallbacks on the public site

**Body Font:** Native system sans in the desktop app; Commissioner on the public site

**Label/Mono Font:** SFMono-compatible system stack in the desktop app; Spline Sans Mono on the public site

**Character:** The desktop app favors crisp native density and predictable code alignment. The public site adds a humanist display voice, but remains technical and controlled. Neither surface uses ornamental type or a novelty face to manufacture personality.

### Hierarchy

- **Marketing Display** (700, `clamp(3rem, 7.7vw, 5.75rem)`, 0.98): Public-site hero statements only.
- **Desktop Display** (700, `2.25rem`, 1.12): Onboarding and rare empty-workspace orientation, never routine page chrome.
- **Heading** (700, `1.5rem`, 1.4): Pull-request identity and major page headings.
- **Subheading** (700, `1.125rem`, 1.4): Dialogs, panels, and section titles.
- **Body** (400, `1rem`, 1.6): Explanations and sustained reading, generally constrained to 48–70 characters per line where layout permits.
- **UI** (600, `0.875rem`, 1.4): Controls and compact application copy.
- **Caption** (600, `0.75rem`, 1.4): Passive metadata, counts, and compact labels; never the only carrier of a critical instruction.
- **Code** (400, `0.8125rem`, 1.55): Code, paths, revisions, and provenance with ligatures disabled and tabular numbers where relevant.

**The Reading Floor Rule.** Do not compress essential body copy below the UI size or essential controls below the caption size. Dense means less repetition and better hierarchy, not smaller text.

**The Evidence Type Rule.** Monospace identifies code, paths, revisions, and machine-derived provenance. It is not a decorative substitute for hierarchy.

## 4. Elevation

ReviewArc is flat by default. Background tone, one-pixel rules, and stable geometry establish hierarchy. Shadows appear only when a surface temporarily rises above the workbench or slides over adjacent content.

### Shadow Vocabulary

- **Control lift** (`0 1px 2px var(--shadow)`): Rare low elevation for compact floating controls.
- **Menu lift** (`0 6px 8px var(--shadow)`): Select menus and short-lived dropdowns.
- **Panel edge** (`0 0 8px var(--shadow)`): Open side panels that overlap the review workspace.
- **Modal lift** (`0 24px 70px var(--shadow-strong)`): Confirmation dialogs, command palette, and review summary.
- **Focus ring** (`2px solid var(--accent)` with a `2px` offset): Keyboard focus, not decorative elevation.

**The Flat-by-Default Rule.** Permanent content surfaces use tone and one-pixel rules. If a resting page needs a large shadow to make its hierarchy legible, the hierarchy is wrong.

**The Consequence Lift Rule.** Strong elevation is reserved for a temporary choice or external consequence. It must never make routine cards look equally urgent.

## 5. Components

### Buttons

- **Shape:** Compact, gently curved controls (`7px` radius; `38px` standard height; `32px` small height).
- **Primary:** Review Indigo background with on-accent text, `0 15px` padding, and semibold UI type. Use one primary action per local decision area.
- **Secondary:** Reading Surface with a strong one-pixel rule. Hover shifts to Context Panel rather than adding lift.
- **Text:** Transparent at rest with muted copy; hover uses the soft accent surface.
- **Danger:** Decision Red with on-accent text. Reserve it for deletion, request changes, and explicit publication consequences.
- **Hover / Focus:** State transitions run for `160ms`; active buttons move down `1px`; keyboard focus uses the visible accent outline. Reduced-motion mode collapses transition duration.
- **State Coverage:** Define default, hover, focus, active, disabled, loading, and error behavior where each state applies. Use inline progress for an action and skeletons for loading content regions.

### Chips

- **Style:** Fully rounded (`999px`) only when the element is a compact status, dependency, or risk label.
- **State:** Pair soft semantic backgrounds with matching text and an icon or explicit label. Interactive filters must look and behave like controls, not passive badges.

### Cards / Containers

- **Corner Style:** Use `8–12px` only for bounded panels, dialogs, or the public site's evidence specimen.
- **Background:** Reading Surface for primary work and Context Panel for subordinate context.
- **Shadow Strategy:** Flat at rest; reference the elevation vocabulary for overlays.
- **Border:** One-pixel semantic rules divide durable regions.
- **Internal Padding:** Use the `12/16/24/32px` scale according to density and consequence.

Avoid stacking rounded containers inside rounded containers. Prefer a page heading, ruled sections, and a single dominant content plane over a dashboard of peer cards.

### Inputs / Fields

- **Style:** `38px` high with a `7px` radius, Reading Surface background, and strong one-pixel border. Search fields use `0 11px` padding and secondary-size text.
- **Focus:** Use the shared accent outline and preserve a visible offset.
- **Error / Disabled:** Errors combine semantic text and an icon; disabled controls reduce opacity but keep their label legible.
- **Technical Text:** Disable autocapitalization, autocorrect, and spellcheck for repository names, paths, revisions, and other identifiers.

### Navigation

Desktop navigation is integrated into stable header and footer geometry. Active destinations use ink or accent text plus a restrained two-pixel underline; inactive destinations remain muted. Side and chapter navigation use selected surface tone and position, not decorative cards. Compact layouts collapse panels at the existing `1180px`, `1040px`, `760px`, and `520px` breakpoints without changing the review sequence.

The public site uses a 44px interaction floor, a restrained ruled header, and an explicit System / Light / Dark theme control. Documentation navigation follows Starlight conventions while preserving ReviewArc typography and palette.

### Evidence Surfaces

Evidence is the signature component family. A claim, its provenance, validation state, and the action to open code must remain visually connected. Code uses the dedicated code surface with green additions and red deletions; focused evidence uses a distinct validated-green treatment. Unverified evidence must say “Unverified” and cannot rely on a warning color alone.

### Confirmation Dialogs

Publishing dialogs identify the repository, pull request, review event, and exact content before confirmation. The consequential action is visually distinct, keyboard reachable, and never triggered optimistically. Cancellation preserves local work.

## 6. Do's and Don'ts

### Do:

- **Do** lead from a claim to its real path, revision, and line range.
- **Do** use the `4/8/12/16/24/32px` spacing scale and stable panel geometry to create dense, scannable layouts.
- **Do** pair semantic color with text and icons, including explicit labels for stale, unverified, failed, and externally visible states.
- **Do** keep surfaces flat until a menu, panel, or consequential dialog temporarily rises above the workspace.
- **Do** preserve the same review arc from inbox through overview, chapters, evidence, drafts, and deliberate decision.
- **Do** support light, dark, system, keyboard, coarse-pointer, and reduced-motion behavior in every new pattern.
- **Do** give interactive components consistent default, hover, focus, active, disabled, loading, and error states.

### Don't:

- **Don't** build generic SaaS dashboards or card soup that flatten every piece of information into an equal container.
- **Don't** design an AI review autopilot that replaces reviewer judgment or implies approval can be delegated to a model.
- **Don't** use glossy, neon, glassy, or playful treatments; gradients and glow are not substitutes for ReviewArc's arc identity.
- **Don't** present black-box confidence, hide uncertainty, or style unsupported claims like verified facts.
- **Don't** use over-spacious marketing layouts or compressed microtype; remove repetition before reducing readable type.
- **Don't** add decorative motion, gamification, confetti, or celebration around routine or consequential review actions.
- **Don't** use green, amber, or red as decoration, or make state distinguishable by color alone.
- **Don't** stack rounded surfaces, add permanent dashboard shadows, or introduce ornamental side stripes to manufacture hierarchy.
- **Don't** use a modal as the first solution; reserve it for focused choices and consequential confirmation after inline or progressive alternatives are exhausted.
