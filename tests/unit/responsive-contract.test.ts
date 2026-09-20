import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * The responsive contract, checked at build time (docs/DESIGN_SYSTEM.md §33).
 *
 * The Playwright audit in scripts/responsive-audit.mjs is the real check — it measures a running app. This suite
 * guards the two things that can regress in a plain source edit and that a reviewer will not spot: a density pass
 * lowering the field step below the iOS zoom threshold, and someone reaching for `maximum-scale` to stop the zoom
 * instead of fixing the type size. Both have a cost the diff does not show.
 */
const ROOT = path.resolve(import.meta.dirname, "../..");
const GLOBALS = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");

/** The iOS Safari threshold. A focused control below this zooms the page and leaves it pannable. */
const IOS_FIELD_FLOOR_PX = 16;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** Every `--text-*` step and its px size, so the test reads the scale rather than hard-coding a list of names. */
function typeScale(): Map<string, number> {
  const steps = new Map<string, number>();
  for (const [, name, px] of GLOBALS.matchAll(/--text-([a-z0-9-]+):\s*([\d.]+)px;/g)) {
    steps.set(`text-${name}`, Number(px));
  }
  return steps;
}

/** How many `{` blocks enclose `index` — 0 means top level, so outside every `@layer` and every at-rule. */
function braceDepthAt(css: string, index: number): number {
  let depth = 0;
  let inComment = false;
  for (let i = 0; i < index; i++) {
    if (inComment) {
      if (css[i] === "*" && css[i + 1] === "/") inComment = false;
      continue;
    }
    if (css[i] === "/" && css[i + 1] === "*") inComment = true;
    else if (css[i] === "{") depth++;
    else if (css[i] === "}") depth--;
  }
  return depth;
}

/** The attribute text of every editable element in a file, paired with its line number. */
function editableTags(source: string): { tag: string; line: number }[] {
  const found: { tag: string; line: number }[] = [];
  for (const m of source.matchAll(/<(input|textarea|select)\b/g)) {
    const start = m.index;
    // Walk to the end of the opening tag, ignoring `>` that sits inside a JSX expression or a string.
    let depth = 0;
    let quote: string | null = null;
    let end = start;
    for (let i = start; i < source.length; i++) {
      const c = source[i];
      if (quote) {
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) {
        end = i;
        break;
      }
    }
    found.push({ tag: source.slice(start, end + 1), line: source.slice(0, start).split("\n").length });
  }
  return found;
}

describe("the iOS field floor", () => {
  const scale = typeScale();

  it("defines a named field step at or above the iOS zoom threshold", () => {
    const field = scale.get("text-field");
    expect(field, "--text-field is missing from the type scale").toBeDefined();
    expect(field).toBeGreaterThanOrEqual(IOS_FIELD_FLOOR_PX);
  });

  it("enforces the floor outside @layer, so no utility class can undercut it", () => {
    // Tailwind utilities live in `@layer utilities`; unlayered CSS beats every layer. A rule inside a layer would
    // lose to a stray `text-body` on an <input>, which is exactly how this shipped broken the first time.
    //
    // Checked by brace depth rather than by position in the file: "after the last @layer" would pass for a floor
    // sitting INSIDE a trailing layer, and fail for a correct floor that simply has a layer written below it.
    // globals.css has two such rules: `font: inherit` inside @layer base, and the floor itself at top level.
    const rules = [...GLOBALS.matchAll(/input,\s*\n\s*textarea,\s*\n\s*select\s*\{([^}]*)\}/g)];
    const unlayered = rules.filter((m) => braceDepthAt(GLOBALS, m.index) === 0);
    expect(unlayered.length, "the unlayered input/textarea/select floor is gone or duplicated").toBe(1);
    const [floor] = unlayered;
    expect(floor![1]).toContain("var(--text-field)");
  });

  it("has no editable control pinned to a step below the floor", () => {
    const tooSmall = [...scale].filter(([, px]) => px < IOS_FIELD_FLOOR_PX).map(([name]) => name);
    const offenders: string[] = [];
    for (const file of sourceFiles(path.join(ROOT, "src"))) {
      for (const { tag, line } of editableTags(readFileSync(file, "utf8"))) {
        // A `placeholder:text-caption` styles the placeholder's colour token, not the control's size.
        const classes = tag.replace(/placeholder:[\w[\]./-]+/g, "");
        for (const step of tooSmall) {
          if (new RegExp(`(?<![\\w-])${step}(?![\\w-])`).test(classes)) {
            offenders.push(`${path.relative(ROOT, file)}:${line} uses ${step}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("user zoom", () => {
  it("is never disabled anywhere in the app", () => {
    // Suppressing zoom also stops the iOS focus-zoom, which makes it a tempting shortcut. It is not one: it takes
    // pinch-to-zoom away from anyone who needs to magnify. The field step is the fix.
    const banned = /maximum-scale|user-scalable|maximumScale|userScalable/;
    const offenders = sourceFiles(path.join(ROOT, "src"))
      .concat(path.join(ROOT, "src/app/globals.css"))
      .filter((f) => {
        const s = readFileSync(f, "utf8");
        // The globals.css comment names them to say "do not add them"; a real declaration has a value.
        return banned.test(s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""));
      })
      .map((f) => path.relative(ROOT, f));
    expect(offenders).toEqual([]);
  });
});
