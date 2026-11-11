/* Penny web app: Appearance: themes, custom colors kept readable, comfort settings and the company look.
   Sections: appearance (v1.7). */
"use strict";

// ------------------------------------------------------------------ appearance (v1.7)
/* Two layers, so a company can have one look and people can still be comfortable:
   - The look (colors and corners): a preset, or a fully custom color. Admins set the company default (saved as the
     rule display.theme, with a reason and undo); anyone can follow it or choose their own.
   - Personal comfort: light or dark, text size, density and motion. Always each person's own choice.
   Custom colors are checked for contrast: if a color would make text hard to read, Penny darkens it (or lightens it
   in dark mode) just enough to meet WCAG AA, and says so. Settings save to the person's account. */
const LOOK_DEFAULT = { preset: "teal", accent: "#0f766e", bg: "default", corners: "rounded" };
const FEEL_DEFAULT = { mode: "system", text: "m", density: "comfortable", motion: "system" };
const PRESETS = {
  teal: { name: "Penny teal", accent: "#0f766e", note: "The original" },
  harbor: { name: "Harbor blue", accent: "#1d4ed8" },
  evergreen: { name: "Evergreen", accent: "#15803d" },
  plum: { name: "Plum", accent: "#7e22ce" },
  copper: { name: "Copper", accent: "#b45309" },
  graphite: { name: "Graphite", accent: "#334155" },
  contrast: { name: "High contrast", accent: "#0047b3", note: "Strongest text and borders" },
};
const TEXT_ZOOM = { s: 0.92, m: 1, l: 1.1, xl: 1.22 };
let MYPREFS = { follow: true, look: { ...LOOK_DEFAULT }, ...FEEL_DEFAULT };

