// Wall-clock timeouts for the long, CPU-bound simulation tests.
//
// These tests run hours of simulated behaviour; they are deterministic and their assertions (counts, bands,
// a CPU-time budget) do not depend on wall time. The per-test timeout is only a hang guard. A fixed number of
// milliseconds written for an idle machine fails on a shared or loaded PC (bands-short asserts at most 120 s of
// CPU time, yet carried a 60 s wall-clock timeout; one loaded full run timed out twelve such tests with no
// assertion failing). Explicit per-test timeouts override the configured default, so they scale here instead:
// by VITEST_TEST_TIMEOUT_MS / 60000 when that is set (as `verify` runs on this PC do), and by at least 3 always.
const BASE_DEFAULT_MS = 60_000;
const FLOOR_FACTOR = 3;

export function slow(ms: number): number {
  const configured = Number(process.env['VITEST_TEST_TIMEOUT_MS']);
  const factor = Number.isFinite(configured) && configured > 0 ? configured / BASE_DEFAULT_MS : 1;
  return Math.round(ms * Math.max(FLOOR_FACTOR, factor));
}
