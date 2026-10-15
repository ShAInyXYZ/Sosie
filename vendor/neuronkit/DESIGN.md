# NeuronKit — design contract

The catalogue (`components.html`, `patterns.html`, `rules.html`) is this
contract drawn; `css/` is its implementation. Where they disagree, fix one.

## Identity

TP-7 / Japanese old-school-modern, minimalist industrial. Monochrome
surfaces, one signal accent, hairlines, printed mono labels, mechanical
precision, generous negative space. Dark by default; a light theme is
opt-in (`data-theme="light"`), relit rather than inverted.

## Tokens (css/tokens.css)

- Surfaces `--bg #161616 · --s1 #1C1C1C · --s2 #242424 · --s3 #2B2B2B`;
  lines `--line` (structure) and `--line2` (control edge).
- Ink `--text · --muted · --dim · --faint`. Anything a person reads is at
  least `--dim`; `--faint` is for grips, separators and unlit lamps.
- One accent per product (`--accent`: Cherry by default, `data-accent="mint"`
  for Mint or `"lapis"` for Lapis), for interaction only: focus, the open thing, armed actions.
- State `--ok --warn --err --info`, through `data-tone`
  (`ok warn crit info busy idle`). Green lives on lamps only.
- Type: Manrope (prose, names), IBM Plex Mono (numbers, readouts, labels,
  tags); sizes 9.5 / 11.5 / 13 / 15 / 21 px only; tabular figures always.
- Depth: machined faces (`--face --shell --inset --well`, lit from above, used
  with `border: 1px solid transparent`), `--elev-1/2` and `--edge-2` rings.
  Only what floats casts a shadow (`--drop*`, `--float*`); no glow, no glass.
- Geometry: continuous (squircle) corners — `corner-shape: var(--corner)`,
  radii scaled by `--corner-k` where supported (`tools/corners.py` checks).
  Base radii `--r` 3px fields, `--r-sm` 2px lamps, `--r-control` pills,
  `--r-panel` 14px, `--r-toast` 10px; panel inset `--body-inset` 16px; rows 32px.

## Rules

The seventeen rules on `rules.html` are binding. In short: colour is signal;
one accent; pressed-metal depth; two faces, five sizes; one-row headers; no
KPI tiles or card grids; reading never needs a click; changing the world asks
twice; only problems move; never steal focus; visible focus; problems first;
state is the worst of its signals; unknown is never zero; say the specific
fact; time only moves forward; nothing twice.

## Adding a component

It must be expressible with the tokens (never a new hex value — a new colour
is a token with dark and light values), carry the
`nk-` prefix on every class, keep native semantics, have a catalogue section
showing every state, and pass the rules. Behaviour goes in `js/neuronkit.js`
as an opt-in by class that emits `nk:*` events, built on the shared helpers.
Reject what only one app needs. `skills/neuronkit/SKILL.md` is the working
guide for an AI using the kit; `tools/skill-reference.py` refreshes its reference.

## Provenance

Extracted from Shiny-Studio's own apps, where each component was built and
reviewed in use before it came into the kit.
