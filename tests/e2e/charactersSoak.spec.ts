// Accelerated character soak (GizeMate 1.6.0): each of the seven characters runs in the real app for a bounded
// wall-clock period at sim time scale 12 (default 100 s per character = about 20 sim-minutes each), sampled every
// 5 s. This is NOT a multi-hour soak: it shows bounded CPU, memory and event-loop behaviour over about 12 minutes
// of wall time, and that the clip variety and the overlay stay healthy.
// Opt-in (it puts a transparent overlay on the desk for about 12 minutes):
//   DESKTOP_CAT_E2E_CHARACTER_SOAK=1 node scripts/with-lock.mjs gm-soak -- npx playwright test tests/e2e/charactersSoak.spec.ts
// Optional: DESKTOP_CAT_CHAR_SOAK_SEC (wall seconds per character, default 100), DESKTOP_CAT_CHAR_SOAK_ONLY (comma list of ids),
//           DESKTOP_CAT_CHAR_SOAK_SCALE (default 12).
// Own temp userData per run (tests/e2e/fixtures.ts), surfaces restricted to a pid that owns no window, no real mouse input.
// Measured per sample: Electron getAppMetrics (CPU percent and working set of every process of this run), main
// process.memoryUsage, the overlay renderer's JS heap (CDP Runtime.getHeapUsage), main event-loop delay p99
// (perf_hooks histogram through the test hook), distinct clips, log problems, overlay window count.
//
// Bounds (justified from the measured noise, see docs/releases/1.6.0-live-validation.md):
//   - no warn/error log lines (one environmental warning set aside: the global shortcut is taken by another app);
//   - overlay window count constant at the display count in every sample;
//   - growth after a 20 s warm-up: mean of the last 3 samples minus mean of the first 3 samples after warm-up of
//       total working set < WS_GROWTH_MB, main JS heap < MAIN_HEAP_GROWTH_MB, renderer JS heap < RENDERER_HEAP_GROWTH_MB
//     (JS heaps saw-tooth with garbage collection; the 3-sample means and the generous bound absorb that);
//   - event-loop delay p99 < 50 ms in every sample after warm-up (10 ms histogram resolution);
//   - CPU averaged over the run (sum of all processes of the app, percent of one core) < CPU_AVG_MAX;
//   - never stuck: no awake clip longer than AWAKE_RUN_MAX_S of sim time, no sleep run longer than SLEEP_RUN_MAX_S, the sim's
//     progress monitor reset nothing (stuckResets 0), and at least 5 distinct clips over the run;
//   - clean exit code 0.
import fs from 'node:fs';
import path from 'node:path';
import type { CDPSession, ElectronApplication, TestInfo } from '@playwright/test';
import { CHARACTER_IDS } from '../../src/shared/characters/registry';
import { expect, hook, launchApp, overlayPageOf, quitApp, seedSettings, test, waitForCat } from './fixtures';

