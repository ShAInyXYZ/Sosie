// NeuronKit — the few behaviours CSS cannot do, in plain JavaScript.
//
//   <script type="module">
//     import { init } from "./js/neuronkit.js";
//     init();            // enhances everything under document, and anything added later
//   </script>
//
// Every behaviour is opt-in by class name, keeps native semantics, and
// announces changes as bubbling DOM events (nk:change, nk:confirm), so any
// framework — or none — can listen. Nothing here styles; the CSS does.
//
// Value controls (select, knob, wheel, angle, scrub, combobox, colour) also
// take a value from code: el.nkSet(value) moves them without an nk:change.
// enhance(node) enhances one subtree without the page-wide observer (for
// framework components that mount and unmount their own nodes).

import { unit as fmtUnit, clock as fmtClock, num as fmtNum, percent as fmtPercent, plural, bytes } from "./format.js";

const HOVER_SWITCH_MS = 180; // a tab switches after this much hover (no click needed)
const ARM_MS = 4000;         // a two-step action stays armed this long
const TOAST_MS = 5000;

const make = (tag, className, text) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
};
const svg = (tag, attrs = {}) => {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};
const emit = (el, name, detail) => el.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));
const once = (el, key) => (el.dataset[key] ? false : (el.dataset[key] = "1"));
const json = (text, fallback) => { try { return JSON.parse(text); } catch { return fallback; } };
const disabled = (el) => el.disabled === true || el.getAttribute("aria-disabled") === "true";
const isRtl = (el) => getComputedStyle(el).direction === "rtl";
const pathIcon = (d, cls) => { const s = svg("svg", { viewBox: "0 0 16 16", class: cls, "aria-hidden": "true" }); s.append(svg("path", { d })); return s; };

// Arrow keys over a row or column of n items: the index to move to from i,
// or null when the key isn't one of ours. Home/End jump; RTL flips the row.
function arrowIndex(e, i, n, { axis = "both", rtl = false, loop = true } = {}) {
  if (!n) return null;
  const x = axis !== "y", y = axis !== "x";
  const fwd = (x && e.key === (rtl ? "ArrowLeft" : "ArrowRight")) || (y && e.key === "ArrowDown");
  const back = (x && e.key === (rtl ? "ArrowRight" : "ArrowLeft")) || (y && e.key === "ArrowUp");
  let j = e.key === "Home" ? 0 : e.key === "End" ? n - 1 : fwd ? i + 1 : back ? i - 1 : null;
  if (j == null) return null;
  if (i < 0 && (fwd || back)) j = fwd ? 0 : n - 1;
  return loop ? (j + n) % n : Math.max(0, Math.min(n - 1, j));
}

// Pointer drag with capture — the one implementation every turning, sliding
// and scrubbing control shares. start(e) may return false to refuse; move
// gets the travel since the press; with a threshold, nothing moves until the
// pointer has travelled that far, and the click that ends such a drag is
// swallowed (so dragging a knob doesn't also open its menu).
function drag(el, { start, move, end, threshold = 0, cls = "is-turning", handle = el }) {
  let s = null;
  const swallow = (e) => { e.stopImmediatePropagation(); e.preventDefault(); };
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || disabled(el) || start?.(e) === false) return;
    s = { x: e.clientX, y: e.clientY, id: e.pointerId, live: !threshold };
    handle.setPointerCapture(e.pointerId);
    if (s.live) el.classList.add(cls);
  });
  handle.addEventListener("pointermove", (e) => {
    if (!s || e.pointerId !== s.id) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (!s.live) { if (Math.hypot(dx, dy) < threshold) return; s.live = true; el.classList.add(cls); }
    move(e, dx, dy);
  });
  const stop = (e) => {
    if (!s || e.pointerId !== s.id) return;
    const moved = s.live && threshold > 0;
    s = null;
    el.classList.remove(cls);
    end?.(e, moved);
    if (moved) { handle.addEventListener("click", swallow, { capture: true, once: true }); setTimeout(() => handle.removeEventListener("click", swallow, true)); }
  };
  handle.addEventListener("pointerup", stop);
  handle.addEventListener("pointercancel", stop);
  handle.addEventListener("lostpointercapture", stop);
}

// Every open anchored popover follows its anchor through scrolls and
// resizes — one listener of each for the whole page, however many menus.
const anchored = new Map();
let following = false;
function follow(pop, anchor) {
  pop.addEventListener("toggle", (e) => {
    if (e.newState === "open") { anchored.set(pop, anchor); requestAnimationFrame(() => place(pop, anchor)); }
    else anchored.delete(pop);
  });
  if (following) return;
  following = true;
  const again = (e) => {
    for (const [p, a] of anchored) {
      if (!a.isConnected) anchored.delete(p);
      else if (!(e?.target instanceof Node && p.contains(e.target))) place(p, a);   // scrolling inside the menu itself moves nothing
    }
  };
  addEventListener("resize", again);
  document.addEventListener("scroll", again, { capture: true, passive: true });
}

// Place a popover beside its anchor, flipping above when there is no room.
function place(panel, anchor, preferTop = false) {
  const r = anchor.getBoundingClientRect();
  const below = innerHeight - r.bottom - 16, above = r.top - 16;
  const need = Math.min(panel.scrollHeight, 180);
  const top = preferTop ? above >= need : below < need && above > below;
  panel.style.setProperty("--nk-available-height", `${Math.max(40, Math.min(320, top ? above : below))}px`);
  panel.style.setProperty("--nk-anchor-width", `${r.width}px`);
  const b = panel.getBoundingClientRect();
  panel.style.left = `${Math.max(8, Math.min(r.left, innerWidth - b.width - 8))}px`;
  panel.style.top = `${Math.max(8, top ? r.top - b.height - 6 : r.bottom + 6)}px`;
}

/* ---- Select: a native <select class="nk-select"> becomes the kit's menu.
   The <select> stays the source of truth (forms, value, change events). ---- */
const CHEVRON = "M4 6l4 4 4-4";
const CHECK = "M3.5 8.5l3 3 6-7";
let selectId = 0;
function enhanceSelect(select) {
  if (!once(select, "nkSelect")) return;
  if (!select.id) select.id = `nk-select-${++selectId}`;
  const trigger = make("button", "nk-sel-trigger");
  trigger.type = "button";
  trigger.id = `${select.id}-trigger`;
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  const menu = make("div", "nk-sel-menu");
  menu.id = `${select.id}-menu`;
  menu.popover = "auto";
  menu.setAttribute("role", "listbox");
  const labels = [...select.labels];
  const labelName = labels.map((label) => {
    const copy = label.cloneNode(true);
    copy.querySelectorAll("select").forEach((el) => el.remove());
    return copy.textContent.trim();
  }).join(" ");
  const name = () => {
    const referenced = (select.getAttribute("aria-labelledby") || "").split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent.trim()).filter(Boolean).join(" ");
    return referenced || select.getAttribute("aria-label") || labelName || "Choose an option";
  };
  trigger.setAttribute("aria-controls", menu.id);
  labels.forEach((label) => { label.htmlFor = trigger.id; });
  select.classList.add("nk-select-source");
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");
  select.after(trigger, menu);

  let query = "", queryTimer, wasOpen = false;
  const options = new Map(); // rendered option → native option; values need not be unique
  const enabledItems = () => [...options.keys()].filter((item) => !item.disabled);
  const isOpen = () => menu.matches(":popover-open");
  const close = (focus = false) => { if (isOpen()) menu.hidePopover(); if (focus) trigger.focus(); };
  const sync = () => {
    trigger.disabled = select.disabled;
    const option = select.selectedOptions[0];
    const value = make("span", "nk-sel-value", option?.label ?? select.dataset.placeholder ?? "Choose…");
    if (!option) value.classList.add("is-placeholder");
    trigger.replaceChildren(value, pathIcon(CHEVRON, "nk-sel-chev"));
    menu.setAttribute("aria-label", name());
    trigger.setAttribute("aria-label", `${name()}: ${value.textContent}`);
    for (const [item, option] of options) {
      const on = option.selected;
      item.setAttribute("aria-selected", String(on));
      item.toggleAttribute("data-selected", on);
    }
    if (select.disabled) close();
  };
  const render = () => {
    menu.replaceChildren();
    options.clear();
    let groupId = 0;
    const append = (source, target, groupDisabled = false) => {
      for (const option of source.children) {
        if (option.tagName === "OPTGROUP") {
          const group = make("div", "nk-sel-group");
          const heading = make("div", "nk-sel-group-label", option.label);
          heading.id = `${menu.id}-group-${++groupId}`;
          group.setAttribute("role", "group");
          group.setAttribute("aria-labelledby", heading.id);
          if (groupDisabled || option.disabled) group.setAttribute("aria-disabled", "true");
          group.append(heading);
          append(option, group, groupDisabled || option.disabled);
          target.append(group);
          continue;
        }
        if (option.tagName !== "OPTION") continue;
        const item = make("button", "nk-sel-item");
        item.type = "button";
        item.tabIndex = -1;
        item.setAttribute("role", "option");
        item.dataset.value = option.value;
        item.disabled = groupDisabled || option.disabled;
        if (item.disabled) item.setAttribute("aria-disabled", "true");
        options.set(item, option);
        const label = make("span", "nk-sel-item-label", option.label);
        if (option.dataset.desc) {
          // <option data-desc="..."> adds a second line under the label
          item.classList.add("is-two-line");
          const text = make("span", "nk-sel-item-text");
          text.append(label, make("span", "nk-sel-item-desc", option.dataset.desc));
          item.append(text, pathIcon(CHECK, "nk-sel-check"));
        } else item.append(label, pathIcon(CHECK, "nk-sel-check"));
        item.addEventListener("focus", () => item.setAttribute("data-highlighted", ""));
        item.addEventListener("blur", () => item.removeAttribute("data-highlighted"));
        item.addEventListener("pointerenter", () => item.focus({ preventScroll: true }));
        item.addEventListener("click", () => {
          select.selectedIndex = option.index;
          select.dispatchEvent(new Event("input", { bubbles: true }));
          select.dispatchEvent(new Event("change", { bubbles: true }));
          close(true);
        });
        target.append(item);
      }
    };
    append(select, menu);
  };
  const open = (last = false) => {
    if (select.disabled) return;
    render();
    sync();
    menu.showPopover();
    place(menu, trigger);
    const enabled = enabledItems();
    (last ? enabled.at(-1) : enabled.find((item) => options.get(item).selected) || enabled[0])?.focus({ preventScroll: true });
  };
  trigger.addEventListener("pointerdown", () => { wasOpen = isOpen(); });
  trigger.addEventListener("click", () => { if (wasOpen || isOpen()) close(); else open(); wasOpen = false; });
  trigger.addEventListener("keydown", (e) => {
    wasOpen = false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); open(e.key === "ArrowUp"); }
  });
  menu.addEventListener("toggle", (e) => {
    const on = e.newState === "open";
    trigger.setAttribute("aria-expanded", String(on));
    trigger.dataset.state = on ? "open" : "closed";
  });
  menu.addEventListener("keydown", (e) => {
    const items = enabledItems();
    const i = items.indexOf(document.activeElement);
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === "Tab") close(true);
    else if (arrowIndex(e, i, items.length, { axis: "y" }) != null) {
      e.preventDefault();
      items[arrowIndex(e, i, items.length, { axis: "y" })]?.focus();
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      clearTimeout(queryTimer);
      query += e.key.toLowerCase();
      items.find((el) => el.textContent.toLowerCase().startsWith(query))?.focus();
      queryTimer = setTimeout(() => (query = ""), 600);
    }
  });
  select.addEventListener("change", sync);
  select.nkSet = (v) => { select.value = String(v); sync(); };   // set from code without a change event
  // options changed while the menu is open: rebuild it, keeping the focused one
  new MutationObserver(() => {
    if (!isOpen()) { sync(); return; }
    const focused = options.get(document.activeElement);
    render();
    sync();
    if (focused && isOpen()) {
      const enabled = enabledItems();
      (enabled.find((item) => options.get(item) === focused)
        || enabled.find((item) => options.get(item).value === focused.value)
        || enabled.find((item) => options.get(item).selected)
        || enabled[0] || trigger).focus({ preventScroll: true });
    }
  }).observe(select, { attributes: true, childList: true, subtree: true, characterData: true });
  follow(menu, trigger);
  sync();
}

/* ---- Tooltip: any [data-tooltip] (or [title], migrated) gets the shared
   popover after 400 ms of hover, 100 ms on keyboard focus. It is a small
   machined face with one fact on it:
     data-tooltip="Mode — drag to switch, click for the menu"
                    └ label ┘   └ hint, in dim ink ┘     (split at " — " or a newline)
     data-tooltip-key="Ctrl K"       the shortcut, as keycaps
     data-tooltip-side="right"       top (default) · bottom · left · right; it flips when
                                     there is no room, and data-side (a dial's) counts too
   A path or an id (starts with / ~ or a drive, or has no spaces) is set in mono and
   breaks anywhere, so a long one wraps inside the tip instead of running off the screen.
   On a wide target (a list row) it stands over the pointer, not the middle of the row. ---- */
const TIP_GAP = 8, TIP_EDGE = 8;
const OPPOSITE = { top: "bottom", bottom: "top", left: "right", right: "left" };
const looksLikeValue = (t) => /^(~|\/|[A-Za-z]:[\\/])/.test(t) || (!/\s/.test(t) && /[\/\\_.:-]/.test(t) && t.length > 18);
function tipSide(el) {
  const side = el.dataset.tooltipSide || el.dataset.side;
  return OPPOSITE[side] ? side : "top";
}
function fillTip(tip, el) {
  const raw = el.dataset.tooltip;
  const cut = raw.search(/\n| — /);
  const label = cut < 0 ? raw : raw.slice(0, cut);
  const hint = cut < 0 ? "" : raw.slice(cut).replace(/^\n| — /, "").trim();
  const text = make("span", "nk-tooltip-text");
  const main = make("span", "nk-tooltip-label", label.trim());
  if (looksLikeValue(label.trim())) main.classList.add("is-mono");
  text.append(main);
  if (hint) text.append(make("span", "nk-tooltip-hint", hint));
  tip.replaceChildren(text);
  const keys = (el.dataset.tooltipKey || "").split(/\s+|\+/).filter(Boolean);
  if (keys.length) {
    const group = make("span", "nk-tooltip-keys");
    for (const k of keys) group.append(make("kbd", "nk-kbd", k));
    tip.append(group);
  }
}
function placeTip(tip, el, pointerX) {
  const r = el.getBoundingClientRect(), b = tip.getBoundingClientRect();
  const room = { top: r.top, bottom: innerHeight - r.bottom, left: r.left, right: innerWidth - r.right };
  const need = { top: b.height, bottom: b.height, left: b.width, right: b.width };
  let side = tipSide(el);
  if (room[side] < need[side] + TIP_GAP + TIP_EDGE && room[OPPOSITE[side]] > room[side]) side = OPPOSITE[side];
  const clamp = (v, size, max) => Math.max(TIP_EDGE, Math.min(v, max - size - TIP_EDGE));
  let x, y;
  if (side === "top" || side === "bottom") {
    // over the pointer on a target wider than the tip could sensibly point at
    const centre = r.width > 240 && pointerX != null ? Math.max(r.left, Math.min(pointerX, r.right)) : r.left + r.width / 2;
    x = centre - b.width / 2;
    y = side === "top" ? r.top - b.height - TIP_GAP : r.bottom + TIP_GAP;
  } else {
    y = r.top + r.height / 2 - b.height / 2;
    x = side === "left" ? r.left - b.width - TIP_GAP : r.right + TIP_GAP;
  }
  tip.dataset.side = side;
  tip.style.left = `${Math.round(clamp(x, b.width, innerWidth))}px`;
  tip.style.top = `${Math.round(clamp(y, b.height, innerHeight))}px`;
}
function installTooltips() {
  if (document.getElementById("nk-tooltip")) return;
  const tip = make("div", "nk-tooltip");
  tip.id = "nk-tooltip";
  tip.setAttribute("role", "tooltip");
  tip.popover = "manual";
  document.body.append(tip);
  let target = null, timer, pointerX = null;
  const describe = (el, on) => {
    const ids = new Set((el.getAttribute("aria-describedby") || "").split(" ").filter(Boolean));
    on ? ids.add(tip.id) : ids.delete(tip.id);
    ids.size ? el.setAttribute("aria-describedby", [...ids].join(" ")) : el.removeAttribute("aria-describedby");
  };
  const hide = () => {
    clearTimeout(timer);
    if (tip.matches(":popover-open")) tip.hidePopover();
    if (target) describe(target, false);
    target = null;
  };
  const show = (el, delay, x = null) => {
    hide();
    if (!el?.dataset.tooltip || el.matches(":disabled")) return;
    pointerX = x;
    timer = setTimeout(() => {
      if (!el.isConnected) return;
      target = el;
      fillTip(tip, el);
      describe(el, true);
      tip.showPopover();
      placeTip(tip, el, pointerX);
    }, delay);
  };
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse") return;
    const el = e.target.closest("[data-tooltip]");
    if (el && !el.contains(e.relatedTarget)) show(el, 400, e.clientX);
  });
  document.addEventListener("pointerout", (e) => {
    const el = e.target.closest("[data-tooltip]");
    if (el && !el.contains(e.relatedTarget)) hide();
  });
  document.addEventListener("focusin", (e) => show(e.target.closest?.("[data-tooltip]"), 100));
  document.addEventListener("focusout", hide);
  document.addEventListener("pointerdown", hide, true);
  document.addEventListener("keydown", (e) => e.key === "Escape" && hide(), true);
  document.addEventListener("scroll", hide, true);
}
function migrateTitles(root) {
  for (const el of [root, ...root.querySelectorAll("[title]")]) {
    // an iframe's title is its accessible name, not a tip: moving it would show the name over the page inside it
    if (el.hasAttribute?.("title") && !el.closest("svg") && el.tagName !== "IFRAME") {
      el.dataset.tooltip = el.getAttribute("title");
      el.removeAttribute("title");
    }
  }
}

/* ---- Two-step action: <button class="nk-pill-button" data-confirm="stop?">.
   The first click arms it (label becomes the confirm text), a second click
   within 4 s fires nk:confirm. The pill's width never changes: both labels
   share one grid cell. ---- */
