import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalJson, computePacketDigest, COMPILER_VERSION } from "../src/index.js";

// Rebind test-only copies to this compiler. Published protocol examples remain historical bytes.
export function currentExchangeFixture(filename: string): string {
  const names = ["brief.tfsl-brief.json", "candidate-a.tfsl-candidate.json", "candidate-b.tfsl-candidate.json", "review.tfsl-review.json"];
  const digests = new Map<string, string>();
  const packets = new Map<string, string>();
  for (const name of names) {
    let raw = readFileSync(resolve(import.meta.dirname, "../protocol/tfsl-theme-evidence-v1/examples", name), "utf8");
    const original = JSON.parse(raw);
    for (const [before, after] of digests) raw = raw.replaceAll(before, after);
    const packet = JSON.parse(raw);
    if (packet.schema === "tfsl.theme-brief") packet.compilerVersion = COMPILER_VERSION;
    if (packet.claimedProvenance?.toolVersion) packet.claimedProvenance.toolVersion = COMPILER_VERSION;
    const field = packet.schema === "tfsl.theme-brief" ? "briefDigest" : packet.schema === "tfsl.theme-candidate" ? "candidateDigest" : "reviewDigest";
    packet[field] = computePacketDigest(packet);
    digests.set(original[field], packet[field]);
    packets.set(name, canonicalJson(packet));
  }
  const result = packets.get(filename);
  if (!result) throw new Error(`Unknown exchange fixture: ${filename}`);
  return result;
}
