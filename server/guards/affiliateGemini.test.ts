import { beforeEach, describe, expect, it, vi } from "vitest";

// Rule 27: an affiliate may run Gemini image generation ONLY on a saved plan that belongs to
// their own storefront. An admin keeps the isolated snapshot flow. Everyone else is refused.
// WHY: results are saved to the affiliate's Image Cabinet and promoted to their style's room
// scene; another affiliate's plan or an unsaved plan must never be reachable.
// Fixtures only: fake database, fake affiliate lookup, fake Gemini config. No network.

const state = vi.hoisted(() => ({
  design: null as null | Record<string, unknown>,
  access: null as null | { affiliateId: number; accessDesigner: boolean },
}));

vi.mock("../db", () => {
  const rows = () => (state.design ? [state.design] : []);
  const chain: Record<string, unknown> = {};
  const thenable = () => Object.assign(Promise.resolve(rows()), chain);
  for (const key of ["from", "where", "orderBy", "innerJoin", "leftJoin"]) chain[key] = () => thenable();
  chain.limit = () => Promise.resolve(rows());
  return { getDb: async () => ({ select: () => thenable() }) };
});

vi.mock("../lib/affiliateAccess", () => ({
  resolveAffiliateAccess: async () => state.access,
}));

vi.mock("../lib/geminiImageProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/geminiImageProvider")>()),
  isGeminiImageConfigured: () => true,
}));

import { designPhotoRendersRouter } from "../routers/designPhotoRenders";
import type { TrpcContext } from "../_core/context";

const HEX64 = "a".repeat(64);
const roles = ["cabinet", "countertop", "flooring", "backsplash", "faucet", "sink"] as const;

function input(designId: number) {
  return {
    sceneSignature: "fixture-scene-signature-0001",
    sceneImageDataUrl: `data:image/jpeg;base64,${"A".repeat(200)}`,
    provenance: {
      contractVersion: "exact-plan-v1" as const,
      designId,
      designRevision: null,
      planFingerprint: HEX64,
      geometryLock: "g".repeat(32),
      camera: { position: [0, 0, 0] as [number, number, number], target: [0, 0, 1] as [number, number, number], zoom: 1 },
      materials: roles.map((role) => ({ role, productId: null, name: null, materialImageUrl: null })),
      materialManifest: [{
        id: "m1", role: "countertop", label: "Countertop", itemIds: ["i1"], referenceUrl: null,
        referenceSource: "locked-designer-jpeg" as const, provenance: "fixture",
      }],
      missingMaterialInputs: [],
      sourceImageHash: HEX64,
      generationMethod: "manual-final-review-gemini-nano-banana-v1" as const,
    },
  };
}

const ctxFor = (role: string, id = 777001) =>
  ({
    user: { id, openId: `fixture-${role}-${id}`, name: "Fixture", email: `${role}${id}@example.invalid`, role },
    req: { protocol: "https", headers: {} },
    res: {},
  }) as unknown as TrpcContext;

async function start(role: string, designId: number) {
  const caller = designPhotoRendersRouter.createCaller(ctxFor(role));
  return caller.startGeminiImageTest(input(designId) as never);
}

const savedPlan = (affiliateId: number | null) => ({
  id: 4101, userId: 777001, affiliateId, name: "Fixture plan",
  roomData: {}, placedCabinets: [], selectedSurfaces: null, threeDPresentation: null,
  selectedStyleId: 1, selectedDistributorId: 1, updatedAt: new Date("2026-01-01T00:00:00Z"),
});

beforeEach(() => {
  state.design = null;
  state.access = null;
});

describe("Rule 27: affiliate Gemini only for the affiliate's own saved plans", () => {
  it("refuses a plan that is not an affiliate storefront plan (affiliateId null)", async () => {
    state.design = savedPlan(null);
    state.access = { affiliateId: 5, accessDesigner: true };
    await expect(start("user", 4101)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses an affiliate whose storefront differs from the plan's storefront", async () => {
    state.design = savedPlan(9); // plan belongs to affiliate 9
    state.access = { affiliateId: 5, accessDesigner: true }; // caller is affiliate 5
    await expect(start("user", 4101)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses a team member without Designer access", async () => {
    state.design = savedPlan(5);
    state.access = { affiliateId: 5, accessDesigner: false };
    await expect(start("user", 4101)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses a signed-in user who is not an affiliate at all", async () => {
    state.design = savedPlan(5);
    state.access = null;
    await expect(start("user", 4101)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses the administrator-only unsaved snapshot (designId 0) for a non-admin", async () => {
    state.design = null;
    state.access = { affiliateId: 5, accessDesigner: true };
    await expect(start("user", 0)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("passes the ownership gate for the same affiliate with Designer access", async () => {
    state.design = savedPlan(5);
    state.access = { affiliateId: 5, accessDesigner: true };
    // The fixture stops later (plan fingerprint does not match a real plan). What matters is
    // that the refusal is NOT the access check: no FORBIDDEN, so the gate was passed.
    const outcome = await start("user", 4101).then(() => null, (error: unknown) => error as { code?: string; message?: string });
    expect(outcome?.code).not.toBe("FORBIDDEN");
  });
});