function enhancePill(btn) {
  if (!once(btn, "nkPill")) return;
  const label = btn.textContent.trim();
  const confirm = btn.dataset.confirm;
  btn.replaceChildren(make("span", "nk-pill-button-text shown", label));
  if (confirm) btn.append(make("span", "nk-pill-button-text", confirm));
  if (btn.dataset.danger != null) btn.classList.add("is-danger");
  let timer;
  const [rest, armed] = btn.children;
  const disarm = () => { clearTimeout(timer); btn.classList.remove("is-armed"); rest.classList.add("shown"); armed?.classList.remove("shown"); };
  btn.addEventListener("click", () => {
    if (!confirm) return emit(btn, "nk:confirm", { action: btn.dataset.action ?? label });
    if (btn.classList.contains("is-armed")) { disarm(); return emit(btn, "nk:confirm", { action: btn.dataset.action ?? label }); }
    btn.classList.add("is-armed");
    rest.classList.remove("shown");
    armed.classList.add("shown");
    timer = setTimeout(disarm, ARM_MS);
  });
}

/* ---- Segmented tabs: hover a tab for 180 ms or click it. A tab with
   aria-controls shows its panel and hides its siblings'. ---- */
function enhanceSegmented(bank) {
  if (!once(bank, "nkSeg")) return;
  const tabs = [...bank.querySelectorAll(".nk-segmented-btn")];
  let timer;
  const pick = (tab) => {
    clearTimeout(timer);
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      const panel = t.getAttribute("aria-controls") && document.getElementById(t.getAttribute("aria-controls"));
      if (panel) panel.hidden = !on;
    }
    emit(bank, "nk:change", { value: tab.dataset.value ?? tab.textContent.trim() });
  };
  for (const tab of tabs) {
    tab.addEventListener("click", () => pick(tab));
    tab.addEventListener("pointerenter", () => { clearTimeout(timer); timer = setTimeout(() => pick(tab), HOVER_SWITCH_MS); });
    tab.addEventListener("pointerleave", () => clearTimeout(timer));
  }
}

/* ---- Choice (radio bank) and Switch. ---- */
function enhanceChoice(group) {
  if (!once(group, "nkChoice")) return;
  const btns = [...group.querySelectorAll(".nk-choice-btn")];
  const pick = (btn) => {
    for (const b of btns) { const on = b === btn; b.setAttribute("aria-checked", String(on)); b.tabIndex = on ? 0 : -1; }
    emit(group, "nk:change", { value: btn.dataset.value ?? btn.textContent.trim() });
  };
  btns.forEach((btn, i) => {
    btn.addEventListener("click", () => pick(btn));
    btn.addEventListener("keydown", (e) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      const next = btns[(i + step + btns.length) % btns.length];
      pick(next);
      next.focus();
    });
  });
}
function enhanceSwitch(sw) {
  if (!once(sw, "nkSwitch")) return;
  sw.addEventListener("click", () => {
    const on = sw.getAttribute("aria-checked") !== "true";
    sw.setAttribute("aria-checked", String(on));
    emit(sw, "nk:change", { value: on });
  });
}

/* ---- Readings: the value a component draws is also the number it prints.
   Leave the printed reading empty and the kit fills it from the value, and
   keeps it in step on every change; write your own words in it and they
   are left alone. Returns true when the text changed. ---- */
function reading(el, text, tone) {
  if (!el || !(el.dataset.nkAuto || !el.textContent.trim())) return false;
  const changed = el.textContent !== text;
  el.textContent = text;
  el.dataset.nkAuto = "1";
  if (tone) el.dataset.tone = tone; else delete el.dataset.tone;
  return changed;
}

/* ---- Segmented level meter: <div class="nk-seg" data-frac="0.62" data-tone="warn">.
   3px segments on a 5px pitch, drawn as crisp integer rects, as many as fit. ---- */
const SEG = 3, PITCH = 5, SEG_H = 10;
// data-value of data-max (+ data-unit) is an amount; data-frac a fraction
function segValue(el) {
  const max = Number(el.dataset.max), amount = Number(el.dataset.value);
  const isAmount = el.dataset.max != null && max > 0 && el.dataset.value != null && Number.isFinite(amount);
  return { isAmount, amount, max, frac: Math.min(1, Math.max(0, isAmount ? amount / max : Number(el.dataset.frac) || 0)) };
}
// a meter's or a limit's number is its value: printed, not typed (even
// before the meter has a size, e.g. in a hidden tab)
function segReading(el) {
  const { isAmount, amount, max, frac } = segValue(el);
  const host = el.closest(".nk-meter, .nk-limit");
  const printed = host && [...host.children].find((c) => c.matches(".nk-meter-value, .nk-limit-pct"));
  if (reading(printed, isAmount ? `${fmtNum(amount)}/${fmtNum(max)}${el.dataset.unit ?? ""}` : fmtPercent(frac), el.dataset.tone)) { const scope = el.closest(".nk-panel-body, .nk-page"); if (scope) alignMeters(scope); }
}
function drawSeg(el) {
  const { frac } = segValue(el);
  const width = Math.floor(el.clientWidth);
  const count = Math.max(0, Math.floor((width + PITCH - SEG) / PITCH));
  const lit = Math.round(frac * count);
  const drawn = Math.max(0, count * PITCH - (PITCH - SEG));
  el.setAttribute("role", "meter");
  el.setAttribute("aria-valuemin", "0");
  el.setAttribute("aria-valuemax", "100");
  el.setAttribute("aria-valuenow", String(Math.round(frac * 100)));
  const s = svg("svg", { width: drawn, height: SEG_H, viewBox: `0 0 ${drawn} ${SEG_H}`, "shape-rendering": "crispEdges", "aria-hidden": "true" });
  for (let i = 0; i < count; i++) s.append(svg("rect", { x: i * PITCH, y: 0, width: SEG, height: SEG_H, class: i < lit ? "on" : "" }));
  el.replaceChildren(s);
  segReading(el);
}

/* ---- Progress: .nk-progress data-value (of data-max, default 100) sets the
   fill and what assistive tech hears; without data-value, --v still works
   and no --v sweeps (indeterminate). ---- */
function syncProgress(el) {
  const max = Number(el.dataset.max) || 100, v = Number(el.dataset.value);
  if (el.dataset.value == null || !Number.isFinite(v)) return;
  const f = Math.max(0, Math.min(1, v / max));
  el.style.setProperty("--v", (f * 100).toFixed(2));
  el.setAttribute("role", "progressbar");
  el.setAttribute("aria-valuemin", "0"); el.setAttribute("aria-valuemax", String(max)); el.setAttribute("aria-valuenow", String(v));
  el.setAttribute("aria-valuetext", fmtPercent(f));
}
/* ---- Busy dial: .nk-dial data-progress="42" (0–100) draws the arc and
   prints the slot's readout; data-progress="none" still spins. ---- */
function syncDial(el) {
  const p = Number(el.dataset.progress);
  if (el.dataset.progress == null || !Number.isFinite(p)) return;
  el.style.setProperty("--progress", String(p));
  reading(el.closest(".nk-slot")?.querySelector(".nk-readout"), fmtPercent(p / 100));
}
/* ---- Stages: an <li data-progress=".62"> fills its rail and prints the
   percentage at the end of its sub-line (after any words you wrote). ---- */
function syncStages(list) {
  for (const li of list.children) {
    const p = Number(li.dataset.progress);
    if (li.dataset.progress == null || !Number.isFinite(p)) continue;
    li.style.setProperty("--progress", String(p));
    let sub = [...li.children].find((c) => c.localName === "span");
    if (!sub) { sub = make("span"); li.append(sub); }
    let pct = sub.querySelector(".nk-stages-pct");
    if (!pct) { pct = make("span", "nk-stages-pct"); sub.append(pct); }
    pct.textContent = fmtPercent(p);
    pct.toggleAttribute("data-sep", [...sub.childNodes].some((n) => n !== pct && n.textContent.trim()));
  }
}

/* ---- Donut: data-segments='[{"label":"GPU","value":61},…]' data-amount-unit="EUR"
   data-unit="EUR / MO". A monochrome ramp, largest first; the centre is the
   total unless data-center is given. ---- */
const RAMP = ["var(--text)", "var(--muted)", "var(--dim)", "var(--faint)", "var(--line2)"];
function drawDonut(el) {
  const R = 51, C = 2 * Math.PI * R, GAP = 1.5;
  const parts = json(el.dataset.segments, [])
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value)
    .map((s, i) => ({ ...s, colour: RAMP[Math.min(i, RAMP.length - 1)] }));
  // one source of truth: the values size the arcs, print the amounts
  // (data-amount-unit, via format.js) and, unless data-center says
  // otherwise, the total in the middle. "display" is only a text override.
  const sum = parts.reduce((acc, p) => acc + p.value, 0), total = sum || 1;
  const amountUnit = el.dataset.amountUnit ?? "";
  const chart = make("div", "nk-donut-chart");
  const s = svg("svg", { viewBox: "0 0 112 112", "aria-hidden": "true" });
  let offset = 0;
  for (const p of parts) {
    const length = (p.value / total) * C;
    s.append(svg("circle", { cx: 56, cy: 56, r: R, stroke: p.colour, "stroke-dasharray": `${Math.max(length - GAP, 0.5)} ${C}`, "stroke-dashoffset": -offset }));
    offset += length;
  }
  const center = make("div", "nk-donut-center");
  center.append(make("span", "nk-donut-value", el.dataset.center ?? (parts.length ? fmtNum(sum) : fmtNum(null))));
  if (el.dataset.unit) center.append(make("span", "nk-donut-unit", el.dataset.unit));
  chart.append(s, center);
  const legend = make("div", "nk-donut-legend");
  parts.forEach((p, i) => {
    const row = make("div", `nk-donut-row${i > 1 ? " is-minor" : ""}`);
    const swatch = make("span", "nk-donut-swatch");
    swatch.style.background = p.colour;
    row.append(swatch, make("span", "nk-donut-label", p.label), make("span", "nk-donut-amt", p.display ?? fmtUnit(p.value, amountUnit)));
    legend.append(row);
  });
  el.replaceChildren(chart, legend);
}

/* ---- Bars: data-values="[1.2,0.8,null,…]" (null = not measured),
   data-highlight="14" (the current slot), data-unit="kWh". Bars fill the
   column; 24 values get an hour axis. ---- */
function drawBars(el) {
  const values = json(el.dataset.values, []);
  const GAP = 2, H = 40;
  const width = el.clientWidth;
  if (!width) return;
  const slots = Math.max(24, values.length);
  const now = el.dataset.highlight != null ? Number(el.dataset.highlight) : values.length - 1;
  const bar = Math.max(1, Math.floor((width - (slots - 1) * GAP) / slots));
  const drawn = slots * bar + (slots - 1) * GAP;
  const peak = Math.max(...values.map((v) => v ?? 0), 1);
  const s = svg("svg", { width: drawn, height: H, viewBox: `0 0 ${drawn} ${H}`, "shape-rendering": "crispEdges", role: "img", "aria-label": `${values.length} readings${el.dataset.unit ? ` in ${el.dataset.unit}` : ""}` });
  for (let i = 0; i < slots; i++) {
    const x = i * (bar + GAP), v = values[i];
    if (i > now || v == null) s.append(svg("rect", { class: "future", x, y: H - 1, width: bar, height: 1 }));
    else { const h = Math.max(2, Math.round((v / peak) * H)); s.append(svg("rect", { class: i === now ? "now" : "", x, y: H - h, width: bar, height: h })); }
  }
  const nodes = [s];
  if (slots === 24) {
    const axis = make("div", "nk-bars-axis");
    axis.style.width = `${drawn}px`;
    for (const hour of [0, 6, 12, 18]) { const t = make("span", "", String(hour).padStart(2, "0")); t.style.left = `${hour * (bar + GAP)}px`; axis.append(t); }
    axis.append(make("span", "end", "24"));
    nodes.push(axis);
  }
  el.replaceChildren(...nodes);
}

/* ---- Every meter on a page shares one label column (and every limit its
   own), so bars start on the same x even across sections. ---- */
function alignMeters(scope) {
  const range = document.createRange();
  const widest = (sel) => Math.ceil(Math.max(0, ...[...scope.querySelectorAll(sel)].map((n) => { range.selectNodeContents(n); return range.getBoundingClientRect().width; })));
  const label = widest(".nk-meter-label");
  scope.style.setProperty("--meter-cols", label ? `min(${label}px, 45%) minmax(0, 1fr) ${widest(".nk-meter-value")}px` : "");
  const limit = widest(".nk-limit-label");
  scope.style.setProperty("--limit-cols", limit ? `min(${limit}px, 40%) minmax(0, 1fr) ${widest(".nk-limit-pct")}px ${widest(".nk-limit-resets")}px` : "");
}

/* ---- Chips: a label that would clip spans one more column. ---- */
function fitChips(grid) {
  const cols = Number(getComputedStyle(grid).getPropertyValue("--cols")) || 3;
  for (const chip of grid.querySelectorAll(".nk-chip")) {
    const label = chip.querySelector(".nk-chip-label");
    let span = 1;
    chip.style.gridColumn = "";
    while (label && label.scrollWidth > label.clientWidth + 1 && span < cols) chip.style.gridColumn = `span ${++span}`;
  }
}


/* ---- Level (a recording meter): level(el, [0..1, …]) sets each
   bar's height. data-bars sets how many bars there are (default 36).
   data-demo animates a synthetic signal for catalogues — never a microphone. ---- */
export function level(el, values) {
  const bars = el.children;
  for (let i = 0; i < bars.length; i++) {
    const v = values[Math.floor((i / bars.length) * values.length)] ?? 0;
    bars[i].style.setProperty("--v", String(Math.max(0.08, Math.min(1, v))));
  }
}
function enhanceLevel(el) {
  if (!once(el, "nkLevel")) return;
  const n = Number(el.dataset.bars) || 36;
  el.setAttribute("role", "img");
  if (!el.hasAttribute("aria-label")) el.setAttribute("aria-label", "Input level");
  el.replaceChildren(...Array.from({ length: n }, () => make("i")));
  if (el.dataset.demo == null || matchMedia("(prefers-reduced-motion: reduce)").matches) return level(el, Array(n).fill(0.12));
  let t = 0;
  const step = () => {
    if (!el.isConnected) return;
    t += 0.09;
    const env = 0.35 + 0.65 * Math.abs(Math.sin(t * 0.7));
    level(el, Array.from({ length: n }, (_, i) => env * (0.25 + 0.75 * Math.abs(Math.sin(i * 0.45 + t * 2.1) * Math.cos(i * 0.13 - t)))));
    setTimeout(step, 80);
  };
  step();
}

/* ---- Carousel: .nk-carousel with a .nk-carousel-rail of cards. Adds the
   counter and previous/next; the rail stays a native scroll-snap list. ---- */
function enhanceCarousel(box) {
  if (!once(box, "nkCarousel")) return;
  const rail = box.querySelector(".nk-carousel-rail");
  if (!rail) return;
  const cards = () => [...rail.children].filter((c) => c.matches(".nk-source-card"));
  const count = box.querySelector("[data-count]");
  let current = 0;
  const show = () => { if (count) count.textContent = `${current + 1} / ${cards().length}`; };
  const go = (d) => {
    const list = cards();
    current = (current + d + list.length) % list.length;
    rail.scrollTo({ left: list[current].offsetLeft - list[0].offsetLeft, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    show();
  };
  box.querySelector("[data-prev]")?.addEventListener("click", () => go(-1));
  box.querySelector("[data-next]")?.addEventListener("click", () => go(1));
  let frame = 0;
  rail.addEventListener("scroll", () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {   // at most one measurement per frame
      frame = 0;
      const list = cards();
      if (!list.length) return;
      current = Math.min(list.length - 1, Math.round(rail.scrollLeft / (list[0].offsetWidth + 12)));
      show();
    });
  }, { passive: true });
  show();
}

/* ---- Dot matrix (an LED readout): <span class="nk-matrix" data-text="42.7">.
   5×7 glyphs for digits, A–Z, and . : - % / ---- */
const GLYPHS = {
  "0": "01110100011001110101110011000101110", "1": "00100011000010000100001000010001110", "2": "01110100010000100010001000100011111",
  "3": "01110100010000100110000011000101110", "4": "00010001100101010010111110001000010", "5": "11111100001111000001000011000101110",
  "6": "00110010001000011110100011000101110", "7": "11111000010001000100010000100001000", "8": "01110100011000101110100011000101110",
  "9": "01110100011000101111000010001001100", ".": "00000000000000000000000000110001100", ":": "00000011000110000000011000110000000",
  "-": "00000000000000011111000000000000000", "+": "00000001000010011111001000010000000", "%": "11001110010001000100010001001110011", "/": "00001000010001000100010001000010000",
  " ": "00000000000000000000000000000000000",
  A: "01110100011000111111100011000110001", B: "11110100011000111110100011000111110", C: "01110100011000010000100001000101110",
  D: "11110100011000110001100011000111110", E: "11111100001000011110100001000011111", F: "11111100001000011110100001000010000",
  G: "01110100011000010111100011000101111", H: "10001100011000111111100011000110001", I: "01110001000010000100001000010001110",
  K: "10001100101010011000101001001010001", L: "10000100001000010000100001000011111", M: "10001110111010110101100011000110001",
  N: "10001110011010110011100011000110001", O: "01110100011000110001100011000101110", P: "11110100011000111110100001000010000",
  R: "11110100011000111110101001001010001", S: "01111100001000001110000010000111110", T: "11111001000010000100001000010000100",
  U: "10001100011000110001100011000101110", V: "10001100011000110001100010101000100", W: "10001100011000110101101011010101010",
  X: "10001100010101000100010101000110001", Y: "10001100010101000100001000010000100", Z: "11111000010001000100010001000011111",
};
function drawMatrix(el) {
  const text = (el.dataset.text ?? el.textContent).toUpperCase();
  const r = Number(el.dataset.dot) || 2.2, gap = Number(el.dataset.gap) || 2, step = r * 2 + gap;
  let x = 0;
  const dots = [];
  for (const ch of text) {
    const g = GLYPHS[ch] ?? GLYPHS[" "];
    const narrow = ch === "." || ch === ":";
    const cols = narrow ? 2 : 5, skip = narrow ? 2 : 0;
    for (let row = 0; row < 7; row++) for (let c = 0; c < cols; c++) dots.push({ x: x + c * step + r, y: row * step + r, on: g[row * 5 + c + skip] === "1" });
    x += cols * step + step * 0.6;
  }
  const w = Math.max(0, x - step * 0.6 - gap), h = 7 * step - gap;
  const s = svg("svg", { width: w, height: h, viewBox: `0 0 ${w} ${h}`, role: "img", "aria-label": text });
  for (const d of dots) s.append(svg("circle", { cx: d.x, cy: d.y, r, class: d.on ? "on" : "" }));
  el.replaceChildren(s);
}


/* ---- Dialog: <button data-dialog="id"> opens <dialog id class="nk-dialog">
   modally; [data-dialog-close] closes it; a click on the backdrop closes it.
   The dialog's returnValue carries the value of the button that closed it. ---- */
