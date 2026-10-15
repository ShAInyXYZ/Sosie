---
name: neuronkit
description: Build interfaces with NeuronKit, Shiny-Studio's instrument-panel UI kit (plain CSS + one ES module, Svelte 5 wrappers) — its identity: charcoal surfaces, one accent, square lamps, machined faces, continuous (squircle) corners. Use whenever a page, app, component, dashboard, settings screen, graph or social post should look and behave like NeuronKit, when adding or changing a kit component, or when the user says "use our UI kit", "Neuron identity" or "NeuronKit".
---

# NeuronKit

NeuronKit is one kit for settings screens, dashboards, graphs and voice assistants. It lives in the NeuronKit repository (Apache-2.0, © Shiny-Studio OÜ): this skill is `skills/neuronkit/` inside it, so the kit's root is two folders up from this file (resolve the symlink first if the skill was linked in; in a project that installed the package it is `node_modules/neuronkit`). The catalogue pages there are the visual contract: `overview.html` (every component as a live grid), `foundations.html`, `components.html`, `app.html`, `voice.html`, `graph.html`, `patterns.html`, `social.html`, `rules.html` (`index.html` is the kit's homepage, `skill.html` how to install this skill). Serve them with `python3 tools/serve.py` (caching off) — never open them as `file://`, ES modules won't load.

`reference.md` beside this file lists every component, class, token, behaviour, Svelte wrapper and icon, generated from the kit (`python3 tools/skill-reference.py` refreshes it). Read the section you need; don't guess class names.

## Posture

You are building an instrument, not a dashboard. Before writing markup, decide what the one thing the screen must say is; problems first, everything else quiet. Use kit components as they are. If you catch yourself writing a hex value, a new shadow, a card grid or a KPI tile, stop: the kit already has the part, or the design is wrong.

## Load it

```html
<link rel="stylesheet" href="neuronkit/css/neuronkit.css">
<script type="module">
  import { init } from "./neuronkit/js/neuronkit.js";
  init();                       // enhances the page and anything added later
</script>
```

- Package: `import "neuronkit/css"`, `import { init } from "neuronkit"`, Svelte: `import { Knob, Select } from "neuronkit/svelte"`.
- Opt-in extras, loaded after the kit: `css/flow.css` (SvelteFlow theme), `css/social.css` (posts), `js/orb.js` (`initOrbs()`, WebGL), `js/social.js` (`drawInstrument()`), `js/edge-router.js` (the Adaptive edge router).
- `init(root, { icons })` sets the sprite path (default `icons/icons.svg`). Use icons as `<svg class="nk-icon"><use href="icons/icons.svg#name"/></svg>`.

## Identity rules (binding — rules.html has all seventeen)

1. **Colour is signal.** Charcoal surfaces and ink carry everything; colour only says state (`data-tone="ok|warn|crit|info|busy|idle"`) or interaction (the accent). Green lives on lamps.
2. **One accent per product**, for interaction only: focus, the open thing, the armed action, the lit value. Cherry by default; `<html data-accent="mint">` for Mint or `"lapis"` for Lapis.
3. **Two faces, five sizes**: Manrope for prose and names, IBM Plex Mono for numbers, readouts, labels, tags. Sizes `--fs-micro` 9.5 · `--fs-small` 11.5 · `--fs-body` 13 · `--fs-title` 15 · `--fs-display` 21. Figures are always tabular.
4. **Pressed-metal depth**: machined faces (`--face`, `--shell`, `--inset`, `--well`) used with `border: 1px solid transparent`. Only what floats casts a shadow (`--float*`, `--drop*`). No glow, no glassmorphism.
5. **No KPI tiles, no card grids.** Panels with rows, meters, sections.
6. **Reading never needs a click**; changing the world asks twice (two-step pills, `data-confirm`).
7. **Only problems move**; never steal focus; focus is always visible.
8. **Say the specific fact** ("ledger-api: 503 for 3 min"), unknown is never zero, time only moves forward, nothing twice.

## Tokens you'll use

