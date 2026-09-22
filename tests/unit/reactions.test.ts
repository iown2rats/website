import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EMPTY_REACTIONS, isReactionKey, reactionGlyph, reactionLabel, REACTIONS, summarizeReactions } from "@/lib/reactions";

/*
 * src/lib/reactions.ts is PURE on purpose — a client component that transitively reaches `@/lib/db` fails the
 * production build — which means its keys are a hand-written mirror of the `ReactionEmoji` enum in
 * prisma/schema.prisma rather than an import of it. A mirror that nothing checks is the exact shape of the bug
 * that took the Android shell down for a night: a type this repository wrote itself, which the compiler therefore
 * believed. So the schema is read as text and compared.
 */
describe("the reaction vocabulary mirrors the database enum", () => {
  it("has the same values, in the same order, as ReactionEmoji", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const block = /enum ReactionEmoji \{([^}]*)\}/.exec(schema);
    expect(block, "ReactionEmoji not found in schema.prisma").not.toBeNull();
    const values = block![1]!
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, "").trim())
      .filter((line) => line.length > 0 && !line.startsWith("///"));

    // Order matters as well as membership: it is the order the picker draws and the order summaries group in.
    expect(REACTIONS.map((r) => r.key)).toEqual(values);
  });

  it("is the six the brief asked for, as glyphs: ❤️ 😂 😮 😢 👍 🔥", () => {
    expect(REACTIONS.map((r) => r.glyph)).toEqual(["❤️", "😂", "😮", "😢", "👍", "🔥"]);
    // Every one needs a label: it is the accessible name of a control whose visible content is an emoji.
    expect(REACTIONS.every((r) => r.label.length > 0)).toBe(true);
  });

  it("accepts only those six, whatever it is handed", () => {
    for (const r of REACTIONS) expect(isReactionKey(r.key)).toBe(true);
    for (const bad of ["SHRUG", "heart", "❤️", "", null, undefined, 1, {}, ["HEART"]]) {
      expect(isReactionKey(bad), String(bad)).toBe(false);
    }
  });

  it("never throws in render on a value it does not know", () => {
    // A client that somehow received an unknown key must draw something and carry on; a thrown error in a bubble
    // would take the screen down, which is a lesson this codebase has already paid for.
    expect(reactionGlyph("HEART")).toBe("❤️");
    expect(reactionGlyph("WHAT")).toBe("•");
    expect(reactionLabel("WHAT")).toBe("reaction");
  });
});

describe("summarizing reactions", () => {
  const viewer = "me";

  it("groups by emoji, counts, and marks the viewer's own", () => {
    const rows = [
      { emoji: "HEART", userId: "a" },
      { emoji: "HEART", userId: viewer },
      { emoji: "FIRE", userId: "b" },
    ];
    expect(summarizeReactions(rows, viewer)).toEqual({
      groups: [
        { emoji: "HEART", count: 2, mine: true },
        { emoji: "FIRE", count: 1, mine: false },
      ],
      total: 3,
      mine: "HEART",
    });
  });

  it("orders groups by the picker's order, not by count", () => {
    // Emoji that re-order themselves as counts change are hard to read and impossible to aim at on a phone.
    const rows = [
      { emoji: "FIRE", userId: "a" },
      { emoji: "FIRE", userId: "b" },
      { emoji: "FIRE", userId: "c" },
      { emoji: "HEART", userId: "d" },
    ];
    expect(summarizeReactions(rows, viewer).groups.map((g) => g.emoji)).toEqual(["HEART", "FIRE"]);
  });

  it("reports at most one reaction as the viewer's own", () => {
    const rows = [{ emoji: "HEART", userId: viewer }, { emoji: "LAUGH", userId: "x" }];
    const summary = summarizeReactions(rows, viewer);
    expect(summary.groups.filter((g) => g.mine)).toHaveLength(1);
    expect(summary.mine).toBe("HEART");
  });

  it("drops rows outside the set rather than rendering them", () => {
    const summary = summarizeReactions([{ emoji: "SHRUG", userId: "a" }, { emoji: "HEART", userId: "b" }], viewer);
    expect(summary).toEqual({ groups: [{ emoji: "HEART", count: 1, mine: false }], total: 1, mine: null });
  });

  it("is empty for no rows, and matches the shared empty value", () => {
    expect(summarizeReactions([], viewer)).toEqual(EMPTY_REACTIONS);
    expect(EMPTY_REACTIONS).toEqual({ groups: [], total: 0, mine: null });
  });
});