function enhanceDialogTrigger(btn) {
  if (!once(btn, "nkDialog")) return;
  btn.addEventListener("click", () => document.getElementById(btn.dataset.dialog)?.showModal());
}
function enhanceDialog(d) {
  if (!once(d, "nkDialogSelf")) return;
  d.addEventListener("click", (e) => {
    const close = e.target.closest("[data-dialog-close]");
    if (close) return d.close(close.value || close.dataset.dialogClose || "");
    const r = d.getBoundingClientRect();
    if (e.target === d && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) d.close("");
  });
  d.addEventListener("close", () => emit(d, "nk:change", { value: d.returnValue }));
}

/* ---- Menu and popover: <button data-menu="id"> / data-popover="id"
   anchors a [popover] .nk-menu / .nk-popover beside it. data-hover on the
   trigger opens a popover on hover (reading needs no click). Menu items
   emit nk:confirm with their data-action. ---- */
function anchorTo(pop, trigger) {
  follow(pop, trigger);
  pop.addEventListener("toggle", (e) => trigger.setAttribute("aria-expanded", String(e.newState === "open")));
}
// Up/Down/Home/End over a menu's items; true when the key was handled.
function menuKeys(menu, e) {
  const items = [...menu.querySelectorAll(".nk-menu-item:not(:disabled)")];
  const j = arrowIndex(e, items.indexOf(document.activeElement), items.length, { axis: "y" });
  if (j == null) return false;
  e.preventDefault();
  items[j].focus();
  return true;
}
function enhanceMenuTrigger(btn) {
  if (!once(btn, "nkMenu")) return;
  const menu = document.getElementById(btn.dataset.menu);
  if (!menu) return;
  menu.popover ||= "auto";
  menu.setAttribute("role", "menu");
  btn.setAttribute("aria-haspopup", "menu");
  btn.setAttribute("aria-expanded", "false");
  anchorTo(menu, btn);
  btn.addEventListener("click", () => { menu.togglePopover(); if (menu.matches(":popover-open")) menu.querySelector(".nk-menu-item:not(:disabled)")?.focus(); });
  menu.addEventListener("keydown", (e) => { if (!menuKeys(menu, e) && e.key === "Escape") btn.focus(); });
  menu.addEventListener("click", (e) => {
    const item = e.target.closest(".nk-menu-item");
    if (!item || item.disabled) return;
    emit(item, "nk:confirm", { action: item.dataset.action ?? item.textContent.trim() });
    menu.hidePopover();
    btn.focus();
  });
  for (const item of menu.querySelectorAll(".nk-menu-item")) item.setAttribute("role", "menuitem");
}
function enhancePopoverTrigger(btn) {
  if (!once(btn, "nkPopover")) return;
  const pop = document.getElementById(btn.dataset.popover);
  if (!pop) return;
  pop.popover ||= "auto";
  anchorTo(pop, btn);
  btn.addEventListener("click", () => pop.togglePopover());
  if (btn.dataset.hover != null) {
    let t;
    const open = () => { clearTimeout(t); t = setTimeout(() => !pop.matches(":popover-open") && pop.showPopover(), HOVER_SWITCH_MS); };
    const close = () => { clearTimeout(t); t = setTimeout(() => pop.matches(":popover-open") && pop.hidePopover(), 280); };
    btn.addEventListener("pointerenter", open);
    btn.addEventListener("pointerleave", close);
    pop.addEventListener("pointerenter", () => clearTimeout(t));
    pop.addEventListener("pointerleave", close);
  }
}

/* ---- Notice: a [data-notice-detail] button reveals the detail block. ---- */
function enhanceNotice(n) {
  if (!once(n, "nkNotice")) return;
  const btn = n.querySelector("[data-notice-detail]"), detail = n.querySelector(".nk-notice-detail");
  if (!btn || !detail) return;
  btn.setAttribute("aria-expanded", String(!detail.hidden));
  btn.addEventListener("click", () => { detail.hidden = !detail.hidden; btn.setAttribute("aria-expanded", String(!detail.hidden)); });
}

/* ---- Slider: keeps --v (the filled share) and a sibling <output> in step. ---- */
function enhanceSlider(input) {
  if (!once(input, "nkSlider")) return;
  const out = input.parentElement?.querySelector("output");
  const sync = () => {
    const min = Number(input.min || 0), max = Number(input.max || 100);
    input.style.setProperty("--v", String(((Number(input.value) - min) / (max - min || 1)) * 100));
    if (out) out.textContent = input.dataset.unit ? `${input.value}${input.dataset.unit}` : input.value;
  };
  input.addEventListener("input", sync);
  sync();
}

/* ---- Stepper: − and + around a number input, honouring min, max, step. ---- */
function enhanceStepper(box) {
  if (!once(box, "nkStepper")) return;
  const input = box.querySelector("input");
  const [dec, inc] = box.querySelectorAll("button");
  if (!input || !dec || !inc) return;
  const bound = () => { const v = Number(input.value); dec.disabled = input.min !== "" && v <= Number(input.min); inc.disabled = input.max !== "" && v >= Number(input.max); };
  const bump = (d) => { d > 0 ? input.stepUp() : input.stepDown(); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); bound(); };
  dec.addEventListener("click", () => bump(-1));
  inc.addEventListener("click", () => bump(1));
  input.addEventListener("input", bound);
  bound();
}

/* ---- List search: an input[data-filter="listId"] hides non-matching items. ---- */
function enhanceFilter(input) {
  if (!once(input, "nkFilter")) return;
  const list = document.getElementById(input.dataset.filter);
  if (!list) return;
  const empty = list.querySelector(".nk-list-empty");
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    let shown = 0;
    for (const item of list.querySelectorAll(".nk-list-item")) { const hit = item.textContent.toLowerCase().includes(q); item.hidden = !hit; shown += hit; }
    if (empty) empty.hidden = shown > 0;
  });
}

/* ---- Composer: grows with its text, switches to the card shape past one
   line, Enter sends (nk:confirm with the text), Shift+Enter breaks a line. ---- */
function enhanceComposer(box) {
  if (!once(box, "nkComposer")) return;
  const ta = box.querySelector("textarea"), send = box.querySelector(".nk-send");
  if (!ta) return;
  const fit = () => {
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
    box.classList.toggle("is-multiline", ta.value.includes("\n") || ta.scrollHeight > 44);
    if (send) send.disabled = !ta.value.trim();
  };
  const submit = () => { const text = ta.value.trim(); if (!text) return; emit(box, "nk:confirm", { action: "send", text }); ta.value = ""; fit(); };
  ta.addEventListener("input", fit);
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } });
  send?.addEventListener("click", submit);
  fit();
}

/* ---- Code block: a [data-copy] button copies the block's text. ---- */
function enhanceCode(block) {
  if (!once(block, "nkCode")) return;
  const btn = block.querySelector("[data-copy]"), pre = block.querySelector("pre");
  btn?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(pre.textContent); btn.textContent = "Copied"; } catch { btn.textContent = "Select to copy"; }
    setTimeout(() => (btn.textContent = "Copy"), 1400);
  });
}

/* ---- Swatches: .nk-swatches of label.nk-swatch (native radio + lens), an
   optional .nk-swatch-hex and .nk-swatch-add. nk:change carries the hex.
   .is-labeled prints each key's name and hex; the + key opens a compact
   colour picker and adds or updates one custom swatch. ---- */
function enhanceSwatches(box) {
  if (!once(box, "nkSwatches")) return;
  const hex = box.querySelector(".nk-swatch-hex"), add = box.querySelector(".nk-swatch-add");
  const labeled = box.classList.contains("is-labeled");
  const label = (sw) => {
    if (!labeled) return;
    const input = sw.querySelector("input");
    let name = sw.querySelector(".nk-swatch-name"), code = sw.querySelector(".nk-swatch-code");
    if (!name) { name = make("b", "nk-swatch-name"); code = make("small", "nk-swatch-code"); sw.append(name, code); }
    name.textContent = input.getAttribute("aria-label") || input.value;
    code.textContent = input.value;
  };
  box.querySelectorAll(".nk-swatch").forEach(label);
  const choose = (value) => {
    const v = value.toLowerCase();
    box.querySelectorAll("input[type=radio]").forEach((r) => (r.checked = r.value.toLowerCase() === v));
    if (hex) hex.value = v;
    emit(box, "nk:change", { value: v });
  };
  // one custom swatch, added before the + key and updated afterwards
  const custom = (value) => {
    let sw = box.querySelector(".nk-swatch.is-custom");
    if (!sw) {
      const first = box.querySelector("input[type=radio]");
      sw = make("label", "nk-swatch is-custom");
      const r = make("input"); r.type = "radio"; r.name = first?.name || "nk-swatch"; r.setAttribute("aria-label", "Custom");
      sw.append(r, make("span"));
      const anchor = add ?? hex;
      if (anchor) anchor.before(sw); else box.append(sw);
    }
    const v = value.toLowerCase();
    sw.style.setProperty("--c", v);
    sw.querySelector("input").value = v;
    label(sw);
    choose(v);
  };
  box.addEventListener("change", (e) => {
    if (e.target.type === "radio") { if (hex) hex.value = e.target.value; emit(box, "nk:change", { value: e.target.value }); }
  });
  hex?.addEventListener("change", () => {
    if (!/^#[0-9a-f]{6}$/i.test(hex.value)) return;
    const known = [...box.querySelectorAll(".nk-swatch:not(.is-custom) input")].some((r) => r.value.toLowerCase() === hex.value.toLowerCase());
    if (add && !known) custom(hex.value); else choose(hex.value);
  });
  if (add) {
    add.type = "button";
    if (!add.hasAttribute("aria-label")) add.setAttribute("aria-label", "Custom colour");
    const pop = make("div", "nk-popover nk-swatch-pop");
    pop.popover = "auto";
    pop.id = `nk-swatch-pop-${Math.random().toString(36).slice(2, 8)}`;
    const current = box.querySelector("input:checked")?.value ?? "#e54866";
    const picker = make("div", "nk-colour is-compact");
    picker.dataset.value = current;
    pop.append(picker);
    box.append(pop);
    add.setAttribute("aria-haspopup", "dialog");
    anchorTo(pop, add);
    add.addEventListener("click", () => {
      if (!pop.matches(":popover-open")) picker.nkSet?.(box.querySelector("input:checked")?.value ?? current);
      pop.togglePopover();
    });
    // the picker's own changes stop here; the swatches speak for it
    pop.addEventListener("nk:change", (e) => { e.stopPropagation(); if (e.target === picker) custom(e.detail.value); });
    enhance(pop);
  }
}


/* ---- Icons: the sprite's address, set once with init({ icons }). ---- */
let SPRITE = "icons/icons.svg";
export function icon(name, cls = "nk-icon") {
  const s = svg("svg", { class: cls, "aria-hidden": "true" });
  const u = svg("use", {});
  u.setAttribute("href", `${SPRITE}#${name}`);
  s.append(u);
  return s;
}

/* ---- Knob: <button class="nk-knob" data-options='[{"value","label","color","icon"}]'
   data-value="…" aria-label="Mode">. Drag up/down (26px a detent), scroll or
   arrow keys to turn; a click without a drag passes through (to its menu). ---- */
function enhanceKnob(knob) {
  if (!once(knob, "nkKnob")) return;
  const opts = json(knob.dataset.options, null);
  const cap = make("span", "nk-knob-cap");
  if (!opts) {
    if (knob.dataset.icon) cap.append(icon(knob.dataset.icon, "nk-knob-glyph"));
    knob.replaceChildren(cap);
    const count = make("span", "nk-knob-count");
    const sync = () => {
      const n = Number(knob.dataset.count) || 0;
      count.textContent = String(n);
      count.hidden = n === 0;
      const name = knob.getAttribute("aria-label")?.split(" (")[0] || "Attach";
      knob.setAttribute("aria-label", n ? `${name} (${n} attached)` : name);
    };
    knob.append(count);
    new MutationObserver(sync).observe(knob, { attributes: true, attributeFilter: ["data-count"] });
    sync();
    return;
  }
  const n = opts.length, spread = n > 1 ? 80 : 0;
  const angle = (i) => (n > 1 ? -spread / 2 + (spread * i) / (n - 1) : 0);
  const detents = opts.map((o, i) => { const d = make("span", "nk-knob-detent"); d.style.setProperty("--a", `${angle(i)}deg`); d.style.setProperty("--c", o.color || "var(--muted)"); return d; });
  const glyph = make("span", "");
  cap.append(glyph);
  knob.replaceChildren(...detents, cap);
  let index = Math.max(0, opts.findIndex((o) => o.value === knob.dataset.value));
  const set = (i, announce = true) => {
    i = Math.max(0, Math.min(n - 1, i));
    const prev = index;
    const changed = i !== index;
    index = i;
    const o = opts[i];
    knob.dataset.value = o.value;
    knob.style.setProperty("--turn", `${angle(i)}deg`);
    knob.style.setProperty("--c", o.color || "var(--muted)");
    detents.forEach((d, j) => d.classList.toggle("is-on", j === i));
    glyph.replaceChildren(o.icon ? icon(o.icon, "nk-knob-glyph") : "");
    if (changed) {   // replay the detent spring in the direction of the turn
      knob.classList.remove("is-turn-up", "is-turn-down");
      void knob.offsetWidth;
      knob.classList.add(i > prev ? "is-turn-up" : "is-turn-down");
    }
    const name = knob.getAttribute("aria-label")?.split(":")[0] || "Choice";
    knob.setAttribute("aria-label", `${name}: ${o.label}`);
    knob.setAttribute("aria-valuetext", o.label);
    if (changed && announce) emit(knob, "nk:change", { value: o.value });
  };
  knob.setAttribute("role", knob.dataset.menu ? "button" : "slider");
  set(index, false);
  let startI = 0;
  drag(knob, { threshold: 5, start: () => { startI = index; }, move: (e, dx, dy) => set(startI + Math.round(-dy / 26)) });
  knob.addEventListener("wheel", (e) => { e.preventDefault(); set(index + (e.deltaY < 0 ? 1 : -1)); }, { passive: false });
  knob.addEventListener("keydown", (e) => {
    const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    if (d) { e.preventDefault(); set(index + d); }
  });
  // without a menu, a click steps to the next detent, round to the first
  // (a drag's closing click is swallowed by drag(), so turning doesn't also step)
  if (!knob.dataset.menu) knob.addEventListener("click", () => set((index + 1) % n));
  knob.nkSet = (v) => { const i = opts.findIndex((o) => o.value === v); if (i >= 0) set(i, false); };
}


/* ---- Continuous knob: <button class="nk-knob" data-min="0" data-max="100"
   data-value="64" data-step="1" data-default="50" data-unit="%" data-icon
   data-bipolar data-show-value data-color> — a ring of lamps over 270°. A
   sibling <output> in the same .nk-knob-unit shows the formatted value. ---- */
function enhanceRangeKnob(knob) {
  if (!once(knob, "nkRange")) return;
  knob.classList.add("is-range");
  const bipolar = knob.dataset.bipolar != null;
  const m = valueModel(knob, { min: 0, max: 100, step: 1 });
  const { min, max, step, unit } = m;
  const def = Number(knob.dataset.default ?? (bipolar ? (min + max) / 2 : min));
  const count = Number(knob.dataset.segments) || (Number(getComputedStyle(knob).getPropertyValue("--knob-size").replace("px", "")) < 44 ? 15 : 25);
  if (knob.dataset.color) knob.style.setProperty("--c", knob.dataset.color);
  const segs = Array.from({ length: count }, (_, i) => { const s = make("span", "nk-knob-seg"); s.style.setProperty("--a", `${-135 + (270 * i) / (count - 1) + 180}deg`); return s; });
  const cap = make("span", "nk-knob-cap");
  const text = make("span", "nk-knob-text");
  if (knob.dataset.icon) cap.append(icon(knob.dataset.icon, "nk-knob-glyph"));
  else if (knob.dataset.showValue != null) cap.append(text);
  knob.replaceChildren(...segs, cap);
  const out = knob.closest(".nk-knob-unit")?.querySelector("output");
  const fmt = (v) => (bipolar && v > 0 ? "+" : "") + m.fmt(v);
  let value = Number(knob.dataset.value ?? def);
  knob.setAttribute("role", "slider");
  knob.setAttribute("aria-valuemin", String(min));
  knob.setAttribute("aria-valuemax", String(max));
  const set = (v, announce = true) => {
    v = m.fit(v);
    const changed = v !== value;
    value = v;
    knob.dataset.value = String(v);
    const f = (v - min) / (max - min || 1);
    const mid = (count - 1) / 2, at = f * (count - 1);
    segs.forEach((s, i) => s.classList.toggle("is-on", bipolar ? (at >= mid ? i >= mid && i <= at + 0.001 : i <= mid && i >= at - 0.001) : i <= at + 0.001 && f > 0));
    text.textContent = fmt(v).replace(unit, "").trim();   // the cap shows the number; the unit lives in the reading
    if (out) out.textContent = fmt(v);
    knob.setAttribute("aria-valuenow", String(v));
    knob.setAttribute("aria-valuetext", fmt(v));
    if (changed && announce) emit(knob, "nk:change", { value: v });
  };
  set(value, false);
  knob.nkSet = (v) => set(Number(v), false);
  const span = m.span;
  let base = null;   // re-anchored when Shift changes, so going fine never jumps
  drag(knob, {
    start: () => { base = { d: 0, v: value, fine: false }; },
    move: (e, dx, dy) => {
      if (e.shiftKey !== base.fine) base = { d: dy, v: value, fine: e.shiftKey };
      set(base.v + ((base.d - dy) / (base.fine ? 600 : 150)) * span);
    },
  });
  knob.addEventListener("dblclick", () => set(def));
  knob.addEventListener("wheel", (e) => { e.preventDefault(); set(value + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? step : Math.max(step, span / 40))); }, { passive: false });
  knob.addEventListener("keydown", (e) => {
    const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    if (d) { e.preventDefault(); set(value + d * (e.shiftKey ? step : Math.max(step, span / 20))); }
    if (e.key === "Home") set(min);
    if (e.key === "End") set(max);
  });
}

/* ---- Data table: <th data-sort> headers sort (numbers numerically, by the
   cell's data-value when present); input[data-table="id"] filters rows; a
   [data-count] element shows how many are visible. ---- */
