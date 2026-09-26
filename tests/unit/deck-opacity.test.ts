/**
 * Discover deck: a card must never show the card beneath it, and the deck must be able to hand the next card over
 * without remounting it (docs/ARCHITECTURE.md §12.18, docs/DESIGN_SYSTEM.md §34).
 *
 * The regression this guards: a locked second photo rendered as a 44 px strip at the top of the card, because
 * LockedPhoto's own `relative` and the card's `absolute inset-0` both reached one element through `cn` (which joins,
 * never resolves) and `relative` won in the stylesheet. The rest of the card was its 6 %-tint background, and the
 * next member's photo showed through it. The same conflict blanked the full-profile hero photo.
 *
 * These render the real components to static markup (no DOM needed) and check what the browser would be given.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { encode } from "blurhash";
import { blurhashAverageColor, blurhashDataUrl } from "@/lib/blurhash-image";
import { LockedPhoto } from "@/components/ui/locked-photo";
import { ProfileCard } from "@/components/features/discovery/profile-card";
import { FullProfile } from "@/components/features/discovery/full-profile";
import { SwipeDeck, cardTransform, nextCardScale, photosToPreload } from "@/components/features/discovery/swipe-deck";
import type { CardProfile, DeckCard } from "@/components/features/discovery/types";

// A real 4×3 hash of a mostly-green image, the shape every production hash has.
const GREEN = (() => {
  const w = 8, h = 8, px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set([30 + (i % 8) * 4, 190, 60, 255], i * 4);
  return encode(px, w, h, 4, 3);
})();

function card(id: string, photos: CardProfile["photos"]): DeckCard {
  return { id, handle: id, name: `Member ${id}`, age: 30, verified: false, location: "Malé", occupation: null, intent: "DATING", interests: [], photos, bio: null, education: null, languages: [], heightCm: null, prompts: [], isActiveNow: null };
}
const open = (id: string, n = 0) => ({ url: `https://cdn.test/${id}/${n}.webp?sig=1`, thumbUrl: `https://cdn.test/${id}/${n}-thumb.webp?sig=1`, blurhash: GREEN });
const locked = () => ({ locked: true, blurhash: GREEN });

const html = (el: ReactElement) => renderToStaticMarkup(el);
const POSITIONS = ["static", "fixed", "absolute", "relative", "sticky"];
/** Every class attribute in the markup that carries more than one position utility. */
function positionConflicts(markup: string): string[] {
  return [...markup.matchAll(/class="([^"]*)"/g)].map((m) => m[1]!).filter((cls) => cls.split(/\s+/).filter((c) => POSITIONS.includes(c)).length > 1);
}
/** The opening tag of the first element whose attributes match. */
const tag = (markup: string, attr: RegExp) => markup.match(new RegExp(`<[a-z]+[^>]*${attr.source}[^>]*>`))?.[0] ?? null;

describe("blurhash as a first-frame image", () => {
  it("reads the average colour straight from the hash", () => {
    const rgb = blurhashAverageColor(GREEN);
    expect(rgb).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    const [r, g, b] = rgb!.match(/\d+/g)!.map(Number);
    expect(g).toBeGreaterThan(r!);
    expect(g).toBeGreaterThan(b!);
  });

  it("decodes to a bitmap data URL of the requested size", () => {
    const url = blurhashDataUrl(GREEN, 32, 42)!;
    expect(url.startsWith("data:image/bmp;base64,")).toBe(true);
    const bytes = Buffer.from(url.split(",")[1]!, "base64");
    expect(bytes.subarray(0, 2).toString("latin1")).toBe("BM");
    expect(bytes.readInt32LE(18)).toBe(32);
    expect(bytes.readInt32LE(22)).toBe(42);
    expect(bytes.length).toBe(54 + 96 * 42);
  });

  it("returns null rather than throwing for missing or malformed hashes", () => {
    for (const bad of [null, undefined, "", "not a hash", "LKO2?U%2Tw=w]~RBVZRi};RPxu"]) {
      expect(blurhashAverageColor(bad)).toBeNull();
      expect(blurhashDataUrl(bad)).toBeNull();
    }
  });
});

