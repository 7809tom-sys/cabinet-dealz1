// Run ONLY after Tom approves a change to a frozen file.
import fs from "node:fs"; import c from "node:crypto";
const p = "server/guards/frozenFiles.manifest.json";
const m = JSON.parse(fs.readFileSync(p, "utf8"));
for (const f of Object.keys(m.files)) m.files[f] = c.createHash("sha256").update(fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n")).digest("hex");
fs.writeFileSync(p, JSON.stringify(m, null, 2) + "\n"); console.log("manifest updated");
