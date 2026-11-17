import type { CharacterKey } from "@genshin-optimizer/gi/consts";
import type { RotationMember } from "@genshin-optimizer/gi/ui";
import { parseRotation } from "@genshin-optimizer/gi/ui";

export type SwapFragmentError = "notFound" | "repeated" | "emptyFragment";

export type SwapFragmentResult =
  | {
      ok: true;
      text: string;
      opener: string;
      where: "text" | "opener";
      /** The step that was replaced, as written (trimmed) */
      replaced: string;
      /** The step put in its place */
      inserted: string;
    }
  | { ok: false; error: SwapFragmentError; count: number };

/** A rotation cut at its `->`: the raw pieces and the separators between them, kept to rebuild it */
const cut = (s: string) => s.split(/(->)/);

/** The steps (even indexes of `cut`) in which `out` acts, by the rotation parser's own matching */
function stepsOf(
  s: string,
  out: CharacterKey,
  names: RotationMember[],
): number[] {
  return cut(s).flatMap((raw, i) =>
    i % 2 === 0 && parseRotation(raw, names).steps[0]?.characterKey === out
      ? [i]
      : [],
  );
}

/**
 * Replaces the leaving member's single step of a written rotation (the opener counts too) with the
 * entering member's fragment, leaving every other step, separator and space as written.
 */
export function swapFragment({
  text,
  opener,
  names,
  out,
  inName,
  fragment,
}: {
  text: string;
  opener: string;
  names: RotationMember[];
  out: CharacterKey;
  inName: string;
  fragment: string;
}): SwapFragmentResult {
  const frag = fragment.trim();
  if (!frag) return { ok: false, error: "emptyFragment", count: 0 };
  const inText = stepsOf(text, out, names);
  const inOpener = stepsOf(opener, out, names);
  const count = inText.length + inOpener.length;
  if (count === 0) return { ok: false, error: "notFound", count };
  if (count > 1) return { ok: false, error: "repeated", count };

  const where = inText.length ? "text" : "opener";
  const parts = cut(where === "text" ? text : opener);
  const i = (where === "text" ? inText : inOpener)[0];
  const replaced = parts[i].trim();
  const inserted = `${inName.trim()} ${frag}`;
  const [, lead, , trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(parts[i]) ?? [];
  parts[i] = `${lead ?? ""}${inserted}${trail ?? ""}`;
  const rebuilt = parts.join("");
  return {
    ok: true,
    text: where === "text" ? rebuilt : text,
    opener: where === "opener" ? rebuilt : opener,
    where,
    replaced,
    inserted,
  };
}
