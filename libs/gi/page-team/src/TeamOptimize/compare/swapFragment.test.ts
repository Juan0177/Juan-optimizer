import type { RotationMember } from "@genshin-optimizer/gi/ui";
import { describe, expect, it } from "vitest";
import { swapFragment } from "./swapFragment";

const names: RotationMember[] = [
  { characterKey: "Anastasya", name: "Anastasya" },
  { characterKey: "YaeMiko", name: "Yae Miko" },
  { characterKey: "Odette", name: "Odette" },
  { characterKey: "Danica", name: "Danica" },
];
const text =
  "Danica E -> Odette E E -> Yae Miko E E E -> Danica Q -> Anastasya hE N2 Q N5 E E E N2";
const swapped =
  "Danica E -> Odette E E -> Mitya E Q -> Danica Q -> Anastasya hE N2 Q N5 E E E N2";
const base = {
  text,
  opener: "",
  names,
  out: "YaeMiko" as const,
  inName: "Mitya",
  fragment: "E Q",
};

describe("swapFragment", () => {
  it("replaces the single step", () => {
    const r = swapFragment(base);
    expect(r).toMatchObject({
      ok: true,
      text: swapped,
      replaced: "Yae Miko E E E",
      where: "text",
    });
  });
  it("matches nicknames", () => {
    const r = swapFragment({ ...base, text: text.replace("Yae Miko", "Yae") });
    expect(r).toMatchObject({
      ok: true,
      text: swapped,
      replaced: "Yae E E E",
    });
  });
  it("notFound", () => {
    expect(swapFragment({ ...base, out: "Mitya" as never })).toEqual({
      ok: false,
      error: "notFound",
      count: 0,
    });
  });
  it("repeated in the text", () => {
    const r = swapFragment({ ...base, text: `${text} -> Yae Miko E` });
    expect(r).toEqual({ ok: false, error: "repeated", count: 2 });
  });
  it("repeated across opener and text", () => {
    const r = swapFragment({ ...base, opener: "Yae Miko E -> Danica E" });
    expect(r).toEqual({ ok: false, error: "repeated", count: 2 });
  });
  it("opener only", () => {
    const noYae = "Danica E -> Odette E E -> Danica Q";
    const r = swapFragment({
      ...base,
      text: noYae,
      opener: "Yae Miko E -> Danica E",
    });
    expect(r).toMatchObject({
      ok: true,
      where: "opener",
      opener: "Mitya E Q -> Danica E",
      text: noYae,
    });
  });
  it("emptyFragment", () => {
    expect(swapFragment({ ...base, fragment: "  " })).toMatchObject({
      ok: false,
      error: "emptyFragment",
    });
  });
});