function enhanceDataTable(table) {
  if (!once(table, "nkTable")) return;
  const body = table.tBodies[0];
  const heads = [...table.querySelectorAll("th[data-sort]")];
  const count = document.querySelector(`[data-count-for="${table.id}"]`);
  const recount = () => { if (count) { const all = body.rows.length, shown = [...body.rows].filter((r) => !r.hidden).length; count.textContent = shown === all ? `${all} rows` : `${shown} of ${all}`; } };
  heads.forEach((th) => {
    const col = [...th.parentElement.children].indexOf(th);
    const btn = make("button", "", th.textContent.trim());
    btn.type = "button";
    th.replaceChildren(btn);
    btn.addEventListener("click", () => {
      const dir = th.getAttribute("aria-sort") === "ascending" ? "descending" : "ascending";
      heads.forEach((h) => h.removeAttribute("aria-sort"));
      th.setAttribute("aria-sort", dir);
      const key = (r) => { const c = r.cells[col]; const v = c.dataset.value ?? c.textContent.trim(); const num = parseFloat(v.replace(/[^0-9.\-]/g, "")); return th.dataset.sort === "number" && !isNaN(num) ? num : v.toLowerCase(); };
      const rows = [...body.rows].sort((a, b) => { const x = key(a), y = key(b); return (x > y ? 1 : x < y ? -1 : 0) * (dir === "ascending" ? 1 : -1); });
      body.append(...rows);
      emit(table, "nk:change", { sort: th.textContent.trim(), dir });
    });
  });
  const filter = document.querySelector(`input[data-table="${table.id}"]`);
  filter?.addEventListener("input", () => {
    const q = filter.value.trim().toLowerCase();
    for (const r of body.rows) r.hidden = !r.textContent.toLowerCase().includes(q);
    recount();
  });
  recount();
}

/* ---- Drop zone: <label class="nk-drop"><input type="file" multiple>…</label>
   followed by a .nk-files list. Lists what was chosen or dropped; each row
   can be removed. Emits nk:change with the current File list. ---- */
const fmtSize = (b) => bytes(b);
function enhanceDrop(zone) {
  if (!once(zone, "nkDrop")) return;
  const input = zone.querySelector("input[type=file]");
  const list = zone.parentElement.querySelector(".nk-files");
  let files = [];
  const render = () => {
    if (!list) return;
    list.replaceChildren(...files.map((f, i) => {
      const row = make("div", "nk-file");
      row.append(icon("file", "nk-icon is-sm"), make("span", "", f.name), make("small", "", fmtSize(f.size)));
      const rm = make("button", "nk-icon-button is-ghost");
      rm.type = "button";
      rm.setAttribute("aria-label", `Remove ${f.name}`);
      rm.append(icon("x"));
      rm.addEventListener("click", () => { files.splice(i, 1); render(); emit(zone, "nk:change", { files }); });
      row.append(rm);
      return row;
    }));
  };
  const add = (list) => { files = files.concat([...list]); render(); emit(zone, "nk:change", { files }); };
  input?.addEventListener("change", () => { add(input.files); input.value = ""; });
  ["dragenter", "dragover"].forEach((t) => zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.add("is-over"); }));
  ["dragleave", "drop"].forEach((t) => zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.remove("is-over"); }));
  zone.addEventListener("drop", (e) => add(e.dataTransfer.files));
}

/* ---- Split pane: drag the .nk-divider, or focus it and use the arrows.
   Keeps each pane at least data-min (px, default 120). ---- */
function enhanceSplit(box) {
  if (!once(box, "nkSplit")) return;
  const div = box.querySelector(".nk-divider");
  if (!div) return;
  const vertical = box.classList.contains("is-vertical");
  const min = Number(box.dataset.min) || 120;
  div.tabIndex = 0;
  div.setAttribute("role", "separator");
  div.setAttribute("aria-orientation", vertical ? "horizontal" : "vertical");
  const setPx = (px) => {
    const size = vertical ? box.clientHeight : box.clientWidth;
    px = Math.max(min, Math.min(size - min, px));
    box.style.setProperty("--split", `${px}px`);
    div.setAttribute("aria-valuenow", String(Math.round((px / size) * 100)));
  };
  const current = () => (vertical ? box.firstElementChild.getBoundingClientRect().height : box.firstElementChild.getBoundingClientRect().width);
  drag(div, { cls: "is-dragging", move: (e) => { const r = box.getBoundingClientRect(); setPx(vertical ? e.clientY - r.top : e.clientX - r.left); } });
  div.addEventListener("keydown", (e) => {
    const d = { ArrowLeft: -16, ArrowUp: -16, ArrowRight: 16, ArrowDown: 16 }[e.key];
    if (d) { e.preventDefault(); setPx(current() + d); }
  });
}

/* ---- Toast: NK.toast("ledger-api is unhealthy", "crit"). One plain
   sentence, newest nearest the corner, at most 3, 5 s, then a 160 ms fade. ---- */
export function toast(text, tone = "info", { host = document.body, ms = TOAST_MS } = {}) {
  let stack = host.querySelector(":scope > .nk-toast-stack");
  if (!stack) { stack = make("div", "nk-toast-stack"); host.append(stack); }
  const t = make("div", "nk-toast");
  t.setAttribute("role", "status");
  const led = make("span", "nk-led");
  led.dataset.tone = tone;
  t.append(led, make("span", "nk-toast-text", text));
  stack.prepend(t);
  while (stack.children.length > 3) stack.lastElementChild.remove();
  setTimeout(() => { t.classList.add("is-leaving"); setTimeout(() => t.remove(), 160); }, ms);
  return t;
}

/* ---- Scroll area: .nk-scroll marks which edges still have content past
   them (data-more-start / data-more-end); the CSS fades those edges. ---- */
const scrollSizes = new ResizeObserver((entries) => entries.forEach((e) => syncScroll(e.target.closest(".nk-scroll"))));
function syncScroll(box) {
  if (!box) return;
  const x = box.classList.contains("is-x");
  const pos = x ? Math.abs(box.scrollLeft) : box.scrollTop;
  const max = x ? box.scrollWidth - box.clientWidth : box.scrollHeight - box.clientHeight;
  box.toggleAttribute("data-more-start", pos > 1);
  box.toggleAttribute("data-more-end", pos < max - 1);
}
function enhanceScroll(box) {
  if (!once(box, "nkScroll")) return;
  box.addEventListener("scroll", () => syncScroll(box), { passive: true });
  scrollSizes.observe(box);
  for (const child of box.children) scrollSizes.observe(child);
  if (!box.hasAttribute("tabindex")) box.tabIndex = 0;   // a scroll region must be reachable by keyboard
  syncScroll(box);
}

/* A value control's shared plumbing: clamp, snap, wrap, format. */
function valueModel(el, { min = 0, max = 100, step = 1 } = {}) {
  const d = el.dataset;
  const m = { min: Number(d.min ?? min), max: Number(d.max ?? max), step: Number(d.step ?? step), unit: d.unit ?? "", wrap: d.wrap != null };
  m.span = m.max - m.min || 1;
  m.decimals = (String(m.step).split(".")[1] || "").length;
  m.def = Number(d.default ?? m.min);
  m.fit = (v) => {
    if (m.wrap) v = ((((v - m.min) % (m.span + m.step)) + (m.span + m.step)) % (m.span + m.step)) + m.min;
    v = Math.round((v - m.min) / m.step) * m.step + m.min;
    return Number(Math.min(m.max, Math.max(m.min, v)).toFixed(m.decimals));
  };
  m.fmt = (v) => `${v.toFixed(m.decimals)}${m.unit}`;
  return m;
}
function sliderAria(el, m, label) {
  el.setAttribute("role", "slider");
  if (!el.hasAttribute("tabindex")) el.tabIndex = 0;
  el.setAttribute("aria-valuemin", String(m.min));
  el.setAttribute("aria-valuemax", String(m.max));
  if (label && !el.hasAttribute("aria-label")) el.setAttribute("aria-label", label);
}

/* ---- Thumbwheel: <span class="nk-wheel" data-min data-max data-step
   data-value data-unit data-wrap>. Drag along it (Shift fine), scroll,
   arrows, Home/End; double-click returns to data-default. A full sweep of
   the range is 240px of drag, and the ridges travel exactly with it. ---- */
const WHEEL_SWEEP = 240;
function enhanceWheel(el) {
  if (!once(el, "nkWheel")) return;
  // without data-step: whole numbers over a wide range, hundredths over a narrow one
  const span = Number(el.dataset.max ?? 1) - Number(el.dataset.min ?? 0);
  const m = valueModel(el, { max: 1, step: Math.abs(span) >= 20 ? 1 : 0.01 });
  const vertical = el.classList.contains("is-vertical") || el.closest(".nk-wheel-unit.is-vertical") != null;
  if (vertical) el.setAttribute("aria-orientation", "vertical");
  sliderAria(el, m);
  const out = el.closest(".nk-wheel-unit")?.querySelector("output");
  let value = NaN;
  const set = (v, announce = true) => {
    v = m.fit(v);
    if (v === value) return;
    value = v;
    el.dataset.value = String(v);
    const px = ((v - m.min) / m.span) * WHEEL_SWEEP;
    el.style.setProperty("--pos", `${vertical ? -px : px}px`);
    el.dataset.at = m.wrap ? "" : v <= m.min ? "min" : v >= m.max ? "max" : "";
    el.setAttribute("aria-valuenow", String(v));
    el.setAttribute("aria-valuetext", m.fmt(v));
    if (out) out.textContent = m.fmt(v);
    if (announce) emit(el, "nk:change", { value: v });
  };
  set(Number(el.dataset.value ?? m.def), false);
  el.nkSet = (v) => set(Number(v), false);
  let base = null;   // re-anchored when Shift changes, so going fine never jumps
  drag(el, {
    start: (e) => { e.preventDefault(); el.focus({ preventScroll: true }); base = { d: 0, v: value, fine: 1 }; },
    move: (e, dx, dy) => {
      const d = vertical ? -dy : dx, fine = e.shiftKey ? 0.1 : 1;
      if (fine !== base.fine) base = { d, v: value, fine };
      set(base.v + ((d - base.d) * m.span / WHEEL_SWEEP) * fine);
    },
  });
  el.addEventListener("dblclick", () => !disabled(el) && set(m.def));
  el.addEventListener("wheel", (e) => { if (disabled(el)) return; e.preventDefault(); const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : -e.deltaY; set(value + Math.sign(d) * m.step * (e.shiftKey ? 1 : 5)); }, { passive: false });
  el.addEventListener("keydown", (e) => {
    if (disabled(el)) return;
    const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 }[e.key];
    if (d) { e.preventDefault(); set(value + d * m.step * (e.shiftKey ? 1 : 5)); }
    if (e.key === "Home") { e.preventDefault(); set(m.min); }
    if (e.key === "End") { e.preventDefault(); set(m.max); }
  });
}

/* ---- Angle dial: <span class="nk-angle" data-value="120">. 0° is up,
   clockwise. Drag to point it (Shift snaps to 15°), scroll for 1°,
   arrows for 15° (Shift 1°); double-click returns to data-default. ---- */
function enhanceAngle(el) {
  if (!once(el, "nkAngle")) return;
  const def = Number(el.dataset.default ?? 0);
  sliderAria(el, { min: 0, max: 359 }, "Angle");
  const notches = Array.from({ length: 8 }, (_, i) => { const n = make("span", `nk-angle-notch${i ? "" : " is-zero"}`); n.style.setProperty("--n", `${i * 45}deg`); return n; });
  el.replaceChildren(...notches, make("span", "nk-angle-cap"));
  const out = el.closest(".nk-angle-unit")?.querySelector("output");
  let value = NaN;
  const set = (v, announce = true) => {
    v = ((Math.round(v) % 360) + 360) % 360;
    if (v === value) return;
    value = v;
    el.dataset.value = String(v);
    el.style.setProperty("--a", `${v}deg`);
    el.setAttribute("aria-valuenow", String(v));
    el.setAttribute("aria-valuetext", `${v}°`);
    if (out) out.textContent = `${v}°`;
    if (announce) emit(el, "nk:change", { value: v });
  };
  set(Number(el.dataset.value ?? def), false);
  el.nkSet = (v) => set(Number(v), false);
  const point = (e) => {
    const r = el.getBoundingClientRect();
    let a = (Math.atan2(e.clientX - (r.left + r.width / 2), (r.top + r.height / 2) - e.clientY) * 180) / Math.PI;
    if (e.shiftKey) a = Math.round(a / 15) * 15;
    set(a);
  };
  drag(el, { start: (e) => { e.preventDefault(); el.focus({ preventScroll: true }); point(e); }, move: point });
  el.addEventListener("dblclick", () => !disabled(el) && set(def));
  el.addEventListener("wheel", (e) => { if (disabled(el)) return; e.preventDefault(); set(value + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 15 : 1)); }, { passive: false });
  el.addEventListener("keydown", (e) => {
    if (disabled(el)) return;
    const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    if (d) { e.preventDefault(); set(e.shiftKey ? value + d : Math.round(value / 15) * 15 + d * 15); }
    if (e.key === "Home") { e.preventDefault(); set(0); }
  });
}

/* ---- Scale: <div class="nk-scale" data-ticks="11" data-labels='["0","5","10"]'
   data-for="sliderId">. Ends and centre are majors (and every data-major-th
   tick); with data-for, ticks up to the slider's value light. ---- */
function enhanceScale(el) {
  if (!once(el, "nkScale")) return;
  const n = Math.max(2, Number(el.dataset.ticks) || 11);
  const every = Number(el.dataset.major) || 0;
  const labels = json(el.dataset.labels, []);
  const ticks = Array.from({ length: n }, (_, i) => {
    const major = i === 0 || i === n - 1 || (n % 2 && i === (n - 1) / 2) || (every && i % every === 0);
    const t = make("span", `nk-scale-tick${major ? " is-major" : ""}`);
    t.style.setProperty("--x", `${(i / (n - 1)) * 100}%`);
    return t;
  });
  const marks = labels.map((text, i) => { const l = make("span", "nk-scale-label", text); l.style.setProperty("--x", `${labels.length > 1 ? (i / (labels.length - 1)) * 100 : 50}%`); return l; });
  el.replaceChildren(...ticks, ...marks);
  el.setAttribute("aria-hidden", "true");
  const input = el.dataset.for && document.getElementById(el.dataset.for);
  if (!input) return;
  const sync = () => {
    const f = (Number(input.value) - Number(input.min || 0)) / ((Number(input.max || 100) - Number(input.min || 0)) || 1);
    ticks.forEach((t, i) => t.classList.toggle("is-on", i / (n - 1) <= f + 1e-6));
    marks.forEach((l, i) => l.classList.toggle("is-on", Math.abs((labels.length > 1 ? i / (labels.length - 1) : 0.5) - f) < 1e-6));
  };
  input.addEventListener("input", sync);
  sync();
}

/* ---- Knob frame: notches around a range knob over its 270° sweep, with
   end labels (data-from / data-to). Notches up to the value light. ---- */
function enhanceKnobFrame(frame) {
  if (!once(frame, "nkKnobFrame")) return;
  const knob = frame.querySelector(".nk-knob");
  const n = Math.max(2, Number(frame.dataset.ticks) || 11);
  const size = knob && getComputedStyle(knob).getPropertyValue("--knob-size").trim();
  if (size) frame.style.setProperty("--knob-size", size);
  const notches = Array.from({ length: n }, (_, i) => {
    const s = make("span", `nk-knob-notch${i === 0 || i === n - 1 || (n % 2 && i === (n - 1) / 2) ? " is-major" : ""}`);
    s.style.setProperty("--a", `${-135 + (270 * i) / (n - 1)}deg`);
    s.setAttribute("aria-hidden", "true");
    return s;
  });
  frame.prepend(...notches);
  for (const [key, cls] of [["from", "is-from"], ["to", "is-to"]]) if (frame.dataset[key] != null) frame.append(make("span", `nk-knob-end ${cls}`, frame.dataset[key]));
  if (!knob) return;
  const sync = () => {
    const min = Number(knob.dataset.min ?? 0), max = Number(knob.dataset.max ?? 100);
    const f = (Number(knob.dataset.value ?? min) - min) / ((max - min) || 1);
    notches.forEach((s, i) => s.classList.toggle("is-on", i / (n - 1) <= f + 1e-6));
  };
  knob.addEventListener("nk:change", sync);
  requestAnimationFrame(sync);
}

/* ---- Scrub field: <label class="nk-scrub" data-min data-max data-step>
   <span class="nk-scrub-label">…</span><input value="…"></label>. Drag the
   label sideways (Shift ×0.1, Ctrl ×10), or type; arrows step. A finite
   range sweeps in 200px. ---- */
function enhanceScrub(box) {
  if (!once(box, "nkScrub")) return;
  const input = box.querySelector("input");
  const label = box.querySelector(".nk-scrub-label");
  if (!input || !label) return;
  const d = box.dataset;
  const m = valueModel(box, { min: d.min != null ? 0 : -Infinity, max: d.max != null ? 100 : Infinity, step: 0.01 });
  const finite = Number.isFinite(m.min) && Number.isFinite(m.max);
  input.inputMode = "decimal";
  input.setAttribute("role", "spinbutton");
  if (finite) { input.setAttribute("aria-valuemin", String(m.min)); input.setAttribute("aria-valuemax", String(m.max)); }
  if (!input.hasAttribute("aria-label")) input.setAttribute("aria-label", label.textContent.trim());
  let value = NaN;
  const set = (v, announce = true) => {
    if (!Number.isFinite(v)) v = value;
    v = Number(Math.min(m.max, Math.max(m.min, Math.round(v / m.step) * m.step)).toFixed(m.decimals));
    const changed = v !== value;
    value = v;
    input.value = v.toFixed(m.decimals);
    input.setAttribute("aria-valuenow", String(v));
    if (finite) box.style.setProperty("--f", String((v - m.min) / m.span));
    if (changed && announce) { emit(box, "nk:change", { value: v }); input.dispatchEvent(new Event("change", { bubbles: true })); }
  };
  set(Number(input.value), false);
  box.nkSet = (v) => set(Number(v), false);
  let base = null;
  // A drag must not also focus the field (the <label> would): drag() swallows
  // the click that ends it; a plain click still focuses.
  drag(box, {
    handle: label, threshold: 3, cls: "is-scrubbing",
    start: (e) => { if (input.disabled) return false; e.preventDefault(); base = { d: 0, v: value, k: 1 }; },
    move: (e, dx) => {
      document.body.classList.add("nk-scrubbing");
      const k = e.shiftKey ? 0.1 : e.ctrlKey ? 10 : 1;
      if (k !== base.k) base = { d: dx, v: value, k };
      set(base.v + (dx - base.d) * (finite ? m.span / 200 : m.step) * k);
    },
    end: () => document.body.classList.remove("nk-scrubbing"),
  });
  input.addEventListener("change", (e) => { if (e.isTrusted) set(Number(input.value)); });
  input.addEventListener("keydown", (e) => {
    const k = { ArrowUp: 1, ArrowDown: -1 }[e.key];
    if (k) { e.preventDefault(); set(value + k * m.step * (e.shiftKey ? 0.1 : e.ctrlKey ? 10 : 1)); }
    if (e.key === "Enter") { set(Number(input.value)); input.select(); }
    if (e.key === "Escape") { input.value = value.toFixed(m.decimals); input.blur(); }
  });
}