- Surfaces `--bg --s1 --s2 --s3`; hairlines `--line` (structure) and `--line2` (control edge). Ink `--text --muted --dim --faint` — anything read is at least `--dim`.
- Machined faces: `--face` (panels, menus, toasts), `--shell` / `--shell-hover` (keys, buttons, caps), `--inset` / `--inset-hover` (fields, tracks), `--well` / `--well-open` (round recesses), `--code-bg`, `--track`, `--box-well`.
- Spacing `--sp-1…--sp-9` (2 4 6 8 12 16 20 24 32), `--gap` 8, `--pad` 14, `--body-inset` 16, `--row-h` 32.
- Radii `--r-sm` 2 (lamps), `--r`, `--r-lg`, `--r-toast`, `--r-panel`, `--r-control` (pill). These already include the corner factor.
- Shadows `--drop --drop-cap --float-sm --float --float-lg`; focus `--focus --focus-w --focus-offset`; `--disabled`; z-scale `--z-raised … --z-toast`.
- Status `--ok --warn --err --info`; voice `--voice --rec`; graph ports `--port-*`.

Never invent a value that a token covers. Never write `--inset` for spacing (it is a surface; spacing is `--body-inset`).

## Continuous corners

Every shaped corner is a squircle: `border-radius: <token or calc(Npx * var(--corner-k, 1))>; corner-shape: var(--corner, round);`. Where `corner-shape` is supported `--corner` is `squircle` and `--corner-k` scales radii ×2.1 so the softness holds; elsewhere the classic corner at the classic radius. Circles (50%), pills (999px / `--r-control`) and ≤2px lamp corners are never shaped. After adding CSS, run `python3 tools/corners.py --check` (and without `--check` to fix). Anything deliberately classic carries "classic" in its selector or class.

## Themes

Dark is the default. `<html data-theme="light">` switches every token (surfaces, ink, deepened signals, relit faces, lighter shadows). New colours must be tokens with a value in both the `:root` block and the `[data-theme="light"]` block of `tokens.css` — then both themes work. Check both.

## Behaviours

Opt-in by class or attribute; each emits bubbling `nk:change` (`detail.value`) or `nk:confirm` (`detail.action`). Value controls take a value from code with `el.nkSet(v)` (or dispatch `nk:set`) without re-emitting. `enhance(node)` enhances one subtree without the page observer (use it in framework components). The full selector → function table is in `reference.md`. The ones people reach for:

- `select.nk-select` (native select becomes the kit menu; `<option data-desc>` adds a second line), `.nk-combobox` over a `<datalist>`, `.nk-datepicker`, `.nk-calendar`.
- `.nk-knob` (options knob with `data-options`, or continuous with `data-min/max/value/step/unit`, `data-bipolar`), `.nk-wheel`, `.nk-angle`, `.nk-scrub`, `input.nk-slider` + `.nk-scale`, `.nk-range`.
- `[data-menu]`, `[data-context-menu]`, `[data-popover]`, `[data-dialog]`, `dialog.nk-command` (`data-hotkey="k"`), `.nk-tabs`, `.nk-toolbar`, `.nk-menubar`.
- `.nk-pill-button[data-confirm]` (two-step), `.nk-sortable`, `.nk-taginput`, `.nk-otp`, `.nk-colour`, `.nk-scroll`, `toast(text, tone)`.
- `[data-tooltip]` (a `title` is migrated): the label in ink, a hint after ` — ` or a line break in dim ink, `data-tooltip-key="Ctrl K"` as keycaps, `data-tooltip-side="right"` to stand elsewhere; a path or id is set in mono. One fact per tooltip; never repeat text that is already on screen.
- `figure.nk-chart` (a time series: `data-series`, `data-start`, `data-step`, `data-unit`, `data-limit`; `el.nkPush(v, …)` for live readings) and `.nk-log` (a live log: `log(el, lines)` appends, filter, levels, follow-the-tail, virtualised).

## Numbers and time

Never format a figure by hand: `js/format.js` (`import { unit, percent, bytes, rate, temp, duration, ago, clock, date, plural, fraction } from "neuronkit/js/format.js"`, or `format.*` from the main module). It prints "—" for anything unknown (null, undefined, NaN) and a real 0 for zero, puts a space before units (not before % or °), uses 24-hour clocks and ISO dates, and never says a past event is in the future. The chart and the log view already use it.

## One number, printed by the kit

Whatever a component draws from a value, the kit also prints from that value, so the two can't disagree. Leave the printed reading empty and give only the value:

- Meter and limit: `<div class="nk-seg" data-frac="0.22">` + an empty `.nk-meter-value` / `.nk-limit-pct` prints "22%"; an amount is `data-value="22.1" data-max="24" data-unit="G"` → "22.1/24G".
- Sparkline in a row: an empty `.nk-row-value` prints the last reading with the spark's `data-unit` ("—" for a gap).
- Donut: `value` sizes the arc and prints the amount (`data-amount-unit`); the centre is the total unless `data-center` is given.
- Progress `data-value` (of `data-max`), a stage's `data-progress=".62"`, a busy dial's `data-progress="42"` (prints the slot readout).

Write your own words in a reading only when they add something the value can't ("0.9T free"); the kit leaves them alone.

## Dynamic buttons

`.nk-button` (pill; `.is-primary` once per surface, `.is-ghost`, `.is-quiet`, `.is-sm`). Buttons can say what they'll do before they're pressed:

- `data-tone="crit|ok|warn|info|accent"` — hover tints face, rim and label (`.is-danger` is the crit tone).
- `data-icon="trash"` — any sprite icon; it slides in on hover with a matching motion (trash shake, refresh spin, arrows/send nudge, plus/check pop, download drop). `data-motion` overrides, `data-icon-show="always"` keeps it out.

## Svelte 5

Wrappers render kit markup and use the kit's behaviour (`use:nk`), with `bind:value` both ways: Button, IconButton, Switch, Checkbox, Select, Combobox, Slider, RangeSlider, Knob, Wheel, Angle, Scrub, Colour, Calendar, DatePicker, CodeInput, TagInput, Tabs, Dialog (drawer with `side`), Menu (context with `context`), CommandPalette, Sortable, Meter, Spark, Chart, LogView, Led, AdaptiveEdge. Anything else: render the kit markup and add `use:nk={{ onchange, onconfirm }}`. Pushing a value in: always call `el.nkSet(value)` in an `$effect` — Svelte rewrites `data-*` before your effect runs, so comparing against the attribute skips updates.

## Composing screens

- A panel: `.nk-panel` > `.nk-panel-head` (`.nk-panel-header` with mark, title, state) · `.nk-panel-body` (`.nk-section` strips, `.nk-row`s, `.nk-meter-group`) · `.nk-panel-footer`. Problems go in a `.nk-section[data-tone="crit"]` with `.nk-alert` at the top.
- A status rail: `.nk-rail` of `.nk-slot` > `.nk-dial[data-state]` + `.nk-readout`.
- A monitoring view: a panel with the rail, meters for now, a `.nk-chart` with its `data-limit` for the last hour, and a `.nk-log` for the service's output; problems at the top.
- An app: `.nk-app` shell (header 54, rail 224, main, aside 380), chat with `.nk-chat` / `.nk-composer`.
- A graph: SvelteFlow + `css/flow.css`, nodes `.nk-node(.is-rich)`, sockets `.nk-socket`, the Adaptive edge as default.
- A social post: `css/social.css` (`.nk-post` 1080 × 1350, `.is-story`, `.nk-post-avatar`) + `drawInstrument()`; for ShinyStudio LAB posts use the `shinylab-social` skill.

## Changing the kit

1. Express it with tokens; every class `nk-`; native semantics; no hex values in components (add a token with dark and light values instead).
2. Behaviour goes in `js/neuronkit.js`, opt-in by class, using the shared helpers (`drag`, `arrowIndex`, `menuKeys`, `follow`, `valueModel`) — never a new copy of pointer or arrow-key logic, never a per-instance global listener.
3. Add a catalogue section showing every state (first demo = what the overview shows; list it in `site/overview.js` `TILES` if the section holds several components).
4. Verify in a real browser, both themes, both with and without `site/site.css` (catalogue styles can hide missing resets), then `tools/corners.py --check` and `tools/skill-reference.py`.
5. Commit locally; NeuronKit is not published without the user's OK.

## Pitfalls already paid for

- A lamp with `data-tone="ok"` paints with `--ok-led`, not `--tone`; to relight lamps override `.nk-led[data-tone="ok"] { background: … }`.
- Kit buttons need their resets (`border: 0; background: transparent; width: 100%` for menu items) — the catalogue's own CSS once hid a select that rendered as grey browser buttons.
- A popover opened on mouse-down (context menus) must be `popover="manual"`, or light-dismiss closes it on mouse-up.
- `corner-shape` needs its fallback vars (`var(--corner-k, 1)`), or a stale cached `tokens.css` collapses corners to square.
- Local previews cache aggressively: use `tools/serve.py`.
