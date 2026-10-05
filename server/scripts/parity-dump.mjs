#!/usr/bin/env node
// ============================================================
// PARITY DUMP — Paperclip's step runner's dry run of one definition, as stable JSON (DECISIONS #91)
// ============================================================
//
//     node scripts/parity-dump.mjs <definition.json> <event.json> [--seed seed.json] [--slug shop] [--out file]
//     node scripts/parity-dump.mjs scripts/parity/review-request.definition.json scripts/parity/booking-completed.event.json --seed scripts/parity/seed.json
//
// The other half of gcr-api-clean's scripts/parity-dump.js: the same inputs
// (a definition, an event, an optional seed), the same shape (version 1 —
// parity, engine, definition{name,trigger}, trigger{type,event,ref},
// result{status,error,dry_run,waited,steps[{id,type,name,status,output,error?}],
// output{notices,logs}}), keys sorted at every depth, the same volatile fields
// removed (ms, duration_ms, run_id, at, now, due_at, expires_at, created_at,
// updated_at, timestamp, nonce, X-Paperclip-* headers). Only `engine` differs:
// "paperclip" here. A diff of the two files is the proof the cut-over needs.
//
// No database, no network: the runner's deps answer from the seed
// (src/services/automation/parity.ts). The fixtures in scripts/parity are
// copies of gcr's, and scripts/parity/review-request.gcr.dump.json is gcr's
// own output for them, checked by src/__tests__/automation-parity.test.ts.
//
// Exit code 0 when the dump was printed, whatever the run's status; 2 for bad
// arguments.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "tsx/esm/api";

function usage(message) {
  if (message) console.error(message);
  console.error("usage: node scripts/parity-dump.mjs <definition.json> <event.json> [--seed seed.json] [--slug slug] [--out file]");
  process.exit(2);
}

function parseArgs(argv) {
  const out = { files: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--seed" || a === "--slug" || a === "--out") { out[a.slice(2)] = argv[++i]; continue; }
    if (a.startsWith("--")) usage(`Unknown option ${a}`);
    out.files.push(a);
  }
  if (out.files.length !== 2) usage();
  return out;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  } catch (e) {
    return usage(`Could not read ${file}: ${e.message}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const definition = readJson(args.files[0]);
  const event = readJson(args.files[1]);
  const seed = args.seed ? readJson(args.seed) : {};

  // The runner is TypeScript; load it through tsx so this script needs no build.
  const unregister = register();
  const here = path.dirname(fileURLToPath(import.meta.url));
  const { parityDump } = await import(path.join(here, "../src/services/automation/parity.ts"));
  const dump = await parityDump(definition, event, seed, { slug: args.slug });
  await unregister();

  const text = `${JSON.stringify(dump, null, 2)}\n`;
  if (args.out) fs.writeFileSync(path.resolve(args.out), text);
  else process.stdout.write(text);
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