/* ---- Tabs: .nk-tabs with role="tab" buttons (aria-controls → panel).
   Click or arrows select (Home/End jump); panels follow. ---- */
function enhanceTabs(box) {
  if (!once(box, "nkTabs")) return;
  const list = box.querySelector(".nk-tabs-list");
  if (!list) return;
  list.setAttribute("role", "tablist");
  const tabs = [...list.querySelectorAll(".nk-tab")];
  const choose = (tab, announce = true) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute("role", "tab");
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      const panel = t.getAttribute("aria-controls") && document.getElementById(t.getAttribute("aria-controls"));
      if (panel) { panel.setAttribute("role", "tabpanel"); panel.hidden = !on; panel.tabIndex = 0; if (t.id) panel.setAttribute("aria-labelledby", t.id); }
    }
    if (announce) emit(box, "nk:change", { value: tab.dataset.value ?? tab.getAttribute("aria-controls") ?? tabs.indexOf(tab) });
  };
  choose(tabs.find((t) => t.getAttribute("aria-selected") === "true") ?? tabs[0], false);
  list.addEventListener("click", (e) => { const t = e.target.closest(".nk-tab"); if (t && !t.disabled && t.getAttribute("aria-selected") !== "true") choose(t); });
  list.addEventListener("keydown", (e) => {
    const live = tabs.filter((t) => !t.disabled);
    const i = live.indexOf(document.activeElement);
    const j = i < 0 ? null : arrowIndex(e, i, live.length, { axis: "x", rtl: isRtl(list) });
    if (j == null) return;
    e.preventDefault();
    live[j].focus();
    choose(live[j]);
  });
  box.nkSet = (v) => { const t = tabs.find((t) => (t.dataset.value ?? t.getAttribute("aria-controls")) === v); if (t) choose(t, false); };
}

/* ---- Combobox: <label class="nk-input nk-combobox"><input list="id"></label>
   with a <datalist id>. Shows matching options in the kit's menu. ---- */
let comboId = 0;
function enhanceCombobox(box) {
  if (!once(box, "nkCombo")) return;
  const input = box.querySelector("input[list]");
  const source = input && document.getElementById(input.getAttribute("list"));
  if (!source) return;
  input.removeAttribute("list");          // the kit's menu replaces the browser's own
  input.autocomplete = "off";
  const id = `nk-combo-${++comboId}`;
  const menu = make("div", "nk-sel-menu");
  menu.id = `${id}-menu`;
  menu.popover = "manual";
  menu.setAttribute("role", "listbox");
  box.after(menu);   // in the tree beside its field (the top layer shows it anyway), so it leaves with it
  follow(menu, box);
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", menu.id);
  input.setAttribute("aria-expanded", "false");
  const strict = box.dataset.strict != null;
  let last = input.value, active = -1, items = [];
  const options = () => [...source.options].map((o) => ({ value: o.value, label: o.label && o.label !== o.value ? o.label : "" }));
  const highlight = (i) => {
    active = i;
    items.forEach((el, j) => el.toggleAttribute("data-highlighted", j === i));
    if (items[i]) { input.setAttribute("aria-activedescendant", items[i].id); items[i].scrollIntoView({ block: "nearest" }); }
    else input.removeAttribute("aria-activedescendant");
  };
  const mark = (text, q) => {
    const span = make("span", "nk-sel-item-label");
    const at = q ? text.toLowerCase().indexOf(q) : -1;
    if (at < 0) span.textContent = text;
    else span.append(text.slice(0, at), make("mark", "", text.slice(at, at + q.length)), text.slice(at + q.length));
    return span;
  };
  const render = () => {
    const q = input.value.trim().toLowerCase();
    const found = options().filter((o) => !q || o.value.toLowerCase().includes(q) || o.label.toLowerCase().includes(q));
    items = found.map((o, i) => {
      const item = make("div", "nk-sel-item");
      item.id = `${id}-o${i}`;
      item.setAttribute("role", "option");
      item.dataset.value = o.value;
      if (o.value === input.value) item.setAttribute("data-selected", "");
      if (o.label) { item.classList.add("is-two-line"); const t = make("span", "nk-sel-item-text"); t.append(mark(o.value, q), make("span", "nk-sel-item-desc", o.label)); item.append(t); }
      else item.append(mark(o.value, q));
      item.append(pathIcon(CHECK, "nk-sel-check"));
      return item;
    });
    menu.replaceChildren(...(items.length ? items : [make("div", "nk-sel-empty", strict ? "Nothing matches" : "No match — Enter keeps what you typed")]));
    highlight(items.length && q ? 0 : -1);
  };
  const open = () => {
    render();
    if (!menu.matches(":popover-open")) menu.showPopover();
    box.dataset.state = "open";
    input.setAttribute("aria-expanded", "true");
    place(menu, box);
  };
  const close = () => {
    if (menu.matches(":popover-open")) menu.hidePopover();
    box.dataset.state = "closed";
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  };
  const commit = (v) => {
    const known = options().some((o) => o.value === v);
    if (strict && !known) v = last;
    input.value = v;
    if (v !== last) { last = v; input.dispatchEvent(new Event("change", { bubbles: true })); emit(input, "nk:change", { value: v }); }
    close();
  };
  box.nkSet = (v) => { input.value = last = String(v ?? ""); };
  input.addEventListener("focus", open);
  input.addEventListener("input", open);
  input.addEventListener("blur", () => commit(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!menu.matches(":popover-open")) return open();
      if (items.length) highlight((active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length);
    } else if (e.key === "Enter") {
      if (menu.matches(":popover-open")) { e.preventDefault(); commit(items[active]?.dataset.value ?? input.value); }
    } else if (e.key === "Escape") {
      if (menu.matches(":popover-open")) { e.preventDefault(); close(); }
    }
  });
  menu.addEventListener("pointerdown", (e) => e.preventDefault());   // keep focus in the field
  menu.addEventListener("click", (e) => { const item = e.target.closest(".nk-sel-item"); if (item) commit(item.dataset.value); });
  menu.addEventListener("pointermove", (e) => { const item = e.target.closest(".nk-sel-item"); if (item) highlight(items.indexOf(item)); });
}

/* ---- Command palette: dialog.nk-command, opened by [data-command="id"]
   or Ctrl/⌘ + data-hotkey. Filters as you type; Enter runs. ---- */
function enhanceCommand(d) {
  if (!once(d, "nkCommand")) return;
  const input = d.querySelector(".nk-command-search input");
  const list = d.querySelector(".nk-command-list");
  if (!input || !list) return;
  const all = () => [...list.querySelectorAll(".nk-command-item")];
  for (const item of all()) { item.tabIndex = -1; item.dataset.text ??= item.querySelector("span")?.textContent.trim() ?? item.textContent.trim(); }
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "true");
  list.setAttribute("role", "listbox");
  const empty = make("div", "nk-command-empty", "No command matches");
  empty.hidden = true;
  list.append(empty);
  let active = null;
  const highlight = (item) => {
    active = item;
    for (const el of all()) el.toggleAttribute("data-highlighted", el === item);
    item?.scrollIntoView({ block: "nearest" });
  };
  const visible = () => all().filter((el) => !el.hidden);
  const filter = () => {
    const q = input.value.trim().toLowerCase();
    for (const item of all()) {
      const text = item.dataset.text, at = q ? text.toLowerCase().indexOf(q) : -1;
      item.hidden = q !== "" && at < 0 && !(item.dataset.keywords ?? "").toLowerCase().includes(q);
      const span = item.querySelector("span");
      if (span) { span.textContent = ""; if (at < 0) span.textContent = text; else span.append(text.slice(0, at), make("mark", "", text.slice(at, at + q.length)), text.slice(at + q.length)); }
    }
    // a group heading hides when nothing under it is left
    let group = null, any = false;
    for (const el of list.children) {
      if (el.classList.contains("nk-command-group")) { if (group) group.hidden = !any; group = el; any = false; }
      else if (el.classList.contains("nk-command-item") && !el.hidden) any = true;
    }
    if (group) group.hidden = !any;
    empty.hidden = visible().length > 0;
    highlight(visible()[0] ?? null);
  };
  const run = (item) => { if (!item) return; d.close(); emit(item, "nk:confirm", { action: item.dataset.action ?? item.dataset.text }); };
  d.addEventListener("toggle", (e) => { if (e.newState === "open") { input.value = ""; filter(); input.focus(); } });
  input.addEventListener("input", filter);
  input.addEventListener("keydown", (e) => {
    const v = visible(), i = v.indexOf(active);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (v.length) highlight(v[(i + (e.key === "ArrowDown" ? 1 : -1) + v.length) % v.length]); }
    if (e.key === "Enter") { e.preventDefault(); run(active); }
  });
  list.addEventListener("pointermove", (e) => { const item = e.target.closest(".nk-command-item"); if (item && item !== active) highlight(item); });
  list.addEventListener("click", (e) => run(e.target.closest(".nk-command-item")));
  d.addEventListener("click", (e) => { if (e.target === d) d.close(); });   // the backdrop
  if (d.dataset.hotkey) {
    const key = d.dataset.hotkey.toLowerCase();
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === key) { e.preventDefault(); d.open ? d.close() : d.showModal(); }
    });
  }
}
function enhanceCommandTrigger(btn) {
  if (!once(btn, "nkCommandBtn")) return;
  btn.addEventListener("click", () => document.getElementById(btn.dataset.command)?.showModal());
}

/* ---- Context menu: [data-context-menu="id"] opens that .nk-menu at the
   pointer on right-click (or the menu key / Shift+F10, beside the element).
   Items emit nk:confirm with data-action and the element in detail.target. ---- */
function enhanceContextMenu(area) {
  if (!once(area, "nkContext")) return;
  const menu = document.getElementById(area.dataset.contextMenu);
  if (!menu) return;
  // Manual, not auto: on Linux and macOS the menu opens on mouse-down, and
  // the browser's light dismiss would close it again on the mouse-up.
  menu.popover = "manual";
  menu.setAttribute("role", "menu");
  for (const item of menu.querySelectorAll(".nk-menu-item")) item.setAttribute("role", "menuitem");
  area.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    menu.nkTarget = area;
    if (!menu.matches(":popover-open")) { menu.nkReturn = document.activeElement; menu.showPopover(); }   // re-aiming an open menu keeps where focus came from
    const r = area.getBoundingClientRect(), b = menu.getBoundingClientRect();
    const x = e.clientX || r.left + 12, y = e.clientY || r.top + 12;   // keyboard-opened menus have no pointer
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - b.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, innerHeight - b.height - 8))}px`;
    menu.querySelector(".nk-menu-item:not(:disabled)")?.focus();
  });
  if (!once(menu, "nkContextMenu")) return;
  const close = () => { if (menu.matches(":popover-open")) menu.hidePopover(); };
  const outside = (e) => { if (!menu.contains(e.target)) close(); };
  menu.addEventListener("toggle", (e) => {
    const open = e.newState === "open";
    for (const [t, type, fn, opt] of [[document, "pointerdown", outside, true], [window, "blur", close], [window, "resize", close], [document, "scroll", close, true]]) (open ? t.addEventListener : t.removeEventListener).call(t, type, fn, opt);
    if (!open) menu.nkReturn?.focus?.({ preventScroll: true });
  });
  menu.addEventListener("keydown", (e) => { if (!menuKeys(menu, e) && (e.key === "Escape" || e.key === "Tab")) { e.preventDefault(); close(); } });
  menu.addEventListener("click", (e) => {
    const item = e.target.closest(".nk-menu-item");
    if (!item || item.disabled) return;
    emit(item, "nk:confirm", { action: item.dataset.action ?? item.textContent.trim(), target: menu.nkTarget });
    close();
  });
}

/* ---- Dynamic buttons: data-icon adds that icon (it slides in on hover), with
   a motion that suits it unless data-motion says otherwise. A danger button
   without an icon gets the bin. ---- */
const ICON_MOTION = { trash: "shake", refresh: "spin", settings: "spin", "arrow-right": "nudge", "arrow-up": "lift", send: "nudge", external: "nudge", play: "nudge", plus: "pop", check: "pop", copy: "pop", download: "drop", upload: "lift" };
function enhanceButton(btn) {
  if (!once(btn, "nkButton")) return;
  const name = btn.dataset.icon || (btn.classList.contains("is-danger") ? "trash" : "");
  if (!name || btn.querySelector(":scope > .nk-button-icon")) return;
  btn.prepend(icon(name, "nk-button-icon"));
  if (!btn.dataset.motion) btn.dataset.motion = ICON_MOTION[name] ?? "pop";
}

/* ---- Input group: the clear button empties its field and hands focus back. ---- */
function enhanceInputClear(btn) {
  if (!once(btn, "nkClear")) return;
  btn.type = "button";
  btn.addEventListener("click", () => {
    const input = btn.closest(".nk-input")?.querySelector("input");
    if (!input) return;
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  });
}

/* ---- Toolbar: one Tab stop, arrows move between its controls. ---- */
function enhanceToolbar(bar) {
  if (!once(bar, "nkToolbar")) return;
  bar.setAttribute("role", "toolbar");
  const controls = () => [...bar.querySelectorAll("button, [role='slider'], input, select")].filter((el) => !el.disabled && el.closest(".nk-toolbar") === bar && !el.closest("[popover]"));
  const rove = (to) => controls().forEach((el) => { el.tabIndex = el === to ? 0 : -1; });
  rove(controls()[0]);
  bar.addEventListener("focusin", (e) => { if (controls().includes(e.target)) rove(e.target); });
  bar.addEventListener("keydown", (e) => {
    // controls that use the arrows themselves keep them
    if (e.target.matches("input, select, [role='slider'], .nk-segmented-btn, .nk-choice *")) return;
    const list = controls(), i = list.indexOf(e.target);
    const j = i < 0 ? null : arrowIndex(e, i, list.length, { axis: "x", rtl: isRtl(bar) });
    if (j == null) return;
    e.preventDefault();
    list[j].focus();
  });
}

/* ---- Colour maths: HSV ⇄ hex (and RGB, below). ---- */
const hsvToHex = (h, s, v) => {
  const f = (n) => { const k = (n + h / 60) % 6; return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)))); };
  return `#${[f(5), f(3), f(1)].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
};
const hexToHsv = (hex) => {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let x = m[1]; if (x.length === 3) x = [...x].map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  const h = d === 0 ? 0 : max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return { h: (h + 360) % 360, s: max ? d / max : 0, v: max };
};
/* ---- Colour picker: <div class="nk-colour" data-value="#e54866">, with
   data-was (the "was" lens, default the first value) and data-mode="rgb".
   Hue is a dial of lamps, saturation/brightness a window in its cap; the
   readings (was/now, hex, HSB | RGB, scrubs) sit beside it, or under it with
   .is-compact. Only the hex leaves, as nk:change; el.nkSet(hex) moves it. ---- */