const SOAK = process.env.DESKTOP_CAT_E2E_CHARACTER_SOAK === '1';
const SEC = Math.max(30, Number(process.env.DESKTOP_CAT_CHAR_SOAK_SEC ?? '100') || 100);
const SCALE = Math.min(30, Math.max(2, Number(process.env.DESKTOP_CAT_CHAR_SOAK_SCALE ?? '12') || 12));
const ONLY = (process.env.DESKTOP_CAT_CHAR_SOAK_ONLY ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const IDS = CHARACTER_IDS.filter((id) => ONLY.length === 0 || ONLY.includes(id));
const WARMUP_S = 20;
const SAMPLE_S = 5;
// Calibrated on the measured noise of a first full run (seven characters, 100 s each, x12, this PC): CPU averaged 1.0 to 1.9 %
// of one core (max sample 3.0 %); the summed working set of the app's processes swings by 15 to 53 MB inside one run (two full runs) in both
// directions (the GPU process and the allocator, not a leak: alien ended 31 MB lower in the second run, monkey 33 MB higher in the first), while the JS heaps
// are quiet: main heap growth 0.5 to 1.3 MB (spread up to 3.8 MB), renderer heap growth -0.4 to 0.4 MB (spread up to 1.3 MB,
// 3 to 5 MB in use); event-loop p99 20 to 25 ms (10 ms histogram resolution). So the working-set bound is 100 MB (2.4 times the
// largest swing: it catches only a gross leak) and the heap bounds, which are what finds a real leak, are 10 MB (main) and
// 5 MB (renderer), about 3 times their noise; the CPU bound is 15 % (8 times the highest average).
const WS_GROWTH_MB = 100;
const MAIN_HEAP_GROWTH_MB = 10;
const RENDERER_HEAP_GROWTH_MB = 5;
const CPU_AVG_MAX = 15; // percent of one core, summed over every process of the app
// A character may rest (sit, loaf) for a couple of minutes and nap (sleep clip) for many: the first full run measured awake runs of
// up to 130 s and naps of up to 543 s of sim time, all of them ordinary resting. A stuck animation is one that never ends, so:
// awake clips must end within AWAKE_RUN_MAX_S, the sleep clip within SLEEP_RUN_MAX_S, and the sim's own progress monitor
// (behaviour profile stuckResets) must have reset nothing.
const AWAKE_RUN_MAX_S = 240;
const SLEEP_RUN_MAX_S = 900;
const ENVIRONMENTAL = ['shortcut registration failed'];

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const mean = (v: readonly number[]): number => (v.length === 0 ? 0 : v.reduce((a, b) => a + b, 0) / v.length);
const round1 = (v: number): number => Math.round(v * 10) / 10;

interface Sample {
  tS: number;
  cpuTotal: number;
  cpuByType: Record<string, number>;
  wsTotalMb: number;
  mainHeapMb: number;
  mainRssMb: number;
  rendererHeapMb: number;
  loopP99: number;
  loopMax: number;
  clips: number;
  overlays: number;
  overlayPages: number;
  problems: number;
  simS: number;
}

test.describe('character soak (accelerated, ~12 min total; app REAL, no pointer input)', () => {
  test.skip(!SOAK, 'opt-in: DESKTOP_CAT_E2E_CHARACTER_SOAK=1');

  for (const id of IDS) {
    test(`soak ${id}: bounded CPU, memory and event loop over ${SEC} s at x${SCALE}`, async ({ userData }, info: TestInfo) => {
      test.setTimeout((SEC + 120) * 1000);
      seedSettings(userData, { activeCharacter: id });
      const app: ElectronApplication = await launchApp(userData);
      let cdp: CDPSession | null = null;
      try {
        await waitForCat(app);
        const startup = await hook(app, 'getStartup');
        expect(path.resolve(startup.userData), 'own temp userData').toBe(path.resolve(userData));
        const launcherPid = app.process().pid ?? 0;
        await hook(app, 'restrictSurfacesToPids', [launcherPid]); // a pid that owns no window: the owner's windows never join the run
        await hook(app, 'injectUserIdle', 3000);
        await hook(app, 'injectEvent', { type: 'command.wake' });
        const displays = await app.evaluate(({ screen }) => screen.getAllDisplays().length);
        const page = overlayPageOf(app);
        if (page) cdp = await app.context().newCDPSession(page);
        await hook(app, 'eventLoopDelay', true);
        await hook(app, 'setTimeScale', SCALE);

        const clipsSeen = new Set<string>();
        let last = '';
        let runStart = (await hook(app, 'getHostDebug')).simNow;
        let longestRun = { clip: '', sec: 0 };
        let longestSleep = 0;
        const samples: Sample[] = [];
        const t0 = Date.now();
        const simStart = runStart;
        let nextSample = t0 + SAMPLE_S * 1000;
        // The first getAppMetrics call reports 0 CPU: take it once now.
        await app.evaluate(({ app: a }) => a.getAppMetrics().length);
        while (Date.now() - t0 < SEC * 1000) {
          const out = await hook(app, 'getSimOutput');
          const simNow = (await hook(app, 'getHostDebug')).simNow;
          if (out) {
            clipsSeen.add(out.clip);
            if (out.clip !== last) {
              last = out.clip;
              runStart = simNow;
            }
            const run = (simNow - runStart) / 1000;
            if (out.clip === 'sleep') longestSleep = Math.max(longestSleep, Math.round(run));
            else if (run > longestRun.sec) longestRun = { clip: out.clip, sec: Math.round(run) };
          }
          if (Date.now() >= nextSample) {
            nextSample += SAMPLE_S * 1000;
            const m = await app.evaluate(({ app: a }) => ({
              procs: a.getAppMetrics().map((p) => ({ pid: p.pid, type: p.type, cpu: p.cpu.percentCPUUsage, ws: p.memory.workingSetSize })),
              mem: process.memoryUsage(),
            }));
            const cpuByType: Record<string, number> = {};
            for (const p of m.procs) cpuByType[p.type] = round1((cpuByType[p.type] ?? 0) + p.cpu);
            let rendererHeapMb = -1;
            if (cdp) {
              try {
                const h = (await cdp.send('Runtime.getHeapUsage')) as { usedSize: number };
                rendererHeapMb = round1(h.usedSize / 1048576);
              } catch {
                rendererHeapMb = -1;
              }
            }
            const loop = await hook(app, 'eventLoopDelay', true);
            const lines = (await hook(app, 'getRecentLogs', 1000)).filter((l) => (l.level === 'warn' || l.level === 'error') && !ENVIRONMENTAL.some((e) => l.msg.includes(e)));
            const overlays = await hook(app, 'getOverlays');
            samples.push({
              tS: Math.round((Date.now() - t0) / 1000),
              cpuTotal: round1(m.procs.reduce((a, p) => a + p.cpu, 0)),
              cpuByType,
              wsTotalMb: round1(m.procs.reduce((a, p) => a + p.ws, 0) / 1024),
              mainHeapMb: round1(m.mem.heapUsed / 1048576),
              mainRssMb: round1(m.mem.rss / 1048576),
              rendererHeapMb,
              loopP99: loop.p99Ms,
              loopMax: loop.maxMs,
              clips: clipsSeen.size,
              overlays: overlays.length,
              overlayPages: app.windows().filter((w) => w.url().includes('/renderer/overlay/') && !w.isClosed()).length,
              problems: lines.length,
              simS: Math.round((simNow - simStart) / 1000),
            });
          }
          await sleep(250);
        }
        const simMinutes = round1(((await hook(app, 'getHostDebug')).simNow - simStart) / 60000);
        const problemLines = (await hook(app, 'getRecentLogs', 1000)).filter((l) => (l.level === 'warn' || l.level === 'error') && !ENVIRONMENTAL.some((e) => l.msg.includes(e))).map((l) => `${l.level} ${l.scope}: ${l.msg}`);
        const post = samples.filter((s) => s.tS > WARMUP_S);
        const first = post.slice(0, 3);
        const lastN = post.slice(-3);
        const growth = {
          wsMb: round1(mean(lastN.map((s) => s.wsTotalMb)) - mean(first.map((s) => s.wsTotalMb))),
          mainHeapMb: round1(mean(lastN.map((s) => s.mainHeapMb)) - mean(first.map((s) => s.mainHeapMb))),
          rendererHeapMb: round1(mean(lastN.map((s) => s.rendererHeapMb)) - mean(first.map((s) => s.rendererHeapMb))),
        };
        const heapSpread = (pick: (s: Sample) => number): number => (post.length === 0 ? 0 : round1(Math.max(...post.map(pick)) - Math.min(...post.map(pick))));
        const slopePerMin = (pick: (s: Sample) => number): number => {
          const n = post.length;
          if (n < 3) return 0;
          const xs = post.map((s) => s.tS / 60);
          const ys = post.map(pick);
          const mx = mean(xs);
          const my = mean(ys);
          const den = xs.reduce((a, x) => a + (x - mx) * (x - mx), 0);
          return den === 0 ? 0 : round1(xs.reduce((a, x, i) => a + (x - mx) * ((ys[i] as number) - my), 0) / den);
        };
        const cpuAvg = round1(mean(samples.map((s) => s.cpuTotal)));
        const report = {
          id,
          wallSeconds: SEC,
          scale: SCALE,
          simMinutes,
          samples: samples.length,
          cpuAvgPercentOfOneCore: cpuAvg,
          cpuMax: Math.max(0, ...samples.map((s) => s.cpuTotal)),
          cpuByTypeAvg: Object.fromEntries(['Browser', 'Tab', 'GPU', 'Utility'].map((t) => [t, round1(mean(samples.map((s) => s.cpuByType[t] ?? 0)))])),
          wsStartMb: first[0]?.wsTotalMb ?? null,
          wsEndMb: lastN[lastN.length - 1]?.wsTotalMb ?? null,
          growth,
          slopeMbPerWallMin: { ws: slopePerMin((s) => s.wsTotalMb), mainHeap: slopePerMin((s) => s.mainHeapMb), rendererHeap: slopePerMin((s) => s.rendererHeapMb) },
          noiseSpreadMb: { ws: heapSpread((s) => s.wsTotalMb), mainHeap: heapSpread((s) => s.mainHeapMb), rendererHeap: heapSpread((s) => s.rendererHeapMb) },
          rendererHeapEndMb: lastN[lastN.length - 1]?.rendererHeapMb ?? null,
          mainHeapEndMb: lastN[lastN.length - 1]?.mainHeapMb ?? null,
          loopP99Max: Math.max(0, ...post.map((s) => s.loopP99)),
          loopP99Median: [...post.map((s) => s.loopP99)].sort((a, b) => a - b)[Math.floor(post.length / 2)] ?? 0,
          loopMaxMs: Math.max(0, ...post.map((s) => s.loopMax)),
          distinctClips: clipsSeen.size,
          clips: [...clipsSeen],
          longestAwakeRun: longestRun,
          longestSleepSec: longestSleep,
          stuckResets: (await hook(app, 'getBehaviorProfile')).stuckResets,
          overlayCounts: [...new Set(samples.map((s) => s.overlays))],
          overlayPageCounts: [...new Set(samples.map((s) => s.overlayPages))],
          problems: problemLines,
          tickErrors: (await hook(app, 'getHostDebug')).tickErrors,
        };
        const reportFile = info.outputPath('character-soak-report.json');
        fs.mkdirSync(path.dirname(reportFile), { recursive: true });
        fs.writeFileSync(reportFile, JSON.stringify({ report, samples }, null, 2));
        const outDir = path.resolve(__dirname, '..', '..', 'out', 'e2e-characters');
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, `soak-${id}.json`), JSON.stringify({ report, samples }, null, 2));
        info.annotations.push({ type: 'soak', description: JSON.stringify(report).slice(0, 3000) });
        console.log(`[measure] soak ${id}: ${JSON.stringify(report)}`);

        // ---- bounds ----
        expect(problemLines, 'no warn or error log lines').toEqual([]);
        expect(report.overlayCounts, 'overlay window count constant').toEqual([displays]);
        expect(report.overlayPageCounts, 'overlay page count constant').toEqual([displays]);
        expect(samples.length, 'enough samples').toBeGreaterThanOrEqual(Math.floor(SEC / SAMPLE_S) - 2);
        expect(simMinutes, 'the accelerated clock really ran').toBeGreaterThan((SEC * SCALE) / 60 / 2);
        expect(growth.wsMb, `working set growth after warm-up (bound ${WS_GROWTH_MB} MB)`).toBeLessThan(WS_GROWTH_MB);
        expect(growth.mainHeapMb, `main heap growth (bound ${MAIN_HEAP_GROWTH_MB} MB)`).toBeLessThan(MAIN_HEAP_GROWTH_MB);
        if (growth.rendererHeapMb !== 0 && lastN.every((s) => s.rendererHeapMb >= 0)) expect(growth.rendererHeapMb, `renderer heap growth (bound ${RENDERER_HEAP_GROWTH_MB} MB)`).toBeLessThan(RENDERER_HEAP_GROWTH_MB);
        expect(report.loopP99Max, 'event-loop delay p99 under 50 ms').toBeLessThan(50);
        expect(cpuAvg, `average CPU of all processes (bound ${CPU_AVG_MAX} % of one core)`).toBeLessThan(CPU_AVG_MAX);
        expect(clipsSeen.size, `distinct clips: ${[...clipsSeen].join(',')}`).toBeGreaterThanOrEqual(5);
        expect(longestRun.sec, `never stuck: longest awake run ${longestRun.clip} ${longestRun.sec} s of sim time (bound ${AWAKE_RUN_MAX_S})`).toBeLessThan(AWAKE_RUN_MAX_S);
        expect(longestSleep, `a nap ends: longest sleep run ${longestSleep} s of sim time (bound ${SLEEP_RUN_MAX_S})`).toBeLessThan(SLEEP_RUN_MAX_S);
        expect(report.stuckResets, 'the sim progress monitor reset nothing').toBe(0);
        expect(report.tickErrors).toBe(0);
      } finally {
        if (cdp) await cdp.detach().catch(() => undefined);
        const code = await quitApp(app).catch(() => 'quit failed' as const);
        console.log(`[measure] soak ${id} exit: ${String(code)}`);
        expect(code, 'clean exit').toBe(0);
      }
    });
  }
});
