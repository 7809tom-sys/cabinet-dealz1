import { describe, expect, it } from "vitest";
import { catalogFillerForGap, catalogFillerSuggestion, isCatalogFiller, type CatalogFillerCandidate } from "@/lib/catalogFiller";

// Rule 15: only real filler stock is ever auto-selected to cover a gap. Cabinets, trim, panels,
// toe kick, dishwasher panels, decorative legs and hardware are never substituted into a seam.
// A gap of 3" or less is cut from, and billed as, one real 3" filler. If no real filler exists,
// the answer is "none", never a cabinet or an invented SKU.
// WHY: a wrong auto-pick would bill and install the wrong part.
// NOTE: the code decides by filler classification only. It has no per-supplier restriction, so
// "Cabinetdealz fillers only" is enforced by which catalog rows are offered, not by this function.
// Fixtures only: no database, no live distributor data.

const item = (
  masterCode: string, description: string, category: string, width: number, depth = 24, height = 34.5,
): CatalogFillerCandidate => ({
  id: 1, masterCode, description, category, subCategory: "", width, height, depth, catalogImageUrl: null,
} as unknown as CatalogFillerCandidate);

const baseFiller = item("BF3", "Base Filler 3 x 34.5", "Filler", 3);
const wallFiller = item("WF3", "Wall Filler 3 x 30", "Filler", 3, 12, 30);
const wideFiller = item("BF6", "Base Filler 6 x 34.5", "Filler", 6);

const notFillers = [
  item("B12", "Base Cabinet 12", "Base", 12),
  item("W1230", "Wall Cabinet 12x30", "Wall", 12, 12, 30),
  item("CROWN8", "Crown Molding", "Molding", 96),
  item("VAL36", "Valance 36", "Accessories", 36),
  item("TK96", "Toe Kick 96", "Trim", 96),
  item("REP2496", "Refrigerator End Panel", "Accessories", 24),
  item("DWP24", "Dishwasher End Panel", "Filler", 24),
  item("FLDL4", "Decorative leg", "Filler", 4),
  item("HW1", "Pull 3 inch handle", "Hardware", 3),
];

describe("Rule 15: only real filler stock covers a gap", () => {
  it.each(notFillers.map((x) => [x.masterCode, x] as const))("%s is never classified as a filler", (_code, candidate) => {
    expect(isCatalogFiller(candidate)).toBe(false);
  });

  it("never picks a cabinet, trim, panel, toe kick or hardware to cover a gap", () => {
    for (const gap of [0.5, 1, 2, 3, 5]) {
      const pick = catalogFillerForGap([...notFillers], gap, "base");
      expect(pick, `gap ${gap}" must not be covered by non-filler stock`).toBeNull();
    }
  });

  it("returns none rather than inventing a SKU when no filler exists", () => {
    expect(catalogFillerSuggestion(notFillers, 2, "base")).toBeNull();
    expect(catalogFillerSuggestion([], 2, "base")).toBeNull();
  });

  it("ignores invalid gap sizes", () => {
    for (const gap of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(catalogFillerForGap([baseFiller], gap as number, "base")).toBeNull();
    }
  });

  it("covers a 1 inch gap by cutting a real 3 inch filler, keeping its SKU", () => {
    const suggestion = catalogFillerSuggestion([...notFillers, baseFiller], 1, "base");
    expect(suggestion?.candidate.masterCode).toBe("BF3");
    expect(suggestion?.installedWidth).toBe(1);
    expect(suggestion?.catalogWidth).toBe(3);
    expect(suggestion?.trimAmount).toBe(2);
    expect(suggestion?.description).toContain('cut to 1"');
  });

  it("does not use a wider filler for a seam of 3 inches or less", () => {
    expect(catalogFillerForGap([wideFiller], 2, "base")).toBeNull();
    expect(catalogFillerForGap([wideFiller, baseFiller], 2, "base")?.masterCode).toBe("BF3");
  });

  it("uses a wider filler only for a seam wider than 3 inches", () => {
    expect(catalogFillerForGap([baseFiller, wideFiller], 5, "base")?.masterCode).toBe("BF6");
  });

  it("prefers the 12 inch deep filler for wall runs and the 24 inch filler for base runs", () => {
    const pool = [baseFiller, wallFiller];
    expect(catalogFillerForGap(pool, 2, "wall")?.masterCode).toBe("WF3");
    expect(catalogFillerForGap(pool, 2, "base")?.masterCode).toBe("BF3");
  });

  it("is deterministic: the same inputs always give the same pick", () => {
    const pool = [wideFiller, wallFiller, baseFiller, ...notFillers];
    const first = catalogFillerForGap(pool, 2, "base")?.masterCode;
    for (let index = 0; index < 5; index += 1) {
      expect(catalogFillerForGap([...pool].reverse(), 2, "base")?.masterCode).toBe(first);
    }
  });
});