const LAMPS = 48;
const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const rgbToHex = (r, g, b) => `#${[r, g, b].map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0")).join("")}`;
function enhanceColour(box) {
  if (!once(box, "nkColour")) return;
  let c = hexToHsv(box.dataset.value ?? "#e54866") ?? { h: 348, s: 0.69, v: 0.9 };
  let was = hexToHsv(box.dataset.was ?? "") ? box.dataset.was.toLowerCase() : hsvToHex(c.h, c.s, c.v);
  let mode = box.dataset.mode === "rgb" ? "rgb" : "hsb";

  // the dial: a bezel of lamps, the hue thumb, the cap with its window
  const dial = make("div", "nk-colour-dial"), cap = make("div", "nk-colour-cap");
  const area = make("div", "nk-colour-area"), at = make("span", "nk-colour-thumb"), rt = make("span", "nk-colour-ring-thumb");
  const lamps = Array.from({ length: LAMPS }, (_, i) => {
    const l = make("i", "nk-colour-lamp");
    l.style.setProperty("--a", `${(i * 360) / LAMPS}deg`); l.style.setProperty("--lh", String((i * 360) / LAMPS));
    return l;
  });
  area.append(at); cap.append(area); dial.append(...lamps, rt, cap);
  dial.tabIndex = area.tabIndex = 0;
  dial.setAttribute("role", "slider"); dial.setAttribute("aria-label", "Hue"); dial.setAttribute("aria-valuemin", "0"); dial.setAttribute("aria-valuemax", "359");
  area.setAttribute("role", "slider"); area.setAttribute("aria-label", "Saturation and brightness");

  // the readings
  const readings = make("div", "nk-colour-readings");
  const lensBox = make("div", "nk-colour-lenses"), wasLens = make("button", "nk-colour-lens"), nowLens = make("span", "nk-colour-lens");
  wasLens.type = "button"; wasLens.append(make("span", "", "WAS")); nowLens.append(make("span", "", "NOW"));
  nowLens.setAttribute("role", "img");
  lensBox.append(wasLens, nowLens);
  const row = make("div", "nk-colour-row"), field = make("label", "nk-input is-small"), hex = make("input");
  hex.spellcheck = false; hex.setAttribute("aria-label", "Hex colour"); hex.maxLength = 7;
  field.append(hex); row.append(field);
  if ("EyeDropper" in window) {
    const drop = make("button", "nk-icon-button");
    drop.type = "button"; drop.setAttribute("aria-label", "Pick a colour from the screen"); drop.dataset.tooltip = "Pick from the screen";
    drop.append(icon("pipette"));
    drop.addEventListener("click", async () => { try { const r = await new window.EyeDropper().open(); const n = hexToHsv(r.sRGBHex); if (n) { c = n; paint(); } } catch {} });
    row.append(drop);
  }
  const modes = make("div", "nk-choice");
  modes.setAttribute("role", "radiogroup"); modes.setAttribute("aria-label", "Channels");
  for (const [v, label] of [["hsb", "HSB"], ["rgb", "RGB"]]) {
    const b = make("button", "nk-choice-btn", label);
    b.type = "button"; b.setAttribute("role", "radio"); b.dataset.value = v;
    b.setAttribute("aria-checked", String(v === mode)); b.tabIndex = v === mode ? 0 : -1;
    modes.append(b);
  }
  const scrubSet = (name, chans) => {
    const set = make("div", "nk-colour-scrubs");
    set.dataset.mode = name;
    const fields = chans.map(([key, label, max]) => {
      const s = make("label", "nk-scrub");
      s.dataset.min = "0"; s.dataset.max = String(max); s.dataset.step = "1"; s.dataset.chan = key;
      const input = make("input"), track = make("i", "nk-colour-track");
      s.append(make("span", "nk-scrub-label", label), input, track);
      set.append(s);
      return s;
    });
    return { set, fields };
  };
  const hsb = scrubSet("hsb", [["h", "Hue", 359], ["s", "Saturation", 100], ["b", "Brightness", 100]]);
  const rgb = scrubSet("rgb", [["r", "Red", 255], ["g", "Green", 255], ["bl", "Blue", 255]]);
  readings.append(lensBox, row, modes, hsb.set, rgb.set);
  box.replaceChildren(dial, readings);
  enhance(readings);   // the choice and the scrubs are kit parts too

  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const showMode = () => { hsb.set.hidden = mode !== "hsb"; rgb.set.hidden = mode !== "rgb"; };
  const paint = (announce = true, typed = false) => {
    const value = hsvToHex(c.h, c.s, c.v), pure = `hsl(${c.h.toFixed(1)} 100% 50%)`;
    box.dataset.value = value;
    // the ring: the lamps nearest the hue light, the thumb rides to it
    const at_ = (c.h / 360) * LAMPS;
    lamps.forEach((l, i) => { const d = Math.min(Math.abs(i - at_), LAMPS - Math.abs(i - at_)); l.style.setProperty("--lit", Math.max(0, 1 - d / 3.2).toFixed(3)); });
    dial.style.setProperty("--hue-a", `${c.h}deg`);
    rt.style.setProperty("--c", pure);
    area.style.setProperty("--h", c.h.toFixed(1));
    at.style.setProperty("--x", c.s); at.style.setProperty("--y", 1 - c.v); at.style.setProperty("--c", value);
    nowLens.style.setProperty("--c", value); nowLens.setAttribute("aria-label", `Now ${value}`);
    wasLens.style.setProperty("--c", was); wasLens.setAttribute("aria-label", `Go back to ${was}`);
    if (!typed) hex.value = value;
    // the readings, and what each channel does at this colour
    const [r, g, b] = hexToRgb(value);
    const H = Math.round(c.h) % 360, S = Math.round(c.s * 100), B = Math.round(c.v * 100);
    hsb.fields[0].nkSet?.(H); hsb.fields[1].nkSet?.(S); hsb.fields[2].nkSet?.(B);
    rgb.fields[0].nkSet?.(r); rgb.fields[1].nkSet?.(g); rgb.fields[2].nkSet?.(b);
    const track = (f, bg) => f.style.setProperty("--track-c", bg);
    track(hsb.fields[0], `linear-gradient(90deg, ${[0, 60, 120, 180, 240, 300, 360].map((x) => `hsl(${x} 90% 55%)`).join(", ")})`);
    track(hsb.fields[1], `linear-gradient(90deg, ${hsvToHex(c.h, 0, c.v)}, ${hsvToHex(c.h, 1, c.v)})`);
    track(hsb.fields[2], `linear-gradient(90deg, #000, ${hsvToHex(c.h, c.s, 1)})`);
    track(rgb.fields[0], `linear-gradient(90deg, ${rgbToHex(0, g, b)}, ${rgbToHex(255, g, b)})`);
    track(rgb.fields[1], `linear-gradient(90deg, ${rgbToHex(r, 0, b)}, ${rgbToHex(r, 255, b)})`);
    track(rgb.fields[2], `linear-gradient(90deg, ${rgbToHex(r, g, 0)}, ${rgbToHex(r, g, 255)})`);
    dial.setAttribute("aria-valuenow", String(H)); dial.setAttribute("aria-valuetext", `hue ${H}°`);
    area.setAttribute("aria-valuetext", `saturation ${S}%, brightness ${B}%`);
    if (announce) emit(box, "nk:change", { value });
  };

  // the ring: drag it (not the cap), scroll it, or arrows when focused
  const hueAt = (e) => { const r = dial.getBoundingClientRect(); return (Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180 / Math.PI + 360) % 360; };
  drag(dial, {
    start: (e) => {
      if (e.target.closest(".nk-colour-cap")) return false;
      dial.focus({ preventScroll: true }); c.h = hueAt(e); paint();
    },
    move: (e) => { c.h = hueAt(e); paint(); },
  });
  dial.addEventListener("wheel", (e) => { e.preventDefault(); c.h = (c.h + Math.sign(e.deltaY || e.deltaX) * (e.shiftKey ? 15 : 2) + 360) % 360; paint(); }, { passive: false });
  dial.addEventListener("keydown", (e) => {
    if (e.target !== dial) return;
    const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 30, PageDown: -30 }[e.key];
    if (d == null) return;
    e.preventDefault(); c.h = (c.h + d * (e.shiftKey && Math.abs(d) === 1 ? 15 : 1) + 360) % 360; paint();
  });
  // the window
  drag(area, {
    cls: "is-dragging",
    start: (e) => { area.focus({ preventScroll: true }); pickSV(e); },
    move: (e) => pickSV(e),
  });
  const pickSV = (e) => { const r = area.getBoundingClientRect(); c.s = clamp01((e.clientX - r.left) / r.width); c.v = 1 - clamp01((e.clientY - r.top) / r.height); paint(); };
  area.addEventListener("keydown", (e) => {
    const k = e.shiftKey ? 0.1 : 0.01;
    const d = { ArrowLeft: [-k, 0], ArrowRight: [k, 0], ArrowUp: [0, k], ArrowDown: [0, -k] }[e.key];
    if (d) { e.preventDefault(); e.stopPropagation(); c.s = clamp01(c.s + d[0]); c.v = clamp01(c.v + d[1]); paint(); }
  });
  // the readings speak to the colour; their own events stop here
  wasLens.addEventListener("click", () => { const n = hexToHsv(was); if (n) { c = n; paint(); } });
  hex.addEventListener("input", () => { const n = hexToHsv(hex.value); if (n && hex.value.replace("#", "").length >= 6) { c = n; paint(true, true); } });
  hex.addEventListener("change", () => paint(false));
  readings.addEventListener("nk:change", (e) => {
    e.stopPropagation();
    if (e.target === modes) { mode = e.detail.value; box.dataset.mode = mode; showMode(); return; }
    const chan = e.target.dataset?.chan, v = Number(e.detail.value);
    if (!chan || !Number.isFinite(v)) return;
    if (chan === "h") c.h = v; else if (chan === "s") c.s = v / 100; else if (chan === "b") c.v = v / 100;
    else {
      const [r, g, b] = hexToRgb(hsvToHex(c.h, c.s, c.v));
      const n = hexToHsv(rgbToHex(chan === "r" ? v : r, chan === "g" ? v : g, chan === "bl" ? v : b));
      if (n) { if (n.s === 0 || n.v === 0) n.h = c.h; c = n; }   // grey has no hue: keep the one we had
    }
    paint();
  });
  box.nkSet = (v) => { const n = hexToHsv(String(v)); if (n) { c = n; paint(false); } };
  showMode();
  paint(false);
}

/* ---- Calendar: .nk-calendar data-value="2026-09-27" (or data-mode="range"
   with data-from / data-to), data-min / data-max, data-week-start (0 = Sunday,
   default 1). Values are ISO dates; nk:change carries { value } or
   { from, to }. ---- */
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseIso = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? ""); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
function enhanceCalendar(cal) {
  if (!once(cal, "nkCalendar")) return;
  const range = cal.dataset.mode === "range";
  const weekStart = Number(cal.dataset.weekStart ?? 1);
  const min = parseIso(cal.dataset.min), max = parseIso(cal.dataset.max);
  const locale = cal.dataset.locale || document.documentElement.lang || undefined;
  let value = parseIso(cal.dataset.value), from = parseIso(cal.dataset.from), to = parseIso(cal.dataset.to);
  let focus = value ?? from ?? new Date();
  let view = new Date(focus.getFullYear(), focus.getMonth(), 1);
  const head = make("div", "nk-cal-head"), title = make("span", "nk-cal-title");
  title.setAttribute("aria-live", "polite");
  const prev = make("button", "nk-cal-nav"), next = make("button", "nk-cal-nav is-next");
  prev.type = next.type = "button";
  prev.setAttribute("aria-label", "Previous month"); next.setAttribute("aria-label", "Next month");
  head.append(title, prev, next);
  const grid = make("div", "nk-cal-grid");
  grid.setAttribute("role", "grid");
  cal.replaceChildren(head, grid);
  const names = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale, { weekday: "narrow" }).format(new Date(2024, 0, 7 + ((i + weekStart) % 7))));
  const out = (d) => (min && d < min) || (max && d > max);
  const same = (a, b) => a && b && a.getTime() === b.getTime();
  const render = () => {
    title.textContent = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(view);
    const first = addDays(view, -((view.getDay() - weekStart + 7) % 7));
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const cells = names.map((n) => { const c = make("span", "nk-cal-wd", n); c.setAttribute("aria-hidden", "true"); return c; });
    for (let i = 0; i < 42; i++) {
      const d = addDays(first, i), b = make("button", "nk-cal-day", String(d.getDate()));
      b.type = "button";
      b.dataset.date = iso(d);
      b.tabIndex = same(d, focus) ? 0 : -1;
      b.disabled = !!out(d);
      b.setAttribute("aria-label", new Intl.DateTimeFormat(locale, { dateStyle: "full" }).format(d));
      if (d.getMonth() !== view.getMonth()) b.classList.add("is-other");
      if (same(d, today)) { b.classList.add("is-today"); b.setAttribute("aria-current", "date"); }
      const chosen = range ? same(d, from) || same(d, to) : same(d, value);
      b.setAttribute("aria-selected", String(!!chosen));
      if (range && from && to && d > from && d < to) b.classList.add("is-in");
      cells.push(b);
    }
    grid.replaceChildren(...cells);
  };
  const moveTo = (d, keepFocus = true) => {
    if (out(d)) return;
    focus = d;
    if (d.getMonth() !== view.getMonth() || d.getFullYear() !== view.getFullYear()) view = new Date(d.getFullYear(), d.getMonth(), 1);
    render();
    if (keepFocus) grid.querySelector(`[data-date="${iso(d)}"]`)?.focus();
  };
  const choose = (d) => {
    if (range) {
      if (!from || to || d < from) { from = d; to = null; } else to = d;
      cal.dataset.from = from ? iso(from) : ""; cal.dataset.to = to ? iso(to) : "";
      focus = d; render(); grid.querySelector(`[data-date="${iso(d)}"]`)?.focus();
      if (to) emit(cal, "nk:change", { from: iso(from), to: iso(to) });
    } else {
      value = d; cal.dataset.value = iso(d); focus = d; render();
      grid.querySelector(`[data-date="${iso(d)}"]`)?.focus();
      emit(cal, "nk:change", { value: iso(d) });
    }
  };
  prev.addEventListener("click", () => { view = new Date(view.getFullYear(), view.getMonth() - 1, 1); render(); });
  next.addEventListener("click", () => { view = new Date(view.getFullYear(), view.getMonth() + 1, 1); render(); });
  grid.addEventListener("click", (e) => { const b = e.target.closest(".nk-cal-day"); if (b && !b.disabled) choose(parseIso(b.dataset.date)); });
  grid.addEventListener("keydown", (e) => {
    const rtl = isRtl(cal);
    const d = { ArrowLeft: rtl ? 1 : -1, ArrowRight: rtl ? -1 : 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    let t = null;
    if (d) t = addDays(focus, d);
    else if (e.key === "PageUp" || e.key === "PageDown") { const k = e.key === "PageUp" ? -1 : 1; t = new Date(focus.getFullYear() + (e.shiftKey ? k : 0), focus.getMonth() + (e.shiftKey ? 0 : k), Math.min(focus.getDate(), 28)); }
    else if (e.key === "Home") t = addDays(focus, -((focus.getDay() - weekStart + 7) % 7));
    else if (e.key === "End") t = addDays(focus, 6 - ((focus.getDay() - weekStart + 7) % 7));
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); return choose(focus); }
    if (t) { e.preventDefault(); moveTo(t); }
  });
  cal.nkSet = (v) => {
    if (range) { from = parseIso(v?.from); to = parseIso(v?.to); focus = from ?? focus; }
    else { value = parseIso(v); focus = value ?? focus; }
    view = new Date(focus.getFullYear(), focus.getMonth(), 1);
    render();
  };
  render();
}

/* ---- Date picker: <label class="nk-input nk-datepicker"><input value="2026-09-27"></label>.
   A calendar button opens a calendar under the field; the field stays
   typeable (ISO). ---- */
function enhanceDatepicker(box) {
  if (!once(box, "nkDatepicker")) return;
  const input = box.querySelector("input");
  if (!input) return;
  input.placeholder ||= "YYYY-MM-DD";
  input.autocomplete = "off";
  const btn = make("button", "nk-datepicker-btn");
  btn.type = "button";
  btn.setAttribute("aria-label", "Choose a date");
  btn.setAttribute("aria-haspopup", "dialog");
  btn.innerHTML = '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>';
  box.append(btn);
  const pop = make("div", "nk-datepicker-pop");
  pop.popover = "auto";
  const cal = make("div", "nk-calendar");
  for (const k of ["min", "max", "weekStart", "locale"]) if (box.dataset[k]) cal.dataset[k] = box.dataset[k];
  cal.dataset.value = input.value;
  pop.append(cal);
  box.after(pop);
  anchorTo(pop, box);
  enhanceCalendar(cal);
  btn.addEventListener("click", () => {
    if (pop.matches(":popover-open")) return pop.hidePopover();
    cal.nkSet(input.value);
    pop.showPopover();
    (cal.querySelector('.nk-cal-day[tabindex="0"]'))?.focus();
  });
  cal.addEventListener("nk:change", (e) => {
    e.stopPropagation();
    input.value = e.detail.value;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    emit(box, "nk:change", { value: input.value });
    pop.hidePopover();
    input.focus();
  });
  pop.addEventListener("keydown", (e) => { if (e.key === "Escape") { pop.hidePopover(); btn.focus(); } });
  input.addEventListener("change", (e) => {
    if (!e.isTrusted) return;
    const ok = !input.value || parseIso(input.value);
    box.classList.toggle("has-error", !ok);
    if (ok) emit(box, "nk:change", { value: input.value });
  });
  box.nkSet = (v) => { input.value = v ?? ""; box.classList.remove("has-error"); };
}

/* ---- Range slider: .nk-range with two input[type=range]. Keeps them from
   crossing, paints the travel between, fills a sibling <output>. ---- */
function enhanceRange(box) {
  if (!once(box, "nkRange")) return;
  const [lo, hi] = box.querySelectorAll("input[type=range]");
  if (!lo || !hi) return;
  const out = box.parentElement?.querySelector("output");
  const unit = box.dataset.unit ?? "";
  const min = Number(lo.min || 0), max = Number(lo.max || 100), span = max - min || 1;
  const sync = (moved) => {
    if (Number(lo.value) > Number(hi.value)) { if (moved === lo) lo.value = hi.value; else hi.value = lo.value; }
    box.style.setProperty("--lo", String(((lo.value - min) / span) * 100));
    box.style.setProperty("--hi", String(((hi.value - min) / span) * 100));
    // the upper thumb sits on top unless both are at the top end
    hi.style.zIndex = Number(hi.value) >= max && Number(lo.value) >= max ? "0" : "1";
    if (out) out.textContent = `${lo.value}–${hi.value}${unit}`;
  };
  for (const input of [lo, hi]) {
    input.addEventListener("input", () => { sync(input); emit(box, "nk:change", { value: [Number(lo.value), Number(hi.value)] }); });
  }
  box.nkSet = (v) => { if (Array.isArray(v)) { lo.value = v[0]; hi.value = v[1]; sync(); } };
  sync();
}

/* ---- One-time code: .nk-otp data-length="6" (data-group="3" puts a
   separator every 3). Emits nk:change as it fills, nk:confirm when full. ---- */
function enhanceOtp(box) {
  if (!once(box, "nkOtp")) return;
  const n = Number(box.dataset.length) || 6, group = Number(box.dataset.group) || (n === 6 ? 3 : 0);
  const name = box.getAttribute("aria-label") || "Code";
  box.setAttribute("role", "group");
  const cells = Array.from({ length: n }, (_, i) => {
    const c = make("input");
    c.inputMode = box.dataset.alpha != null ? "text" : "numeric";
    // no maxLength: autofill drops the whole code into the first cell, and fill() spreads it
    c.autocomplete = i ? "off" : "one-time-code";
    c.setAttribute("aria-label", `${name}, character ${i + 1} of ${n}`);
    return c;
  });
  const parts = [];
  cells.forEach((c, i) => { if (group && i && i % group === 0) { const s = make("span", "nk-otp-sep"); s.setAttribute("aria-hidden", "true"); parts.push(s); } parts.push(c); });
  box.replaceChildren(...parts);
  const ok = (ch) => (box.dataset.alpha != null ? /^[0-9a-z]$/i.test(ch) : /^\d$/.test(ch));
  const code = () => cells.map((c) => c.value).join("");
  const report = () => {
    const v = code();
    box.dataset.value = v;
    box.classList.remove("has-error");
    emit(box, "nk:change", { value: v });
    if (v.length === n) emit(box, "nk:confirm", { action: v });
  };
  const fill = (from, text) => {
    const chars = [...text].filter(ok).slice(0, n - from);
    chars.forEach((ch, k) => { cells[from + k].value = ch; });
    cells[Math.min(n - 1, from + chars.length)].focus();
    if (chars.length) report();
  };
  cells.forEach((c, i) => {
    c.addEventListener("input", () => { const v = c.value; c.value = ""; fill(i, v); });
    c.addEventListener("paste", (e) => { e.preventDefault(); fill(i, e.clipboardData.getData("text")); });
    c.addEventListener("focus", () => c.select());
    c.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !c.value && i) { e.preventDefault(); cells[i - 1].value = ""; cells[i - 1].focus(); report(); }
      const j = arrowIndex(e, i, n, { axis: "x", rtl: isRtl(box), loop: false });
      if (j != null && e.key !== "Home" && e.key !== "End") { e.preventDefault(); cells[j].focus(); }
    });
  });
  box.nkSet = (v) => { cells.forEach((c, i) => { c.value = String(v ?? "")[i] ?? ""; }); box.dataset.value = code(); };
}

/* ---- Password reveal: a .nk-input-reveal button in an .nk-input shows and
   hides the password beside it. ---- */
function enhanceReveal(btn) {
  if (!once(btn, "nkReveal")) return;
  const input = btn.closest(".nk-input")?.querySelector("input");
  if (!input) return;
  btn.type = "button";
  btn.setAttribute("aria-pressed", "false");
  btn.setAttribute("aria-label", btn.getAttribute("aria-label") || "Show password");
  if (!btn.firstElementChild) btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path class="nk-reveal-slash" d="M4 4l16 16"/></svg>';
  btn.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    btn.setAttribute("aria-pressed", String(show));
    btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
    input.focus();
  });
}

