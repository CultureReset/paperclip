import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parityDump, stable } from "../services/automation/parity.js";

/**
 * The side-by-side proof (DECISIONS #91): Paperclip's runner, dry, on the
 * same definition, event and seed gcr-api-clean's parity dump ran, must print
 * the same stable JSON as gcr did. `review-request.gcr.dump.json` is gcr's
 * output (scripts/parity-dump.js on scripts/parity/*), copied as a fixture.
 */
const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/parity");
const read = (name: string) => JSON.parse(readFileSync(path.join(FIX, name), "utf8"));

const VOLATILE = /"(ms|duration_ms|run_id|at|now|due_at|expires_at|created_at|updated_at|timestamp|nonce|X-Paperclip-[A-Za-z]+)":/;

function sortedKeys(v: unknown): boolean {
  if (Array.isArray(v)) return v.every(sortedKeys);
  if (v && typeof v === "object") {
    const keys = Object.keys(v as Record<string, unknown>);
    return keys.join("\n") === [...keys].sort().join("\n") && keys.every((k) => sortedKeys((v as Record<string, unknown>)[k]));
  }
  return true;
}

describe("parity dump", () => {
  it("prints exactly what gcr's engine printed for the same definition, event and seed (engine aside)", async () => {
    const dump = await parityDump(read("review-request.definition.json"), read("booking-completed.event.json"), read("seed.json"));
    const gcr = read("review-request.gcr.dump.json") as Record<string, unknown>;
    expect(dump.engine).toBe("paperclip");
    expect(gcr.engine).toBe("gcr");
    expect({ ...dump, engine: "gcr" }).toEqual(gcr);
    expect(JSON.stringify(dump, null, 2)).toBe(JSON.stringify(stable({ ...gcr, engine: "paperclip" }), null, 2));
  });

  it("is stable: same bytes twice, keys sorted, no volatile field, a dry run passes through wait (DECISIONS #94)", async () => {
    const args = [read("review-request.definition.json"), read("booking-completed.event.json"), read("seed.json")] as const;
    const first = JSON.stringify(await parityDump(...args), null, 2);
    const second = JSON.stringify(await parityDump(...args), null, 2);
    expect(first).toBe(second);
    expect(VOLATILE.test(first)).toBe(false);
    const parsed = JSON.parse(first);
    expect(sortedKeys(parsed)).toBe(true);
    expect(parsed.result.waited).toBeNull();
    expect(parsed.result.steps.map((s: { id: string }) => s.id)).toEqual(["recent", "gate", "shape", "pause", "hand", "mail", "note"]);
    expect("payload" in parsed.trigger).toBe(false);
    expect(JSON.stringify(parsed.trigger)).not.toContain("ana@");
    expect("payload" in parsed.result.steps[4].output.would_post.body.trigger).toBe(false);
  });

  it("a failing definition still dumps, with the failure where it happened", async () => {
    const dump = await parityDump(
      { name: "Bad", trigger: { type: "manual" }, steps: [{ id: "q", type: "data.query", config: { table: "auth.users" } }, { id: "l", type: "log", config: { message: "never" } }] },
      read("booking-completed.event.json"),
      read("seed.json"),
    );
    expect(dump.result.status).toBe("failed");
    expect(dump.result.steps).toHaveLength(1);
    expect(dump.result.steps[0].status).toBe("failed");
    expect(dump.result.steps[0].error).toMatch(/auth\.users/);
    expect(dump.result.error).toMatch(/auth\.users/);
  });
});
