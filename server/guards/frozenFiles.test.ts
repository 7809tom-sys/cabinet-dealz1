import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Rule 26: the Continuous Wall Builder and the 3D Designer are FROZEN unless Tom asks.
// WHY: Tom verified them as correct; unrequested edits broke working geometry before.
// If this fails you changed a frozen file. Stop and ask Tom. Only after his approval run:
//   node server/guards/updateFrozenManifest.mjs
const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "server/guards/frozenFiles.manifest.json"), "utf8")) as {
  files: Record<string, string>;
};
const sha = (path: string) =>
  createHash("sha256").update(readFileSync(resolve(process.cwd(), path), "utf8").replace(/\r\n/g, "\n")).digest("hex");

describe("frozen files (Wall Builder + 3D Designer)", () => {
  it("lists the Wall Builder and 3D Designer files", () => {
    const names = Object.keys(manifest.files);
    expect(names).toEqual(expect.arrayContaining([
      "client/src/components/design/WallBuilder.tsx",
      "client/src/components/design/InteractiveRoom3D.tsx",
    ]));
  });

  for (const [file, expected] of Object.entries(manifest.files)) {
    it(`${file} is unchanged since Tom's last approval`, () => {
      expect(existsSync(resolve(process.cwd(), file)), `${file} was removed or renamed`).toBe(true);
      expect(sha(file), `${file} changed. Frozen: ask Tom, then update the manifest.`).toBe(expected);
    });
  }
});
