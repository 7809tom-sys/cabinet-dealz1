import { describe, expect, it } from "vitest";
import type { Request, Response } from "express";
import { clearLegacyCabinetDealzParentSession, getSessionCookieOptions } from "../_core/cookies";
import { cabinetOverridesRouter } from "../routers/cabinetOverrides";
import type { TrpcContext } from "../_core/context";

// Fixtures only: fake requests and fake users. No database or live data is touched,
// because the admin check runs before any procedure body.

const req = (hostname: string, extra: Record<string, unknown> = {}) =>
  ({ hostname, protocol: "https", headers: { host: hostname }, ...extra }) as unknown as Request;

describe("Rule 24: sessions are isolated per site", () => {
  const hosts = ["www.cabinetdealz.com", "reaves-way-cabinet-shop.cabinetdealz.com", "kitchens.example-affiliate.com", "cabinetdealz.com"];

  it.each(hosts)("issues a host-only cookie (no domain attribute) for %s", (host) => {
    const options = getSessionCookieOptions(req(host));
    expect(options.domain).toBeUndefined();
    expect(options.httpOnly).toBe(true);
    expect(options.secure).toBe(true);
    expect(options.path).toBe("/");
  });

  it("never shares one affiliate host's cookie scope with another", () => {
    const a = getSessionCookieOptions(req("shop-a.cabinetdealz.com"));
    const b = getSessionCookieOptions(req("shop-b.cabinetdealz.com"));
    expect(a.domain).toBeUndefined();
    expect(b.domain).toBeUndefined();
  });

  it("only retires the legacy parent-domain cookie on CabinetDealz hosts", () => {
    const cleared: Array<{ name: string; domain?: string }> = [];
    const res = { clearCookie: (name: string, options: { domain?: string }) => cleared.push({ name, domain: options.domain }) } as unknown as Response;

    clearLegacyCabinetDealzParentSession(req("kitchens.example-affiliate.com"), res);
    expect(cleared).toHaveLength(0); // custom affiliate domains are left alone

    clearLegacyCabinetDealzParentSession(req("shop-a.cabinetdealz.com"), res);
    expect(cleared).toHaveLength(1);
    expect(cleared[0].domain).toBe(".cabinetdealz.com");
  });
});

describe("Rule 25: only admins can edit cabinet configuration", () => {
  const roles = ["user", "dealer", "partner", "designer", "sales_rep", "distributor", "contractor"] as const;
  const publicProcedures = new Set(["configForDistributor"]); // read-only and intentionally public

  const ctxFor = (role: string | null) =>
    ({
      user: role ? { id: 990001, openId: `fixture-${role}`, name: "Fixture", email: `${role}@example.invalid`, role } : null,
      req: { protocol: "https", headers: {} },
      res: { clearCookie: () => {} },
    }) as unknown as TrpcContext;

  const procedureNames = Object.keys((cabinetOverridesRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures);

  it("finds the cabinet override procedures", () => {
    expect(procedureNames).toEqual(expect.arrayContaining(["setConfig", "clearConfig", "set", "delete", "bulkApply", "revertConfigChange"]));
  });

  const gated = procedureNames.filter((name) => !publicProcedures.has(name));

  for (const role of [...roles, null] as const) {
    it(`blocks ${role ?? "anonymous"} from every admin-only cabinet config procedure`, async () => {
      const caller = cabinetOverridesRouter.createCaller(ctxFor(role)) as unknown as Record<string, (input?: unknown) => Promise<unknown>>;
      for (const name of gated) {
        await expect(caller[name](undefined), `${name} must reject ${role ?? "anonymous"}`).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
    });
  }
});
