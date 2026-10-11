/**
 * Test-only timing shim.
 *
 * The HID drivers encode real hardware settle and poll delays — hundreds of
 * milliseconds up to two seconds, often retried — because a physical keyboard
 * needs that long to answer. A fake device in a test answers synchronously, so
 * those waits are pure idle time: the Wooting suite otherwise spends about
 * 50 seconds waiting for fake-device timeouts.
 *
 * Node runs every test file in its own worker whose argv[1] is the test file,
 * so this collapses `setTimeout` delays for that worker. Tests that deliberately
 * assert real elapsed timing must keep real timers via the list below. Add any
 * such test file there before introducing elapsed-time assertions.
 *
 * Loaded from the `test` script via `--import`. It only ever touches test
 * worker processes, never the runner, and never production code.
 */
import { sep } from "node:path";

/** Test files that assert real elapsed timing and must keep real timers. */
const TIMING_ASSERTING = [];
// Add a test-file suffix here before asserting real elapsed timing.

/** Longest delay a mocked timer is allowed to take. */
const MAX_DELAY_MS = 1;

const testFile = (process.argv[1] ?? "").split(sep).join("/");
const isWorker = testFile.endsWith(".test.ts");
const assertsTiming = TIMING_ASSERTING.some((suffix) => testFile.endsWith(suffix));

if (isWorker && !assertsTiming) {
  const realSetTimeout = globalThis.setTimeout.bind(globalThis);
  globalThis.setTimeout = (callback, delay = 0, ...args) =>
    realSetTimeout(callback, typeof delay === "number" ? Math.min(delay, MAX_DELAY_MS) : delay, ...args);
}