describe("a locked photo is opaque and fills its card", () => {
  it("covers the card when asked to fill, with no competing position", () => {
    const m = html(createElement(LockedPhoto, { blurhash: GREEN, fill: true, compact: true }));
    const shell = tag(m, /role="img"/)!;
    expect(shell).toMatch(/class="absolute inset-0 /);
    expect(positionConflicts(m)).toEqual([]);
  });

  it("paints an opaque base and the hash in the first frame — no canvas, no effect to wait for", () => {
    const m = html(createElement(LockedPhoto, { blurhash: GREEN, fill: true, compact: true }));
    expect(tag(m, /role="img"/)).toMatch(/style="background-color:rgb\(\d+, \d+, \d+\)"/);
    expect(m).toContain("url(data:image/bmp;base64,");
    expect(m).not.toContain("<canvas");
  });

  it("falls back to the opaque card base without a hash", () => {
    const m = html(createElement(LockedPhoto, { blurhash: null, fill: true }));
    expect(tag(m, /role="img"/)).toMatch(/bg-card-base/);
  });

  it("uses no backdrop-filter or filter, which would be recomputed on every frame of a drag", () => {
    const m = html(createElement(LockedPhoto, { blurhash: GREEN, fill: true, title: "3 more photos", onUnlock: () => {} }));
    expect(m).not.toMatch(/backdrop-blur|backdrop-filter|filter:|blur-/);
    expect(m).toContain("Unlock with Plus");
  });

  it("never carries a url, key or anything but the hash", () => {
    const m = html(createElement(LockedPhoto, { blurhash: GREEN, fill: true }));
    expect(m).not.toMatch(/https?:|<img/);
  });
});

describe("a deck card is opaque whatever photo it is on", () => {
  const profile = card("a", [open("a"), locked(), locked()]);

  for (const photoIndex of [0, 1, 2]) {
    it(`photo ${photoIndex + 1}: opaque, isolated base and a full-size photo layer`, () => {
      const m = html(createElement(ProfileCard, { profile, photoIndex, fill: true }));
      const root = m.match(/^<div[^>]*>/)![0];
      expect(root).toContain("bg-card-base");
      expect(root).toContain("isolate");
      expect(root).not.toContain("bg-aqua-soft");
      expect(positionConflicts(m)).toEqual([]);
      if (photoIndex > 0) expect(tag(m, /role="img"/)).toMatch(/class="absolute inset-0 /);
    });
  }

  it("keeps the member's own small photo underneath the full one, never an empty frame", () => {
    const m = html(createElement(ProfileCard, { profile, fill: true }));
    expect(m.match(/^<div[^>]*>/)![0]).toContain("a/0-thumb.webp");
  });

  it("has no backdrop-filter anywhere on the moving card", () => {
    expect(html(createElement(ProfileCard, { profile, fill: true }))).not.toMatch(/backdrop-blur|backdrop-filter/);
  });

  it("reads its stamps from the deck's CSS variables unless told otherwise", () => {
    const m = html(createElement(ProfileCard, { profile, fill: true }));
    expect(m).toContain("opacity:var(--like-stamp, 0)");
    expect(m).toContain("opacity:var(--pass-stamp, 0)");
    const shown = html(createElement(ProfileCard, { profile, likeOpacity: 1 }));
    expect(shown).toContain("opacity:1");
  });

  it("tile variant (Likes grid) has no position conflicts either", () => {
    expect(positionConflicts(html(createElement(ProfileCard, { profile, variant: "tile", fill: true })))).toEqual([]);
  });
});

describe("the full profile's photos fill their frames", () => {
  it("hero and inline photos carry one position each", () => {
    const m = html(createElement(FullProfile, { profile: card("a", [open("a"), locked(), open("a", 2)]), onClose: () => {}, onUnlockPhotos: () => {} }));
    expect(positionConflicts(m)).toEqual([]);
    expect(m).toContain("a/0.webp");
  });
});

describe("the card tokens are opaque", () => {
  const css = readFileSync(path.resolve(import.meta.dirname, "../../src/styles/tokens.css"), "utf8");
  it("--card-base is a solid colour in light and dark", () => {
    const values = [...css.matchAll(/--card-base:\s*([^;]+);/g)].map((m) => m[1]!.trim());
    expect(values).toHaveLength(2);
    for (const v of values) expect(v).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("the deck renders the next card, keyed and ready", () => {
  const profiles = [card("a", [open("a"), locked()]), card("b", [open("b")]), card("c", [open("c")]), card("d", [open("d")])];
  const m = html(createElement(SwipeDeck, { profiles, onLike: () => {}, onPass: () => {} }));

  it("renders exactly two cards: the next underneath (first), the current on top (last)", () => {
    const b = m.indexOf("b/0.webp"), a = m.indexOf("a/0.webp");
    expect(b).toBeGreaterThan(-1);
    expect(a).toBeGreaterThan(b);
    expect(m).not.toContain("c/0.webp");
    expect(m).not.toContain("d/0.webp");
  });

  it("keeps the card underneath out of reach: hidden from assistive tech, inert, untouchable", () => {
    const under = tag(m, /aria-hidden="true" inert=""/)!;
    expect(under).toContain("pointer-events-none");
  });

  it("loads both photos eagerly, the top one first", () => {
    const imgs = [...m.matchAll(/<img[^>]*>/g)].map((x) => x[0]);
    const next = imgs.find((i) => i.includes("b/0.webp"))!;
    const top = imgs.find((i) => i.includes("a/0.webp"))!;
    expect(next).toContain('loading="eager"');
    expect(top).toContain('loading="eager"');
    expect(top).toContain('fetchPriority="high"');
  });

  it("puts no transform or transition in markup: movement is written by the deck, per frame, outside React", () => {
    const top = tag(m, /role="group"/)!;
    expect(top).not.toMatch(/style=/);
    expect(top).toContain("will-change-transform");
  });
});

describe("deck motion and preloading", () => {
  it("moves the card with compositor-only transforms and nothing at rest", () => {
    expect(cardTransform(0, 0)).toBe("");
    expect(cardTransform(90, -10)).toBe("translate3d(90px, -10px, 0) rotate(5deg)");
  });

  it("grows the card underneath from .95 to 1 over 150 px, and no further", () => {
    expect(nextCardScale(0)).toBe(0.95);
    expect(nextCardScale(-75)).toBeCloseTo(0.975, 5);
    expect(nextCardScale(150)).toBe(1);
    expect(nextCardScale(600)).toBe(1);
  });

  it("preloads only the current member's other open photos and the main photo after the next card", () => {
    const current = card("a", [open("a"), open("a", 1), locked()]);
    const after = card("c", [open("c"), open("c", 1)]);
    expect(photosToPreload(current, after)).toEqual(["https://cdn.test/a/1.webp?sig=1", "https://cdn.test/c/0.webp?sig=1"]);
  });

  it("never preloads a locked photo (there is no url to preload)", () => {
    expect(photosToPreload(card("a", [open("a"), locked()]), card("c", [locked()]))).toEqual([]);
    expect(photosToPreload(null, null)).toEqual([]);
  });
});
