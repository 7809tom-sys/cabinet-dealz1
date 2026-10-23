import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDesignCabinetCartLines } from "./designCartLines";
import type { PlacedCabinet } from "@/lib/design";

// Rules 1 and 2. WHY: customers were locked out of checkout and placed wall cabinets
// silently vanished from the cart. Anything in the Designer must reach the cart; only
// final order submission may reject an unpriced line. Fixtures only, no live data.

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const cartSource = read("client/src/pages/Cart.tsx");
const cartContextSource = read("client/src/contexts/CartContext.tsx");

function cab(uid: string, masterCode: string, placement: string, category: string, id: number): PlacedCabinet {
  return { uid, cabinetId: id, masterCode, description: masterCode, category, placement, x: 0, y: 0, width: 24, depth: 24, rotation: 0 } as unknown as PlacedCabinet;
}

const placed = [
  cab("b1", "B24", "base", "Base", 1),
  cab("b2", "B24", "base", "Base", 1), // duplicate code: must merge into qty 2, not drop
  cab("b3", "SB36", "base", "Base", 2),
  cab("w1", "W2430", "wall", "Wall", 3), // the wall cabinet that once vanished
  cab("w2", "W362424", "wall", "Wall", 4),
  cab("w3", "W3030", "wall", "Wall", 5),
  cab("t1", "T1884", "tall", "Tall", 6),
  cab("v1", "VSB30", "base", "Vanity", 7),
];

const build = (priceFor: (c: PlacedCabinet) => number | null) =>
  buildDesignCabinetCartLines({
    placed,
    styleId: 101,
    distributorId: 11,
    tier: "homeowner" as never,
    styleNameById: new Map([[101, "Fixture Style"]]),
    unitPriceFor: priceFor,
  });

const totalQty = (lines: Array<{ qty: number }>) => lines.reduce((sum, line) => sum + line.qty, 0);

describe("Rule 2: every placed sellable cabinet reaches the cart exactly once", () => {
  it("keeps all placed units when every price is known", () => {
    const lines = build(() => 100);
    expect(totalQty(lines)).toBe(placed.length);
    expect(lines.every((line) => line.unitPrice === 100)).toBe(true);
  });

  it("keeps wall cabinets whose price is pending, flagged rather than dropped", () => {
    const lines = build((c) => (c.placement === "wall" ? null : 100));
    expect(totalQty(lines)).toBe(placed.length);
    const walls = lines.filter((line) => ["W2430", "W362424", "W3030"].includes(line.masterCode));
    expect(walls).toHaveLength(3);
    for (const wall of walls) {
      expect(wall.unitPrice).toBeNull();
      expect(wall.priceLocked).toBeUndefined(); // never locked at a fake price
    }
  });

  it("keeps every unit even if no price at all is known", () => {
    const lines = build(() => null);
    expect(totalQty(lines)).toBe(placed.length);
  });

  it("never invents a zero-dollar price", () => {
    const lines = build(() => 0);
    expect(lines.every((line) => line.unitPrice == null)).toBe(true);
    expect(totalQty(lines)).toBe(placed.length);
  });

  it("merges identical cabinets into one line with the right quantity", () => {
    const lines = build(() => 100);
    expect(lines.find((line) => line.masterCode === "B24")?.qty).toBe(2);
  });
});

describe("Rule 1: the cart is never locked", () => {
  it("the checkout handler only ignores an empty cart and has no other early exit", () => {
    const start = cartSource.indexOf("const requestOrder = () => {");
    const end = cartSource.indexOf("navigate(", start);
    const body = cartSource.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(body.match(/\breturn\b/g)?.length).toBe(1);
    expect(body).toContain("if (items.length === 0) return;");
    expect(body).not.toMatch(/toast\.(error|warning)/);
  });

  it("the checkout button has no disabled condition", () => {
    const start = cartSource.indexOf("onClick={requestOrder}");
    const end = cartSource.indexOf("</Button>", start);
    expect(start).toBeGreaterThan(-1);
    expect(cartSource.slice(start - 300, end)).not.toMatch(/disabled\s*=/);
  });

  it("the cart context accepts every item without conflict or rejection", () => {
    const start = cartContextSource.indexOf("const addItem = (item: CartItem): AddItemResult => {");
    const end = cartContextSource.indexOf("const replaceWithDesignItems", start);
    // Strip // comments: the code keeps a historical note mentioning the old conflict call.
    const body = cartContextSource.slice(start, end).replace(/\/\/[^\n]*/g, "");
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain("return { ok: true };");
    expect(body).not.toContain("ok: false");
    expect(body).not.toContain("setSupplierConflict({");
  });

  it("an unpriced cart line does not block navigation to Order Review", () => {
    expect(cartSource).not.toMatch(/unitPrice\s*==\s*null[^\n]*disabled/);
    expect(cartSource).not.toMatch(/disabled[^\n]*unitPrice\s*==\s*null/);
  });
});