/* ---- Tag input: .nk-taginput with an <input>; data-value='["a","b"]',
   data-name for a hidden form field. ---- */
function enhanceTagInput(box) {
  if (!once(box, "nkTags")) return;
  const input = box.querySelector("input:not([type=hidden])");
  if (!input) return;
  let tags = json(box.dataset.value, []);
  const hidden = box.dataset.name ? Object.assign(make("input"), { type: "hidden", name: box.dataset.name }) : null;
  if (hidden) box.append(hidden);
  box.setAttribute("role", "group");
  const render = (announce = true) => {
    box.querySelectorAll(".nk-taginput-tag").forEach((t) => t.remove());
    for (const [i, t] of tags.entries()) {
      const chip = make("span", "nk-taginput-tag", t);
      const x = make("button");
      x.type = "button";
      x.tabIndex = -1;
      x.setAttribute("aria-label", `Remove ${t}`);
      x.addEventListener("click", () => { tags.splice(i, 1); render(); input.focus(); });
      chip.append(x);
      input.before(chip);
    }
    box.dataset.value = JSON.stringify(tags);
    if (hidden) hidden.value = tags.join(",");
    if (announce) emit(box, "nk:change", { value: [...tags] });
  };
  const add = (text) => {
    const t = text.trim();
    if (!t || tags.includes(t)) return false;
    tags.push(t);
    render();
    return true;
  };
  input.addEventListener("keydown", (e) => {
    const last = box.querySelector(".nk-taginput-tag:last-of-type");
    if ((e.key === "Enter" || e.key === ",") && input.value.trim()) { e.preventDefault(); if (add(input.value)) input.value = ""; }
    else if (e.key === "Backspace" && !input.value && tags.length) {
      // the first Backspace arms the last tag, the second removes it
      if (last?.classList.contains("is-armed")) { tags.pop(); render(); }
      else last?.classList.add("is-armed");
    } else last?.classList.remove("is-armed");
  });
  input.addEventListener("paste", (e) => {
    const text = e.clipboardData.getData("text");
    if (!/[,\n]/.test(text)) return;
    e.preventDefault();
    text.split(/[,\n]/).forEach(add);
  });
  input.addEventListener("blur", () => { if (input.value.trim() && add(input.value)) input.value = ""; });
  box.addEventListener("click", (e) => { if (e.target === box) input.focus(); });
  box.nkSet = (v) => { tags = Array.isArray(v) ? [...v] : []; render(false); };
  render(false);
}

/* ---- Menubar: .nk-menubar of [data-menu] items (menus are ordinary
   .nk-menu popovers). Once one is open, hovering a neighbour switches;
   Left/Right walk the bar, in and out of the menus. ---- */
function enhanceMenubar(bar) {
  if (!once(bar, "nkMenubar")) return;
  bar.setAttribute("role", "menubar");
  const items = [...bar.querySelectorAll("[data-menu]")];
  const menuOf = (item) => document.getElementById(item.dataset.menu);
  const openOne = () => items.find((it) => menuOf(it)?.matches(":popover-open"));
  items.forEach((it, i) => {
    it.setAttribute("role", "menuitem");
    it.tabIndex = i ? -1 : 0;
    it.addEventListener("pointerenter", () => {
      const current = openOne();
      if (current && current !== it) { menuOf(current).hidePopover(); it.click(); }
    });
    it.addEventListener("focus", () => items.forEach((x) => { x.tabIndex = x === it ? 0 : -1; }));
    it.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); if (!menuOf(it)?.matches(":popover-open")) it.click(); return; }
      const j = arrowIndex(e, i, items.length, { axis: "x", rtl: isRtl(bar) });
      if (j != null) { e.preventDefault(); items[j].focus(); }
    });
    // inside an open menu, Left/Right close it and open the neighbour's
    menuOf(it)?.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const d = (e.key === "ArrowRight") !== isRtl(bar) ? 1 : -1;
      const next = items[(i + d + items.length) % items.length];
      menuOf(it).hidePopover();
      next.focus();
      next.click();
    });
  });
}

/* ---- Sparkline: .nk-spark data-values="[…]" (null = a gap). ---- */
function drawSpark(el) {
  const values = json(el.dataset.values, []);
  const nums = values.filter((v) => typeof v === "number");
  if (nums.length < 2) { el.replaceChildren(); return; }
  const w = 100, h = 30, pad = 2;
  const lo = Math.min(...nums), hi = Math.max(...nums), span = hi - lo || 1;
  const x = (i) => (i / (values.length - 1)) * w;
  const y = (v) => h - pad - ((v - lo) / span) * (h - pad * 2);
  // one path per unbroken run, so a gap (null) stays a gap
  const runs = [];
  values.forEach((v, i) => { if (typeof v !== "number") runs.push(null); else if (runs.at(-1)) runs.at(-1).push([x(i), y(v)]); else runs.push([[x(i), y(v)]]); });
  const lines = runs.filter(Boolean);
  const s = svg("svg", { viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: "none", "aria-hidden": "true" });
  for (const run of lines) {
    const d = run.map(([px, py], k) => `${k ? "L" : "M"}${px.toFixed(2)} ${py.toFixed(2)}`).join("");
    if (run.length > 1) s.append(svg("path", { class: "nk-spark-area", d: `${d}L${run.at(-1)[0].toFixed(2)} ${h}L${run[0][0].toFixed(2)} ${h}Z` }));
    s.append(svg("path", { class: "nk-spark-line", d }));
  }
  const end = lines.at(-1).at(-1);
  // the end dot is drawn in its own un-stretched layer so it stays round
  const dot = make("span", "nk-spark-end");
  dot.style.setProperty("--x", `${(end[0] / w) * 100}%`);
  dot.style.setProperty("--y", `${(end[1] / h) * 100}%`);
  el.replaceChildren(s, dot);
  // in a row, the value beside the trend is its last reading (unknown stays unknown)
  const row = el.closest(".nk-row");
  if (row) reading(row.querySelector(".nk-row-value"), fmtUnit(values.at(-1), el.dataset.unit ?? ""), el.dataset.tone);
  if (!el.hasAttribute("aria-label") && !el.hasAttribute("role")) { el.setAttribute("role", "img"); el.setAttribute("aria-label", `trend ${nums[0]} to ${nums.at(-1)}, low ${lo}, high ${hi}`); }
}

/* ---- Banner: a .nk-banner-close hides its banner (nk:change "dismissed"). ---- */
function enhanceBanner(banner) {
  if (!once(banner, "nkBanner")) return;
  banner.querySelector(".nk-banner-close")?.addEventListener("click", () => { banner.hidden = true; emit(banner, "nk:change", { value: "dismissed" }); });
}

/* ---- Sortable: .nk-sortable of .nk-sortable-item rows with a
   .nk-sortable-grip button. Drag the grip, or Space to lift, arrows to
   move, Space to drop, Escape to put back. nk:change { value: [data-value…] }. ---- */
function enhanceSortable(list) {
  if (!once(list, "nkSortable")) return;
  const rows = () => [...list.children].filter((el) => el.classList.contains("nk-sortable-item"));
  const order = () => rows().map((r) => r.dataset.value ?? r.textContent.trim());
  const live = make("span", "nk-sr-only");
  live.setAttribute("aria-live", "assertive");
  list.after(live);
  const say = (row, verb) => { const all = rows(); live.textContent = `${row.textContent.trim()}, ${verb}, position ${all.indexOf(row) + 1} of ${all.length}`; };
  const finish = (row, before) => {
    row.classList.remove("is-lifted");
    row.querySelector(".nk-sortable-grip")?.setAttribute("aria-pressed", "false");
    const now = order();
    if (now.join("\u0000") !== before.join("\u0000")) emit(list, "nk:change", { value: now });
  };
  for (const row of rows()) {
    const grip = row.querySelector(".nk-sortable-grip");
    if (!grip) continue;
    grip.type = "button";
    grip.setAttribute("aria-pressed", "false");
    grip.setAttribute("aria-roledescription", "sortable");
    let before = null, lifted = false;
    // drag: the row follows the pointer between its neighbours' midlines
    drag(row, {
      handle: grip, cls: "is-lifted",
      start: () => { before = order(); document.body.classList.add("nk-sorting"); },
      move: (e) => {
        const others = rows().filter((r) => r !== row);
        const after = others.find((r) => { const b = r.getBoundingClientRect(); return e.clientY < b.top + b.height / 2; });
        if (after ? row.nextElementSibling !== after : list.lastElementChild !== row) list.insertBefore(row, after ?? null);
        grip.focus({ preventScroll: true });
      },
      end: () => { document.body.classList.remove("nk-sorting"); finish(row, before); },
    });
    // keyboard: lift, move, drop
    grip.addEventListener("keydown", (e) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (!lifted) { lifted = true; before = order(); row.classList.add("is-lifted"); grip.setAttribute("aria-pressed", "true"); say(row, "lifted"); }
        else { lifted = false; finish(row, before); say(row, "dropped"); }
      } else if (lifted && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        if (e.key === "ArrowUp" && row.previousElementSibling) list.insertBefore(row, row.previousElementSibling);
        else if (e.key === "ArrowDown" && row.nextElementSibling) list.insertBefore(row.nextElementSibling, row);
        grip.focus();
        say(row, "moved");
      } else if (lifted && e.key === "Escape") {
        e.preventDefault();
        lifted = false;
        const all = rows();
        before.forEach((v) => list.append(all.find((r) => (r.dataset.value ?? r.textContent.trim()) === v)));
        row.classList.remove("is-lifted");
        grip.setAttribute("aria-pressed", "false");
        grip.focus();
        say(row, "put back");
      }
    });
    grip.addEventListener("blur", () => { if (lifted) { lifted = false; finish(row, before); } });
  }
}

/* ---- Chart: a time series with axes, for monitoring. <figure class="nk-chart"
   data-series='[{"name":"GPU0 junction","values":[71,72,…]}]' data-start="2026-09-28T13:00:00Z"
   data-step="60" data-unit="°C" data-limit="95" aria-label="…"></figure>
   Lines are the ink ladder (a series may carry "tone"); the part of a line
   past data-limit is drawn in --err, because that part is the problem. Hover
   or arrow keys read any point; null is a gap. el.nkSet(series) replaces the
   data; el.nkPush(v, …) appends one reading per series and drops the oldest. ---- */