// color math: hex <-> rgb <-> hsl, WCAG contrast
const hexRgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || "").trim()); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgbHex = (r) => "#" + r.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0")).join("");
const lum = (h) => { const c = hexRgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
/** Turn a red, green and blue color into hue, saturation and lightness. */
function rgbHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
/** Turn hue, saturation and lightness back into red, green and blue. */
function hslRgb([h, s, l]) {
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
const shade = (hex, dl) => { const [h, s, l] = rgbHsl(hexRgb(hex)); return rgbHex(hslRgb([h, s, Math.max(0, Math.min(1, l + dl))])); };
const mix = (a, b, t) => { const x = hexRgb(a), y = hexRgb(b); return rgbHex(x.map((v, i) => v * t + y[i] * (1 - t))); };
/** Move a color lighter or darker until it reaches the contrast needed against a background. */
function readable(hex, bg, need = 4.5, dir = -1) {
  let c = hex, n = 0;
  while (contrast(c, bg) < need && n++ < 60) c = shade(c, dir * 0.02);
  return c;
}
const LIGHT_SURFACE = "#ffffff", DARK_SURFACE = "#172231", DARK_SIDE = "#0b121c", LIGHT_SIDE = "#15212f";
/** Everything a look needs, for light and dark, plus what was adjusted so the person can be told. */
function lookPalette(look) {
  const base = look.preset === "custom" ? (hexRgb(look.accent) ? look.accent : LOOK_DEFAULT.accent) : (PRESETS[look.preset] || PRESETS.teal).accent;
  const light = readable(base, LIGHT_SURFACE, 4.5, -1);
  let dark = readable(shade(base, 0.25), DARK_SURFACE, 4.5, +1);
  if (look.preset === "contrast") dark = "#ffd400";
  const adjusted = light.toLowerCase() !== base.toLowerCase();
  const onLight = contrast("#ffffff", light) >= 4.5 ? "#ffffff" : "#000000";
  const onDark = contrast("#062621", dark) >= 4.5 ? "#062621" : "#000000";
  return { base, light, dark, adjusted, onLight, onDark,
    lightStrong: shade(light, -0.08), darkStrong: shade(dark, 0.1),
    lightSoft: mix(light, LIGHT_SURFACE, 0.12), darkSoft: mix(dark, DARK_SURFACE, 0.2),
    sideLightBg: mix(light, LIGHT_SIDE, 0.3), sideDarkBg: mix(dark, DARK_SIDE, 0.22) };
}
/** The style rules for a chosen look. Empty for the standard look. */
function lookCss(look) {
  const plain = look.preset === "teal" && look.bg === "default" && look.corners === "rounded";
  if (plain) return "";
  const p = lookPalette(look);
  const sideText = (bg, c) => readable(c, bg, 4.5, +1);
  let light = "", dark = "";
  if (look.preset !== "teal") {
    light += `--accent:${p.light};--accent-strong:${p.lightStrong};--accent-soft:${p.lightSoft};--on-accent:${p.onLight};--focus:${p.light};--info:${p.light};--info-soft:${p.lightSoft};--side-active-bg:${p.sideLightBg};--side-active-text:${sideText(p.sideLightBg, shade(p.light, 0.3))};`;
    dark += `--accent:${p.dark};--accent-strong:${p.darkStrong};--accent-soft:${p.darkSoft};--on-accent:${p.onDark};--focus:${p.darkStrong};--info:${p.dark};--info-soft:${p.darkSoft};--side-active-bg:${p.sideDarkBg};--side-active-text:${sideText(p.sideDarkBg, p.darkStrong)};`;
  }
  if (look.preset === "contrast") {
    light += "--text:#000000;--text-2:#1f2937;--text-3:#374151;--border:#6b7280;--border-strong:#374151;--control-border:#111827;--bg:#ffffff;--surface-2:#f3f4f6;";
    dark += "--bg:#000000;--surface:#0b0b0b;--surface-2:#161616;--surface-3:#222222;--th-bg:#161616;--text:#ffffff;--text-2:#e5e7eb;--text-3:#d1d5db;--border:#9ca3af;--border-strong:#e5e7eb;--control-border:#f3f4f6;";
  }
  if (look.bg === "warm") {
    light += "--bg:#f8f5ef;--surface-2:#f3efe7;--surface-3:#e9e3d8;--th-bg:#f3efe7;--border:#e6dfd2;";
    dark += "--bg:#14120f;--surface:#1d1a16;--surface-2:#25211c;--surface-3:#2f2a24;--th-bg:#25211c;--border:#3a342c;";
  } else if (look.bg === "cool") {
    light += "--bg:#f2f6fb;--surface-2:#ecf1f8;--surface-3:#e1e8f2;--th-bg:#ecf1f8;--border:#dae2ee;";
  }
  if (look.corners === "square") light += "--radius:4px;--radius-sm:3px;";
  const both = look.corners === "square" ? "--radius:4px;--radius-sm:3px;" : "";
  return `:root{${light}}@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${dark}${both}}}:root[data-theme="dark"]{${dark}${both}}`;
}
const companyLook = () => ({ ...LOOK_DEFAULT, ...((RULES().display || {}).theme || {}) });
const myLook = () => (MYPREFS.follow !== false ? companyLook() : { ...LOOK_DEFAULT, ...(MYPREFS.look || {}) });
const lookName = (l) => (l.preset === "custom" ? `Custom ${l.accent}` : (PRESETS[l.preset] || PRESETS.teal).name) + (l.bg !== "default" ? `, ${l.bg} background` : "") + (l.corners === "square" ? ", square corners" : "");
/** Apply the person's look to the page: colors, corners, mode, text size, spacing and motion. */
function applyLook() {
  const css = lookCss(myLook());
  let st = $("#appearance");
  if (!st) { st = document.createElement("style"); st.id = "appearance"; document.head.appendChild(st); }
  st.textContent = css;
  store.set("penny.appearance.css", css);
  const f = { ...FEEL_DEFAULT, ...MYPREFS };
  if (f.mode === "system") { delete document.documentElement.dataset.theme; store.del("penny.theme"); }
  else { document.documentElement.dataset.theme = f.mode; store.set("penny.theme", f.mode); }
  document.body.style.zoom = TEXT_ZOOM[f.text] && f.text !== "m" ? String(TEXT_ZOOM[f.text]) : "";
  document.body.classList.toggle("density-compact", f.density === "compact");
  document.body.classList.toggle("reduce-motion", f.motion === "reduce");
}
/** Read a person's saved appearance settings when they sign in. */
function loadMyLook(u) {
  const saved = (u && u.prefs) || {};
  const legacy = store.get("penny.theme", "");          // the moon/sun choice from before v1.7
  MYPREFS = { follow: true, look: { ...LOOK_DEFAULT }, ...FEEL_DEFAULT, ...(legacy && !saved.mode ? { mode: legacy } : {}), ...saved };
  applyLook();
}
let saveTimer = null;
/** Change one appearance setting, show it at once and save it to the person's account. */
function setLook(change) {
  MYPREFS = { ...MYPREFS, ...change, look: { ...MYPREFS.look, ...(change.look || {}) } };
  applyLook();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try { if (user) await DIRECTORY().setPrefs(user.id, MYPREFS); paintLookSaved("Saved to your account"); }
    catch (e) { paintLookSaved("Could not save. Your choice applies until you reload."); }
  }, 350);
  if ($("#look-page")) paintAppearance();
}
/** Say that an appearance change was saved. */
function paintLookSaved(msg) { const el = $("#look-saved"); if (el) { el.textContent = msg; el.hidden = false; } }
const SEG_LABEL = { bg: "Background", corners: "Corners", mode: "Mode", text: "Text size", density: "Density", motion: "Motion" };
const seg = (name, cur, opts) => `<div class="segmented look-seg" role="radiogroup" aria-label="${esc(SEG_LABEL[name] || name)}">${opts.map(([v, l]) => `<button type="button" role="radio" aria-checked="${v === cur}" data-feel="${esc(name)}" data-v="${esc(v)}">${esc(l)}</button>`).join("")}</div>`;
/** The row of color themes to choose from. */
function swatches(cur, follow) {
  return `<div class="presets" role="radiogroup" aria-label="Color theme">${Object.entries(PRESETS).map(([k, p]) => {
    const pal = lookPalette({ ...LOOK_DEFAULT, preset: k });
    return `<button type="button" class="preset${!follow && cur.preset === k ? " on" : ""}" role="radio" aria-checked="${!follow && cur.preset === k}" data-preset="${k}">
      <span class="sw" aria-hidden="true"><i style="background:${pal.light}"></i><i style="background:${pal.lightSoft}"></i><i style="background:${pal.dark}"></i></span>
      <b>${esc(p.name)}</b>${p.note ? `<span class="sub">${esc(p.note)}</span>` : ""}</button>`;
  }).join("")}
    <button type="button" class="preset${!follow && cur.preset === "custom" ? " on" : ""}" role="radio" aria-checked="${!follow && cur.preset === "custom"}" data-preset="custom">
      <span class="sw sw-custom" aria-hidden="true"><i style="background:${esc(cur.preset === "custom" ? cur.accent : "conic-gradient(#e11d48,#f59e0b,#16a34a,#2563eb,#9333ea,#e11d48)")}"></i></span><b>Custom</b><span class="sub">Any color you like</span></button></div>`;
}
/** The body of the Appearance page: theme, colors, comfort settings and the company look. */
function appearanceBody() {
  const f = { ...FEEL_DEFAULT, ...MYPREFS };
  const follow = MYPREFS.follow !== false;
  const look = myLook();
  const pal = lookPalette(look);
  const company = companyLook();
  return `
    <section class="card card-pad look-card"><h2>Colors</h2>
      <div class="choice look-follow" role="radiogroup" aria-label="Whose colors">
        <label><input type="radio" name="follow" value="company" ${follow ? "checked" : ""}><b>Use the company look</b><small>${esc(lookName(company))}${can("rules") ? ". As an Admin, you can change it below." : ". Your Admin chooses it."}</small></label>
        <label><input type="radio" name="follow" value="mine" ${follow ? "" : "checked"}><b>Choose my own</b><small>Pick a preset or any color. Only you see it.</small></label>
      </div>
      <div class="${follow ? "look-dim" : ""}">${swatches(MYPREFS.look || LOOK_DEFAULT, follow)}
        ${!follow && look.preset === "custom" ? `<div class="custom-row"><label for="look-color">Your color</label><input type="color" id="look-color" value="${esc(hexRgb(look.accent) ? look.accent : "#0f766e")}">
          <input class="text-input code-input" id="look-hex" value="${esc(look.accent)}" maxlength="7" aria-label="Color as a hex code" spellcheck="false">
          ${pal.adjusted ? `<span class="hint">Penny uses <b style="color:${pal.light}">${esc(pal.light)}</b> for text and buttons, a little darker than your color, so it stays easy to read (WCAG AA).</span>` : `<span class="hint ok-hint">Easy to read: ${contrast(pal.light, "#ffffff").toFixed(1)} to 1 contrast.</span>`}</div>` : ""}
        <div class="look-row"><span class="look-label">Background</span>${seg("bg", follow ? company.bg : (MYPREFS.look || {}).bg || "default", [["default", "Cool gray"], ["warm", "Warm paper"], ["cool", "Soft blue"]])}</div>
        <div class="look-row"><span class="look-label">Corners</span>${seg("corners", follow ? company.corners : (MYPREFS.look || {}).corners || "rounded", [["rounded", "Rounded"], ["square", "Square"]])}</div>
      </div>
    </section>
    <section class="card card-pad look-card"><h2>Comfort</h2><p class="hint">Always your own choice.</p>
      <div class="look-row"><span class="look-label">Mode</span>${seg("mode", f.mode, [["system", "Match my device"], ["light", "Light"], ["dark", "Dark"]])}</div>
      <div class="look-row"><span class="look-label">Text size</span>${seg("text", f.text, [["s", "Small"], ["m", "Default"], ["l", "Large"], ["xl", "Larger"]])}</div>
      <div class="look-row"><span class="look-label">Density</span>${seg("density", f.density, [["comfortable", "Comfortable"], ["compact", "Compact"]])}</div>
      <div class="look-row"><span class="look-label">Motion</span>${seg("motion", f.motion, [["system", "Match my device"], ["reduce", "Reduce motion"]])}</div>
    </section>
    <section class="card card-pad look-card look-preview" aria-label="Preview"><h2>Preview</h2>
      <div class="pv-row"><button class="btn btn-accent" type="button" tabindex="-1">Resolve hold</button><button class="btn" type="button" tabindex="-1">Reassign</button><a href="#/appearance" tabindex="-1">A link</a></div>
      <div class="pv-row">${badge("ENTER_INTACCT")}${badge("HOLD")}<span class="badge b-ready">${bIcon("redo")}Ready for recheck</span>${codeChip("OVERPO")}</div>
      <div class="table-wrap"><table class="data"><thead><tr><th>Vendor and invoice</th><th class="num">Amount</th></tr></thead><tbody><tr><td><span class="main-link">Pinecrest Building Supply Co</span><span class="sub">PBS-604418 · APINBOX_0001</span></td><td class="num">$15,102.07</td></tr></tbody></table></div>
    </section>
    ${can("rules") ? `<section class="card card-pad look-card"><h2>Company look (Admin)</h2>
      <p>Everyone who uses the company look sees this. Right now: <b>${esc(lookName(company))}</b>.</p>
      <div class="nb-actions"><button class="btn btn-accent" type="button" id="look-make-company" ${follow ? "disabled" : ""}>Make my colors the company look</button>
        <button class="btn" type="button" id="look-company-reset" ${company.preset === "teal" && company.bg === "default" && company.corners === "rounded" ? "disabled" : ""}>Back to Penny teal</button></div>
      ${follow ? `<p class="hint">Choose your own colors above first, then make them the company look.</p>` : ""}
      <p class="hint">Saved as the rule <code>display.theme</code>, with your reason, in the Rules change history and the audit trail. You can undo it there.</p></section>` : ""}`;
}
/** The Appearance page. */
function viewAppearance() {
  return `${head("Appearance", "Make Penny comfortable to look at. Changes show right away and are saved to your account.")}<p class="look-saved" id="look-saved" role="status" hidden></p><div id="look-page">${appearanceBody()}</div>`;
}
/** Redraw the Appearance page, keeping focus where it was. */
function paintAppearance() {
  const box = $("#look-page");
  if (!box) return;
  const focus = document.activeElement && (document.activeElement.dataset.preset || document.activeElement.dataset.v || document.activeElement.id);
  box.innerHTML = appearanceBody();
  try {
    const el = focus && (box.querySelector(`[data-preset="${CSS.escape(focus)}"]`) || box.querySelector(`[aria-checked="true"][data-v="${CSS.escape(focus)}"]`) || box.querySelector(`#${CSS.escape(focus)}`));
    if (el) el.focus();
  } catch (e) { /* focus is a nicety */ }
}
/** Change the look everyone starts with, after asking an Admin for a reason. */
function setCompanyLook(look, why) {
  const before = (RULES().display || {}).theme;
  openDialog(why, `New company look: <b>${esc(lookName(look))}</b>. People who follow the company look see it at once.`, noteField("Why are you changing it?", true, "For example: matches our brand colors."), "Save company look", (fd) => {
    const err = needNote(fd, 5); if (err) return err;
    if (record("rules.update", { changes: [{ path: "display.theme", before, after: look, label: "Company look" }], note: String(fd.get("note")).trim() })) { applyLook(); paintAppearance(); toast("Company look saved."); }
    return "";
  });
}
/** Wire every control on the Appearance page. */
function bindAppearance() {
  const box = $("#look-page");
  if (!box) return;
  box.addEventListener("click", (e) => {
    const p = e.target.closest("[data-preset]");
    if (p) return setLook({ follow: false, look: { preset: p.dataset.preset, ...(p.dataset.preset === "custom" && !(MYPREFS.look || {}).accent ? { accent: "#0f766e" } : {}) } });
    const f = e.target.closest("[data-feel]");
    if (f) {
      const k = f.dataset.feel, v = f.dataset.v;
      if (k === "bg" || k === "corners") return setLook({ follow: false, look: { ...(MYPREFS.follow !== false ? companyLook() : {}), [k]: v } });
      return setLook({ [k]: v });
    }
    if (e.target.closest("#look-make-company")) return setCompanyLook({ ...myLook() }, "Make this the company look");
    if (e.target.closest("#look-company-reset")) return setCompanyLook({ ...LOOK_DEFAULT }, "Go back to Penny teal");
  });
  box.addEventListener("change", (e) => {
    if (e.target.name === "follow") setLook(e.target.value === "company" ? { follow: true } : { follow: false, look: { ...companyLook(), ...(MYPREFS.look || {}) } });
    if (e.target.id === "look-color") setLook({ look: { preset: "custom", accent: e.target.value } });
  });
  box.addEventListener("input", (e) => {
    if (e.target.id === "look-hex" && /^#[0-9a-f]{6}$/i.test(e.target.value.trim())) setLook({ look: { preset: "custom", accent: e.target.value.trim().toLowerCase() } });
  });
}
