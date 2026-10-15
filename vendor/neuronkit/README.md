<p align="center"><img src="site/mark.svg" width="56" alt=""></p>
<h1 align="center">NeuronKit</h1>
<p align="center"><strong>Instruments, not dashboards.</strong><br>An instrument-panel UI kit for the software people rely on.</p>

<p align="center"><a href="https://shainyxyz.github.io/NeuronKit/">Home</a> · <a href="https://shainyxyz.github.io/NeuronKit/overview.html">Overview</a> · <a href="https://shainyxyz.github.io/NeuronKit/foundations.html">Foundations</a> · <a href="https://shainyxyz.github.io/NeuronKit/components.html">Components</a> · <a href="https://shainyxyz.github.io/NeuronKit/patterns.html">Patterns</a> · <a href="https://shainyxyz.github.io/NeuronKit/social.html">Social</a> · <a href="https://shainyxyz.github.io/NeuronKit/rules.html">Rules</a> · <a href="https://shainyxyz.github.io/NeuronKit/skill.html">Skill</a></p>

---

Monochrome charcoal surfaces, one accent, square lamps, machined dials and segmented meters — a calm panel where the only thing that moves is a problem. From a settings row to a voice assistant, it is one kit, so every screen of every app looks and behaves like the same family.

**The core is plain CSS and one small ES module.** No build step, no framework required: it works in a static page, in Svelte, React, Vue or anything that renders HTML.

## Use it

Copy `css/`, `fonts/` and `js/` into your project side by side (or install the package), then:

```html
<link rel="stylesheet" href="neuronkit/css/neuronkit.css">
<script type="module">
  import { init } from "./neuronkit/js/neuronkit.js";
  init();
</script>
```

`init()` enhances the page and anything added later: selects, comboboxes, tooltips, two-step actions, hover tabs, tabs, choice banks, switches, sliders and their scales, steppers, knobs, thumbwheels, angle dials, scrub fields, colour pickers, dialogs, drawers, menus, context menus, the command palette, popovers, toolbars, scroll areas, list search, the composer, code copy, meters, donuts, bars, level meters, the dot matrix, time-series charts and log views. Orbs load separately from `js/orb.js` (`initOrbs()`), since they need WebGL. Behaviours announce themselves as bubbling DOM events — `nk:change` and `nk:confirm` — so any framework can listen.

A sibling product sets its accent once, and any page can switch to the light theme (dark is the default):

```html
<html data-accent="mint">   <!-- Mint; "lapis" for Lapis; none = Cherry -->
<html data-theme="light"> <!-- the light theme; leave it off for dark -->
```

Pick only what you need instead of `neuronkit.css`: `tokens.css`, `fonts.css`, `base.css`, the files in `css/components/`, and `invariant.css` last.

## What's inside

| | |
|---|---|
| **Foundations** | tokens (surface ladder, ink, one accent, state and voice colours, machined faces, continuous (squircle) corners, geometry, motion, focus and disabled), five type sizes, 62 drawn icons (`icons/icons.svg`), and `js/format.js` for numbers and time (units, bytes, rates, durations, "3 min ago"; unknown prints "—", never 0) |
| **Primitives** | machined scrollbars and a scroll area that fades its edges, stack / cluster / spread / rule, truncate and clamp, screen-reader-only text, one focus ring, one disabled look, Windows high-contrast support, logical (RTL-ready) layout |
| **Controls** | knob, button (dynamic: `data-tone` tints it on hover, `data-icon` slides in an icon with a motion that suits it), icon button, two-step pill, segmented tabs (hover to switch), choice, switch, checkbox, radio, stepper, slider, field, text area, select (with two-line options), date and time, drop zone, tooltip, colour swatches |
| **Wheels & scales** | thumbwheel, angle dial, slider scales and knob notches, scrub field (drag the label to set a number), dual pill |
| **Inputs** | input group (prefix, suffix, clear), password reveal, combobox over a native `<datalist>`, colour picker, calendar and date picker (ISO, ranges), two-thumb range slider, one-time code, tag input |
| **Navigation** | tabs with panels, disclosure and accordion, breadcrumb, pagination, menubar, toolbar, stages (multi-step progress), avatar |
| **Instruments** | LED, segmented meter and limit, dial, readout, rail, dot matrix |
| **Panel** | panel with header and footer, section strip, row, stats line, chips, alert, note, empty state, table with row groups, split |
| **Data & layout** | log view (live, filterable, follows the tail, thousands of lines), data table (sort, filter), split pane, timeline, sortable list (drag or keyboard), graph nodes and edges (plus `css/flow.css` for SvelteFlow) |
| **Charts** | time-series chart with axes, a limit line and a hover readout (the stretch past the limit turns red), monochrome donut, bars that fill their column, sparklines |
| **Overlays & feedback** | banner, dialog, drawer and sheet, menu (with two-line items), context menu, popover, command palette, notice (questions and errors), toast, progress, spinner, tag, badge, kbd, skeleton |
| **Application** | app shell (header, rail, main, aside), chat messages and composer, markdown and code, list with search, tree, path, connection rows |
| **Voice & media** | the Orion orb, the voice pill (compact and expanded), the recording level meter and busy dots, source cards and carousel |
| **Social** | posts at poster scale (`css/social.css`, opt-in): 4:5 carousel cover, step and prompt slides, a precision-instrument end card (`js/social.js` → `drawInstrument()`), 9:16 stories with safe zones, a profile picture, and a caption pattern — all following the page accent |

