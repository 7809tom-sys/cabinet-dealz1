import { beforeEach, describe, expect, it, vi } from "vitest";

// Rule 9: master codes are stable. A catalog import may update an existing cabinet's fields, but it
// must never rename a master code, and a different code never silently merges into another master.
// FH and S codes are separate cabinets. An ADA spelling resolves to ADA-<code> (one master), and
// an import never deletes anything.
// WHY: codes are referenced by saved designs, orders, carts and aliases; renaming or deleting them
// breaks history. Fixtures only: an in-memory fake database, no live data.

type Row = Record<string, unknown>;
const store = vi.hoisted(() => ({
  cabinets: [] as Row[],
  aliases: [] as Row[],
  cabAliases: [] as Row[],
  skus: [] as Row[],
  styles: [{ id: 1, distributorId: 7, styleCode: "DEF" }] as Row[],
  inserts: [] as Array<{ table: string; values: Row }>,
  updates: [] as Array<{ table: string; set: Row }>,
  deletes: 0,
  nextId: 1000,
}));

vi.mock("../db", () => {
  const name = (table: unknown) => String((table as { _: { name?: string } })?._?.name ?? (table as Record<symbol, unknown>)[Symbol.for("drizzle:Name")] ?? "");
  const dataFor = (table: string): Row[] =>
    table === "cabinets" ? store.cabinets
    : table === "sku_master_aliases" ? store.aliases
    : table === "cabinet_aliases" ? store.cabAliases
    : table === "distributor_skus" ? store.skus
    : table === "door_styles" ? store.styles : [];
  const db = {
    select: () => ({
      from: (table: unknown) => {
        const rows = dataFor(name(table));
        const result = Promise.resolve(rows) as Promise<Row[]> & { where: () => unknown; limit: () => unknown };
        result.where = () => Object.assign(Promise.resolve(rows), { limit: () => Promise.resolve(rows.slice(0, 1)) });
        result.limit = () => Promise.resolve(rows.slice(0, 1));
        return result;
      },
    }),
    insert: (table: unknown) => ({
      values: async (values: Row) => {
        const t = name(table);
        store.inserts.push({ table: t, values });
        if (t === "cabinets") store.cabinets.push({ id: store.nextId++, catalogImageUrl: null, ...values });
        if (t === "sku_master_aliases") store.aliases.push(values);
        if (t === "cabinet_aliases") store.cabAliases.push(values);
        if (t === "distributor_skus") store.skus.push(values);
      },
    }),
    update: (table: unknown) => ({
      set: (set: Row) => {
        store.updates.push({ table: name(table), set });
        return { where: async () => undefined };
      },
    }),
    delete: () => {
      store.deletes += 1;
      return { where: async () => undefined };
    },
  };
  return { getDb: async () => db };
});

import { importPafProducts } from "../lib/catalogImportLogic";

const product = (code: string, extra: Row = {}) => ({ code, description: `Fixture ${code}`, category: "Base Cabinet", width: 12, height: 34.5, depth: 24, listPrice: 100, ...extra }) as never;
const createdCodes = () => store.inserts.filter((i) => i.table === "cabinets").map((i) => i.values.masterCode);

beforeEach(() => {
  store.cabinets = [
    { id: 1, masterCode: "B12", catalogImageUrl: null },
    { id: 2, masterCode: "B24", catalogImageUrl: null },
  ];
  store.aliases = [];
  store.cabAliases = [];
  store.skus = [];
  store.inserts = [];
  store.updates = [];
  store.deletes = 0;
  store.nextId = 1000;
});

describe("Rule 9: imports never rename, merge or delete master codes", () => {
  it("never deletes anything", async () => {
    await importPafProducts(7, [product("B12"), product("B99")], true);
    expect(store.deletes).toBe(0);
  });

  it("updating an existing code never changes its masterCode", async () => {
    await importPafProducts(7, [product("B12", { height: 34.75 })], true);
    const cabinetUpdates = store.updates.filter((u) => u.table === "cabinets");
    expect(cabinetUpdates.length).toBeGreaterThan(0);
    for (const update of cabinetUpdates) expect(update.set).not.toHaveProperty("masterCode");
    expect(createdCodes()).not.toContain("B12");
  });

  it("FH and S codes become their own masters, never merged into B12 or B24", async () => {
    await importPafProducts(7, [product("B12FH"), product("B24S")], true);
    expect(createdCodes()).toEqual(expect.arrayContaining(["B12FH", "B24S"]));
    expect(store.cabinets.find((c) => c.masterCode === "B12")).toBeTruthy();
    expect(store.cabinets.find((c) => c.masterCode === "B24")).toBeTruthy();
  });

  it("an unknown code creates one new master and leaves the others alone", async () => {
    const before = store.cabinets.map((c) => c.masterCode);
    await importPafProducts(7, [product("B33")], true);
    expect(createdCodes()).toEqual(["B33"]);
    for (const code of before) expect(store.cabinets.some((c) => c.masterCode === code)).toBe(true);
  });

  it("importing the same code twice creates it once", async () => {
    await importPafProducts(7, [product("B33"), product("B33")], true);
    expect(createdCodes()).toEqual(["B33"]);
  });

  it("an ADA spelling routes to ONE ADA-<code> master and keeps the supplier spelling as an alias", async () => {
    await importPafProducts(7, [product("B12ADA")], true);
    expect(createdCodes()).toEqual(["ADA-B12"]);
    expect(store.aliases.some((a) => a.aliasCode === "B12ADA" && a.masterCode === "ADA-B12")).toBe(true);
    expect(store.cabinets.find((c) => c.masterCode === "B12")).toBeTruthy(); // plain B12 untouched
  });

  it("an alias already routed to a different master is skipped for review, not re-pointed", async () => {
    store.aliases = [{ aliasCode: "B12ADA", masterCode: "SOME-OTHER-MASTER" }];
    const stats = await importPafProducts(7, [product("B12ADA")], true);
    expect(stats.skipped).toBe(1);
    expect(stats.errors.map((e) => e.code)).toContain("ADA_ALIAS_CONFLICT");
    expect(createdCodes()).toEqual([]);
    expect(store.aliases).toEqual([{ aliasCode: "B12ADA", masterCode: "SOME-OTHER-MASTER" }]);
  });
});