const SERIES = ["var(--text)", "var(--muted)", "var(--dim)"];
let chartId = 0;
function niceStep(span) {
  const raw = span / 3, mag = 10 ** Math.floor(Math.log10(raw || 1)), f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
}
function chartData(el) {
  let series = json(el.dataset.series, null);
  if (!series) series = [{ name: el.getAttribute("aria-label") || "", values: json(el.dataset.values, []) }];
  return series.map((s, i) => ({ name: s.name ?? "", values: s.values ?? [], colour: s.tone ? `var(--${{ crit: "err", ok: "ok", warn: "warn", info: "info" }[s.tone] ?? s.tone})` : SERIES[Math.min(i, SERIES.length - 1)] }));
}
function drawChart(el) {
  const series = chartData(el);
  const unitOf = el.dataset.unit || "";
  const val = (v) => fmtUnit(v, unitOf);
  const nums = series.flatMap((s) => s.values.filter((v) => typeof v === "number"));
  const n = Math.max(0, ...series.map((s) => s.values.length));
  el.setAttribute("role", "figure");
  if (!el.hasAttribute("tabindex")) el.tabIndex = 0;
  if (!nums.length || n < 2) { el.replaceChildren(make("p", "nk-chart-empty", "No readings yet")); return; }
  const id = el.dataset.chartId ||= `nkc${++chartId}`;
  const start = el.dataset.start ? (isNaN(el.dataset.start) ? Date.parse(el.dataset.start) : Number(el.dataset.start)) : null;
  const stepMs = (Number(el.dataset.step) || 60) * 1000;
  const limit = el.dataset.limit !== undefined && el.dataset.limit !== "" ? Number(el.dataset.limit) : null;
  let lo = el.dataset.min != null ? Number(el.dataset.min) : Math.min(...nums, limit ?? Infinity);
  let hi = el.dataset.max != null ? Number(el.dataset.max) : Math.max(...nums, limit ?? -Infinity);
  if (hi === lo) { hi += 1; lo -= 1; }
  const tick = niceStep(hi - lo);
  if (el.dataset.min == null) lo = Math.floor(lo / tick) * tick;
  if (el.dataset.max == null) hi = Math.ceil(hi / tick) * tick;
  const ticks = [];
  for (let v = lo; v <= hi + tick / 1000; v += tick) ticks.push(+v.toFixed(10));

  const s = svg("svg", { "aria-hidden": "true" });
  const readout = make("div", "nk-chart-readout"); readout.hidden = true; readout.setAttribute("aria-live", "polite");
  const parts = [s, readout];
  if (series.length > 1) {
    const legend = make("div", "nk-chart-legend");
    for (const se of series) {
      const last = [...se.values].reverse().find((v) => typeof v === "number");
      const item = make("span"); item.style.setProperty("--series", se.colour);
      item.append(make("i"), make("span", "", se.name), make("b", "", val(last)));
      legend.append(item);
    }
    parts.push(legend);
  }
  el.replaceChildren(...parts);
  const W = Math.max(120, s.clientWidth), H = Math.max(60, s.clientHeight);
  s.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const labels = ticks.map((v) => val(v));
  const left = Math.max(...labels.map((l) => l.length)) * 6.4 + 12, right = 10, top = 8, bottom = start != null ? 24 : 8;
  const pw = W - left - right, ph = H - top - bottom;
  const x = (i) => left + (i / (n - 1)) * pw;
  const y = (v) => top + (1 - (v - lo) / (hi - lo)) * ph;
  const g = (cls) => { const e = svg("g", { class: cls }); s.append(e); return e; };

  const grid = g("nk-chart-grid");
  ticks.forEach((v, k) => {
    const py = Math.round(y(v)) + 0.5;
    grid.append(svg("line", { x1: left, x2: W - right, y1: py, y2: py, class: v === lo ? "is-base" : "" }));
    const t = svg("text", { x: left - 8, y: py + 3.5, class: "nk-chart-tick", "text-anchor": "end" }); t.textContent = labels[k]; grid.append(t);
  });
  if (start != null) {
    const count = Math.max(2, Math.min(n, Math.floor(pw / 90)));
    for (let k = 0; k < count; k++) {
      const i = Math.round((k / (count - 1)) * (n - 1));
      const t = svg("text", { x: x(i), y: H - 6, class: "nk-chart-tick", "text-anchor": k === 0 ? "start" : k === count - 1 ? "end" : "middle" });
      t.textContent = fmtClock(start + i * stepMs, { seconds: stepMs < 60000 }); grid.append(t);
    }
  }
  const defs = svg("defs"); s.append(defs);
  if (limit != null) {
    const clip = svg("clipPath", { id: `${id}-over` }); clip.append(svg("rect", { x: 0, y: 0, width: W, height: Math.max(0, y(limit)) })); defs.append(clip);
  }
  const paths = (values) => {
    const runs = [];
    values.forEach((v, i) => { if (typeof v !== "number") runs.push(null); else if (runs.at(-1)) runs.at(-1).push([x(i), y(v)]); else runs.push([[x(i), y(v)]]); });
    return runs.filter(Boolean).map((r) => r.map(([px, py], k) => `${k ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join(""));
  };
  const lines = g("nk-chart-lines");
  series.forEach((se, si) => {
    const ds = paths(se.values);
    for (const d of ds) {
      if (si === 0 && series.length === 1) {
        const m = d.match(/M(-?[\d.]+)/), e = d.match(/(-?[\d.]+) -?[\d.]+$/);   // a point past the scale has negative coordinates
        lines.append(svg("path", { class: "nk-chart-area", d: `${d}L${e[1]} ${top + ph}L${m[1]} ${top + ph}Z` }));
      }
      lines.append(svg("path", { class: "nk-chart-line", d, style: `--series:${se.colour}` }));
      if (limit != null) lines.append(svg("path", { class: "nk-chart-line is-over", d, "clip-path": `url(#${id}-over)` }));
    }
    const lastI = se.values.findLastIndex((v) => typeof v === "number");
    if (lastI >= 0) lines.append(svg("circle", { class: "nk-chart-end", cx: x(lastI), cy: y(se.values[lastI]), r: 2.5, style: `--series:${limit != null && se.values[lastI] > limit ? "var(--err)" : se.colour}` }));
  });
  if (limit != null) {
    const ly = Math.round(y(limit)) + 0.5, lim = g("nk-chart-limit");
    lim.append(svg("line", { x1: left, x2: W - right, y1: ly, y2: ly }));
    const t = svg("text", { x: left + 6, y: ly - 5, "text-anchor": "start" }); t.textContent = `limit ${val(limit)}`; lim.append(t);
  }
  const cursor = g("nk-chart-cursor"); cursor.style.visibility = "hidden";
  const cline = svg("line", { y1: top, y2: top + ph }); cursor.append(cline);
  const dots = series.map((se) => { const c = svg("circle", { r: 3.5, class: "nk-chart-dot", style: `--series:${se.colour}` }); cursor.append(c); return c; });

  const show = (i) => {
    if (i == null) { cursor.style.visibility = "hidden"; readout.hidden = true; return; }
    const px = x(i);
    cline.setAttribute("x1", px); cline.setAttribute("x2", px);
    series.forEach((se, k) => { const v = se.values[i]; dots[k].style.display = typeof v === "number" ? "" : "none"; if (typeof v === "number") { dots[k].setAttribute("cx", px); dots[k].setAttribute("cy", y(v)); } });
    cursor.style.visibility = "visible";
    readout.replaceChildren();
    if (start != null) readout.append(make("time", "", fmtClock(start + i * stepMs, { seconds: stepMs < 60000 })));
    for (const se of series) {
      const row = make("div"); row.style.setProperty("--series", se.colour);
      const v = se.values[i];
      const b = make("b", "", val(v)); if (limit != null && v > limit) b.dataset.tone = "crit";
      row.append(make("i"), make("span", "", se.name || "value"), b);
      readout.append(row);
    }
    readout.hidden = false;
    const flip = px > left + pw * 0.62;
    readout.style.setProperty("--rx", flip ? `calc(${px - 12}px - 100%)` : `${px + 12}px`);
    readout.style.setProperty("--ry", `${top}px`);
    el.dataset.at = i;
  };
  el._nkChartShow = show;
  if (el.dataset.at != null && el.matches(":hover, :focus-visible")) show(Math.min(n - 1, Number(el.dataset.at)));
  if (!el.getAttribute("aria-label")) {
    const f = series[0], known = f.values.filter((v) => typeof v === "number");
    el.setAttribute("aria-label", `${f.name}: ${val(known[0])} to ${val(known.at(-1))}, low ${val(Math.min(...known))}, high ${val(Math.max(...known))}${limit != null ? `, limit ${val(limit)}` : ""}`);
  }
  el._nkChartN = n; el._nkChartX = (clientX) => { const r = s.getBoundingClientRect(); return Math.round(((clientX - r.left) * (W / r.width) - left) / pw * (n - 1)); };
}
function enhanceChart(el) {
  if (!once(el, "nkChart")) return;
  sizes.observe(el);
  const clamp = (i) => Math.max(0, Math.min((el._nkChartN || 1) - 1, i));
  el.addEventListener("pointermove", (e) => el._nkChartShow?.(clamp(el._nkChartX(e.clientX))));
  el.addEventListener("pointerleave", () => { if (document.activeElement !== el) el._nkChartShow?.(null); });
  el.addEventListener("keydown", (e) => {
    const n = el._nkChartN || 0, at = el.dataset.at != null ? Number(el.dataset.at) : n - 1;
    const j = e.key === "Escape" ? null : arrowIndex(e, at, n, { axis: "x", loop: false });
    if (e.key === "Escape") { el._nkChartShow?.(null); return; }
    if (j == null) return;
    e.preventDefault(); el._nkChartShow?.(j);
  });
  el.addEventListener("focus", () => el._nkChartShow?.(el._nkChartN - 1));
  el.addEventListener("blur", () => el._nkChartShow?.(null));
  el.nkSet = (series) => { el.dataset.series = JSON.stringify(series); };
  el.nkPush = (...vals) => {
    const series = json(el.dataset.series, null);
    if (!series) return;
    const keep = Number(el.dataset.keep) || Math.max(...series.map((s) => s.values.length));
    let dropped = 0;
    series.forEach((s, k) => { s.values.push(vals[k] ?? null); while (s.values.length > keep) { s.values.shift(); dropped = 1; } });
    if (dropped && el.dataset.start) {   // the window slides: its start moves forward one step
      const t = isNaN(el.dataset.start) ? Date.parse(el.dataset.start) : Number(el.dataset.start);
      el.dataset.start = String(t + (Number(el.dataset.step) || 60) * 1000);
    }
    el.dataset.series = JSON.stringify(series);
  };
  drawChart(el);
}

/* ---- Log view: <div class="nk-log" aria-label="ledger-api"><pre>…lines…</pre></div>.
   A filter field, a level bank (all · warnings · errors) and a count over a
   virtualised list (only the rows on screen exist), so it holds thousands of
   lines. Errors and warnings carry a lamp; timestamps and levels are read
   from each line; ANSI colours map onto the state colours. It follows the
   newest line until you scroll up, then counts what arrived and offers a
   way back. log(el, lines) appends (strings, or { t, level, text });
   el.nkSet(lines) replaces. data-max caps the lines kept (default 5000). ---- */
const LOG_TIME = /^\s*\[?(\d{4}-\d\d-\d\d[T ][\d:]+(?:\.\d+)?(?:Z|[+-]\d\d:?\d\d)?|\d\d:\d\d:\d\d)(?:\.\d+)?\]?\s+/;
const LOG_LEVEL = /\b(FATAL|ERROR|ERR|WARN(?:ING)?|INFO|DEBUG|TRACE)\b:?\s*/i;
const ANSI = /\x1b\[([\d;]*)m/g;
const ANSI_COLOUR = { 31: "red", 91: "red", 32: "green", 92: "green", 33: "yellow", 93: "yellow", 34: "blue", 94: "blue", 36: "blue", 96: "blue", 35: "magenta", 95: "magenta", 90: "dim", 2: "dim" };
const levelOf = (s) => { s = String(s || "").toLowerCase(); return /fatal|err/.test(s) ? "error" : /warn/.test(s) ? "warn" : /debug|trace/.test(s) ? "debug" : s ? "info" : ""; };
function parseLog(line) {
  if (line && typeof line === "object") {
    const t = line.t ?? line.time;
    return { time: t == null ? "" : typeof t === "string" && /^\d\d:\d\d/.test(t) ? t.slice(0, 8) : fmtClock(t, { seconds: true }), level: levelOf(line.level), text: String(line.text ?? line.msg ?? ""), plain: String(line.text ?? line.msg ?? "").replace(ANSI, "") };
  }
  let text = String(line), time = "", level = "";
  const bare = () => text.replace(ANSI, "");
  const tm = bare().match(LOG_TIME);
  if (tm) { time = /^\d\d:/.test(tm[1]) ? tm[1] : fmtClock(Date.parse(tm[1].replace(" ", "T")), { seconds: true }); text = text.replace(/^(\x1b\[[\d;]*m)*/, "").replace(LOG_TIME, ""); }
  const lm = bare().slice(0, 40).match(LOG_LEVEL);
  if (lm) { level = levelOf(lm[1]); if (bare().indexOf(lm[0]) < 12) text = text.replace(LOG_LEVEL, ""); }
  return { time, level, text, plain: text.replace(ANSI, "") };
}
function ansiNodes(text) {
  const out = [];
  let last = 0, colour = "", bold = false, m;
  const flush = (end) => {
    if (end <= last) return;
    const chunk = text.slice(last, end);
    if (!colour && !bold) out.push(chunk);
    else { const sp = make("span", [colour && `nk-ansi-${colour}`, bold && "nk-ansi-bold"].filter(Boolean).join(" "), chunk); out.push(sp); }
  };
  ANSI.lastIndex = 0;
  while ((m = ANSI.exec(text))) {
    flush(m.index); last = ANSI.lastIndex;
    for (const code of (m[1] || "0").split(";").map(Number)) {
      if (code === 0) { colour = ""; bold = false; } else if (code === 1) bold = true; else if (code === 22) bold = false; else if (code === 39) colour = ""; else if (ANSI_COLOUR[code]) colour = ANSI_COLOUR[code];
    }
  }
  flush(text.length);
  return out;
}
function marked(text, q) {
  const out = [], low = text.toLowerCase();
  let i = 0, j;
  while (q && (j = low.indexOf(q, i)) >= 0) { out.push(text.slice(i, j), make("mark", "", text.slice(j, j + q.length))); i = j + q.length; }
  out.push(text.slice(i));
  return out;
}
const logRender = new WeakMap();
export function log(el, lines) { el.nkLog?.(Array.isArray(lines) ? lines : [lines]); }
function enhanceLog(box) {
  if (!once(box, "nkLog")) return;
  const initial = box.querySelector("pre")?.textContent ?? "";
  const max = Number(box.dataset.max) || 5000;
  const bar = make("div", "nk-log-bar");
  bar.innerHTML = `<label class="nk-input is-small nk-log-filter"><svg class="nk-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" placeholder="Filter lines" aria-label="Filter lines"><button class="nk-input-clear" type="button" aria-label="Clear"></button></label>`
    + `<div class="nk-segmented nk-log-levels" role="tablist" aria-label="Levels"><button class="nk-segmented-btn" role="tab" aria-selected="true" data-value="all"><span class="nk-segmented-label">All</span></button><button class="nk-segmented-btn" role="tab" aria-selected="false" data-value="warn"><span class="nk-segmented-label">Warnings</span></button><button class="nk-segmented-btn" role="tab" aria-selected="false" data-value="error"><span class="nk-segmented-label">Errors</span><span class="nk-segmented-badge" data-tone="crit" hidden></span></button></div>`
    + `<span class="nk-log-count"></span>`;
  const body = make("div", "nk-log-body");
  body.tabIndex = 0;
  body.setAttribute("role", "log");
  body.setAttribute("aria-live", "off");          // a busy log would drown a screen reader; the count line speaks instead
  body.setAttribute("aria-label", box.getAttribute("aria-label") || "Log");
  const spacer = make("div", "nk-log-spacer"), rows = make("div", "nk-log-rows");
  body.append(spacer, rows);
  const jump = make("button", "nk-log-jump"); jump.type = "button"; jump.hidden = true;
  box.replaceChildren(bar, body, jump);
  enhance(bar);
  const input = bar.querySelector("input"), count = bar.querySelector(".nk-log-count"), badge = bar.querySelector(".nk-segmented-badge");
  count.setAttribute("aria-live", "polite");

  let lines = [], view = [], q = "", only = "all", follow = true, unseen = 0, errors = 0;
  const rowH = () => parseFloat(getComputedStyle(box).getPropertyValue("--log-row")) || 20;
  const matches = (l) => (only === "all" || (only === "warn" ? l.level === "warn" || l.level === "error" : l.level === "error")) && (!q || l.plain.toLowerCase().includes(q));
  const row = (l) => {
    const r = make("div", "nk-log-line");
    if (l.level) r.dataset.level = l.level;
    const lamp = make("span", "nk-log-lamp");
    if (l.level === "error" || l.level === "warn") { const led = make("span", "nk-led"); led.dataset.tone = l.level === "error" ? "crit" : "warn"; lamp.append(led); }
    const text = make("span", "nk-log-text");
    text.append(...(q ? marked(l.plain, q) : ansiNodes(l.text)));
    r.append(lamp);
    if (l.time) r.append(make("time", "", l.time));
    r.append(text);
    return r;
  };
  let frame = 0;
  const render = () => {
    frame = 0;
    const h = rowH(), topRow = Math.max(0, Math.floor(body.scrollTop / h) - 8), end = Math.min(view.length, Math.ceil((body.scrollTop + body.clientHeight) / h) + 8);
    spacer.style.height = `${view.length * h}px`;
    rows.style.transform = `translateY(${topRow * h}px)`;
    rows.replaceChildren(...view.slice(topRow, end).map((i) => row(lines[i])));
    if (!view.length) rows.replaceChildren(make("div", "nk-log-empty", lines.length ? "No lines match" : "No lines yet"));
  };
  const schedule = () => { frame ||= requestAnimationFrame(render); };
  const status = () => {
    errors = lines.reduce((n, l) => n + (l.level === "error"), 0);
    badge.hidden = !errors; badge.textContent = errors;
    count.textContent = view.length === lines.length ? `${plural(lines.length, "line")}${errors ? ` · ${plural(errors, "error")}` : ""}` : `${fmtNum(view.length)} of ${plural(lines.length, "line")}`;
    jump.hidden = follow || !unseen;
    jump.textContent = `${plural(unseen, "new line")} ↓`;
  };
  const toEnd = () => { follow = true; unseen = 0; render(); body.scrollTop = body.scrollHeight; status(); };
  const rebuild = () => { view = []; lines.forEach((l, i) => { if (matches(l)) view.push(i); }); };
  const push = (more) => {
    const parsed = more.flatMap((m) => (typeof m === "string" ? m.split("\n").filter((s) => s !== "") : [m])).map(parseLog);
    lines.push(...parsed);
    if (lines.length > max) { lines.splice(0, lines.length - max); rebuild(); }
    else { const base = lines.length - parsed.length; parsed.forEach((l, k) => { if (matches(l)) view.push(base + k); }); }
    if (follow) toEnd(); else { unseen += parsed.filter(matches).length; schedule(); status(); }
  };
  box.nkLog = push;
  box.nkSet = (all) => { lines = []; view = []; unseen = 0; push(Array.isArray(all) ? all : [all]); };
  body.addEventListener("scroll", () => {
    const atEnd = body.scrollTop + body.clientHeight >= body.scrollHeight - rowH();
    if (atEnd !== follow) { follow = atEnd; if (follow) unseen = 0; status(); }
    schedule();
  });
  body.addEventListener("keydown", (e) => {
    if (e.key === "End") { e.preventDefault(); toEnd(); }
    if (e.key === "Home") { e.preventDefault(); follow = false; body.scrollTop = 0; status(); }
  });
  jump.addEventListener("click", toEnd);
  input.addEventListener("input", () => { q = input.value.trim().toLowerCase(); rebuild(); toEnd(); });
  bar.querySelector(".nk-log-levels").addEventListener("nk:change", (e) => { e.stopPropagation(); only = e.detail.value; rebuild(); toEnd(); });
  logRender.set(body, schedule);
  sizes.observe(body);
  push(initial ? [initial] : []);
}

/* ---- init: enhance what is there, redraw on resize, follow additions. ---- */
const drawn = new WeakSet();
function enhance(root) {
  if (!(root instanceof Element || root instanceof Document)) return;
  const all = (sel) => [...(root.matches?.(sel) ? [root] : []), ...root.querySelectorAll(sel)];
  all("select.nk-select").forEach(enhanceSelect);
  all(".nk-pill-button").forEach(enhancePill);
  all(".nk-segmented").forEach(enhanceSegmented);
  all(".nk-choice").forEach(enhanceChoice);
  all(".nk-switch").forEach(enhanceSwitch);
  all(".nk-seg").forEach(segReading);
  for (const el of all(".nk-seg[data-frac], .nk-seg[data-max], .nk-bars[data-values], .nk-chips")) if (!drawn.has(el)) { drawn.add(el); sizes.observe(el); }
  all(".nk-spark[data-values]").forEach(drawSpark);
  all(".nk-progress[data-value]").forEach(syncProgress);
  all(".nk-dial[data-progress]").forEach(syncDial);
  all(".nk-stages").forEach(syncStages);   // an SVG in a viewBox: scales without a redraw
  all(".nk-donut[data-segments]").forEach(drawDonut);
  all(".nk-level").forEach(enhanceLevel);
  all(".nk-carousel").forEach(enhanceCarousel);
  all(".nk-matrix").forEach(drawMatrix);
  all("[data-dialog]").forEach(enhanceDialogTrigger);
  all("dialog.nk-dialog, dialog.nk-drawer").forEach(enhanceDialog);
  all("[data-menu]").forEach(enhanceMenuTrigger);
  all("[data-popover]").forEach(enhancePopoverTrigger);
  all(".nk-notice").forEach(enhanceNotice);
  all("input.nk-slider").forEach(enhanceSlider);
  all(".nk-stepper").forEach(enhanceStepper);
  all("input[data-filter]").forEach(enhanceFilter);
  all(".nk-composer").forEach(enhanceComposer);
  all(".nk-code").forEach(enhanceCode);
  all(".nk-swatches").forEach(enhanceSwatches);
  all(".nk-knob[data-min], .nk-knob[data-max]").forEach(enhanceRangeKnob);
  all(".nk-knob:not([data-min]):not([data-max])").forEach(enhanceKnob);
  all("table.nk-datatable").forEach(enhanceDataTable);
  all(".nk-drop").forEach(enhanceDrop);
  all(".nk-splitpane").forEach(enhanceSplit);
  all(".nk-scroll").forEach(enhanceScroll);
  all(".nk-wheel").forEach(enhanceWheel);
  all(".nk-angle").forEach(enhanceAngle);
  all(".nk-scale").forEach(enhanceScale);
  all(".nk-knob-frame").forEach(enhanceKnobFrame);
  all(".nk-scrub").forEach(enhanceScrub);
  all(".nk-tabs").forEach(enhanceTabs);
  all(".nk-combobox").forEach(enhanceCombobox);
  all("dialog.nk-command").forEach(enhanceCommand);
  all("[data-command]").forEach(enhanceCommandTrigger);
  all("[data-context-menu]").forEach(enhanceContextMenu);
  all(".nk-toolbar").forEach(enhanceToolbar);
  all(".nk-input-clear").forEach(enhanceInputClear);
  all(".nk-button[data-icon], .nk-button.is-danger").forEach(enhanceButton);
  all(".nk-calendar").forEach(enhanceCalendar);
  all(".nk-datepicker").forEach(enhanceDatepicker);
  all(".nk-range").forEach(enhanceRange);
  all(".nk-otp").forEach(enhanceOtp);
  all(".nk-input-reveal").forEach(enhanceReveal);
  all(".nk-taginput").forEach(enhanceTagInput);
  all(".nk-menubar").forEach(enhanceMenubar);
  all(".nk-banner").forEach(enhanceBanner);
  all(".nk-sortable").forEach(enhanceSortable);
  all(".nk-colour").forEach(enhanceColour);
  all(".nk-chart").forEach(enhanceChart);
  all(".nk-log").forEach(enhanceLog);
  all(".nk-panel-body, .nk-page").forEach(alignMeters);
  if (root instanceof Element) migrateTitles(root); else migrateTitles(document.body);
}
// Redraws wait for the next frame: drawing can resize what is observed
// (chips reflow), and doing it inside the callback loops the observer.
const pendingDraw = new Set();
let drawFrame = 0;
const sizes = new ResizeObserver((entries) => {
  for (const { target } of entries) pendingDraw.add(target);
  drawFrame ||= requestAnimationFrame(() => {
    drawFrame = 0;
    for (const target of pendingDraw) {
      if (target.matches(".nk-seg")) drawSeg(target);
      else if (target.matches(".nk-bars")) drawBars(target);
      else if (target.matches(".nk-chips")) fitChips(target);
      else if (target.matches(".nk-chart")) drawChart(target);
      else if (target.matches(".nk-log-body")) logRender.get(target)?.();
    }
    pendingDraw.clear();
  });
});

let forwarding = false;
export function init(root = document, { icons } = {}) {
  if (icons) SPRITE = icons;
  // el.dispatchEvent(new CustomEvent("nk:set", { detail: { value } })) is the
  // same as el.nkSet(value), for code that only has events to hand
  if (!forwarding) { forwarding = true; document.addEventListener("nk:set", (e) => e.target.nkSet?.(e.detail?.value)); }
  installTooltips();
  enhance(root);
  document.fonts?.ready.then(() => root.querySelectorAll?.(".nk-panel-body, .nk-page").forEach(alignMeters));
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "attributes") {
        const el = r.target;
        if (el.matches(".nk-seg")) drawSeg(el);
        else if (el.matches(".nk-bars")) drawBars(el);
        else if (el.matches(".nk-donut")) drawDonut(el);
        else if (el.matches(".nk-progress")) syncProgress(el);
        else if (el.matches(".nk-dial")) syncDial(el);
        else if (el.matches(".nk-stages > li")) syncStages(el.parentElement);
        else if (el.matches(".nk-matrix")) drawMatrix(el);
        else if (el.matches(".nk-spark")) drawSpark(el);
        else if (el.matches(".nk-chart")) drawChart(el);
        else if (r.attributeName === "title") migrateTitles(el);
      } else r.addedNodes.forEach(enhance);
    }
  }).observe(root === document ? document.body : root, {
    subtree: true, childList: true, attributes: true,
    attributeFilter: ["data-frac", "data-values", "data-highlight", "data-segments", "data-center", "data-amount-unit", "data-value", "data-max", "data-progress", "data-text", "data-series", "data-limit", "data-unit", "title"],
  });
}

export { enhance, drawSeg, drawDonut, drawBars, drawMatrix, drawSpark, drawChart, alignMeters };
export * as format from "./format.js";