The kit's homepage shows it moving: **[shainyxyz.github.io/NeuronKit](https://shainyxyz.github.io/NeuronKit/)**. Every component at a glance, as a grid of live previews: **[the overview](https://shainyxyz.github.io/NeuronKit/overview.html)**. Every component in every state, with its markup a click away: **[the catalogue](https://shainyxyz.github.io/NeuronKit/components.html)**. Open `index.html` locally to browse it all offline (serve the folder over HTTP — ES modules don't load from `file://`).

## Use it with an AI agent

The kit ships a skill for coding agents in [`skills/neuronkit/`](skills/neuronkit/): the identity rules, every class, token, behaviour and icon, and how to compose screens. With it, "build me a settings page in NeuronKit" gets the kit's own parts instead of invented ones. For Claude Code:

```bash
git clone https://github.com/ShAInyXYZ/NeuronKit.git ~/NeuronKit
mkdir -p ~/.claude/skills
ln -s ~/NeuronKit/skills/neuronkit ~/.claude/skills/neuronkit
```

Codex, Cursor and other agents: see [`skills/README.md`](skills/README.md) or [the skill page](https://shainyxyz.github.io/NeuronKit/skill.html).

## The rules

The components are the parts; [the rules](rules.html) make the whole read as one family. The short version: colour is signal, never decoration; one accent for interaction only; no KPI tiles or card grids; problems first; if you have to click to find out, the interface has failed. [`DESIGN.md`](DESIGN.md) is the full contract.

## Svelte

Svelte 5 components ship in `svelte/`: thin wrappers that render the kit's own markup and let `neuronkit.js` do the behaviour, with `bind:value` both ways.

```svelte
<script>
  import "neuronkit/css";
  import { Knob, Wheel, Select, Tabs, Dialog, toast } from "neuronkit/svelte";
  let volume = $state(64), edge = $state("right");
</script>
<Knob bind:value={volume} label="Volume" unit="%" ticks={11} from="0" to="100" />
<Select bind:value={edge} label="Edge" options={[{ value: "left", label: "Left" }, { value: "right", label: "Right", desc: "default" }]} />
```

Button, IconButton, Switch, Checkbox, Select, Combobox, Slider, RangeSlider, Knob, Wheel, Angle, Scrub, Colour, Calendar, DatePicker, CodeInput, TagInput, Tabs, Dialog (and drawer), Menu (and context menu), CommandPalette, Sortable, Meter, Spark, Led, plus `AdaptiveEdge` for SvelteFlow. Anything else is one `use:nk` away: it enhances a node and forwards `nk:change` / `nk:confirm`. Outside Svelte, value controls take a value from code with `el.nkSet(value)`.

React wrappers only when a project needs them.

## Licence

© 2026 Shiny-Studio OÜ. Code under the [Apache License 2.0](LICENSE): free to use, modify and ship, commercially too. The NeuronKit name and mark (and the product names above) are ours and are not licensed — see [NOTICE](NOTICE). Manrope and IBM Plex Mono are bundled under the SIL Open Font License.
