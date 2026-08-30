#!/usr/bin/env -S deno run --allow-all
/**
 * run-all-experiments.ts — orchestrates the full documentation-drift sample.
 *
 * Runs scripts/experiment-runner.ts for every sample target (SELECTION.md
 * order). Targets run CONCURRENTLY by default (all pending at once; `--jobs N`
 * caps it) — each target uses its own container name + host port, so parallel
 * http/db targets don't collide. Within each target all goals also run in
 * parallel (ROOKIE_PARALLEL_GOALS). Other behaviour:
 *   - targets with a final report on disk are SKIPPED — the batch is safe to
 *     rerun after a crash or interruption,
 *   - targets with a checkpoint RESUME from their last completed phase,
 *   - a failing target does not stop the batch — its log and checkpoint remain,
 *   - in parallel mode each target's live view is its logs/<config>.log (the
 *     console shows compact start/done lines); sequential mode (`--jobs 1`)
 *     mirrors output to the console too,
 *   - the batch ends with a per-target summary table.
 *
 * Usage:
 *   deno task experiment:all                          # all pending, fully parallel
 *   deno task experiment:all -- --jobs 3              # at most 3 targets at once
 *   deno task experiment:all -- --jobs 1              # sequential, live console output
 *   deno task experiment:all -- --dry-run            # show the plan, run nothing
 *   deno task experiment:all -- --only execa,typeorm # subset of config keys
 *   deno task experiment:all -- --skip mikroorm      # exclude targets
 *   deno task experiment:all -- --include-pilots     # also any pilots (none by default)
 *   deno task experiment:all -- --bail               # stop launching new targets after a failure
 *   deno task experiment:all -- --no-freeze          # ABLATION: goal rerun only, code regenerated
 *
 * Methodology flags (--no-freeze, --ablation, --fresh, --verbose) are forwarded
 * to every experiment-runner child; the run header states which protocol is in
 * effect. Note that targets are skipped when a report is already on disk, so an
 * ablation run needs the previous run's reports moved aside first.
 */
import { EXPERIMENTS } from "./experiments/targets.ts";

const ROOKIE_URL = Deno.env.get("ROOKIE_URL") ?? "http://localhost:3000";

// ── colors ───────────────────────────────────────────────────────
const isTTY = Deno.stdout.isTerminal();
const esc = (n: string) => (s: string) => isTTY ? `\x1b[${n}m${s}\x1b[0m` : s;
const bold = esc("1");
const dim = esc("2;90");
const green = esc("32");
const red = esc("31");
const yell = esc("33");
const cyan = esc("36");
const gray = esc("90");

const W = 64;
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const visLen = (s: string) => stripAnsi(s).length;
const padVis = (s: string, w: number) => s + " ".repeat(Math.max(0, w - visLen(s)));

function card(title: string, rows: string[], width = W): void {
    const inner = width - 2;
    console.log(`\n${gray("╭" + "─".repeat(inner) + "╮")}`);
    console.log(`${gray("│")} ${padVis(bold(title), inner - 2)} ${gray("│")}`);
    if (rows.length > 0) console.log(`${gray("│")}${" ".repeat(inner)}${gray("│")}`);
    for (const row of rows) {
        console.log(`${gray("│")} ${padVis(row, inner - 2)} ${gray("│")}`);
    }
    console.log(`${gray("╰" + "─".repeat(inner) + "╯")}`);
}

function fmtDur(ms: number): string {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
    return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

// ── CLI ──────────────────────────────────────────────────────────
const arg = (k: string): string | null => {
    const i = Deno.args.indexOf(k);
    return i !== -1 ? Deno.args[i + 1] ?? null : null;
};
const flag = (k: string): boolean => Deno.args.includes(k);

const DRY_RUN = flag("--dry-run");
const BAIL = flag("--bail");
const INCLUDE_PILOTS = flag("--include-pilots");
const ONLY = arg("--only")?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
const SKIP = new Set(arg("--skip")?.split(",").map((s) => s.trim()).filter(Boolean) ?? []);

// Methodology flags forwarded verbatim to every experiment-runner child. An
// allowlist rather than "forward anything unrecognised": a silently dropped
// --no-freeze would run the wrong protocol across the whole sample and only
// show up hours later in the reports.
const RUNNER_FLAGS = ["--no-freeze", "--ablation", "--fresh", "--verbose"] as const;
const PASSTHROUGH = RUNNER_FLAGS.filter((f) => flag(f));

// ── target order: pilots (optional) then the sample by selection rank ──
// Targets marked `excluded` (technical preflight failure, SELECTION.md §11)
// never run here — they stay in targets.ts only for provenance.
const entries = Object.entries(EXPERIMENTS);
const excluded = entries.filter(([, t]) => t.excluded).map(([k]) => k);
const pilots = entries.filter(([, t]) => t.pilot && !t.excluded).map(([k]) => k);
const sample = entries
    .filter(([, t]) => !t.pilot && !t.excluded)
    .sort(([, a], [, b]) => (a.selectionRank ?? 999) - (b.selectionRank ?? 999))
    .map(([k]) => k);

let targets = [...(INCLUDE_PILOTS ? pilots : []), ...sample];
if (ONLY) {
    const unknown = ONLY.filter((k) => !(k in EXPERIMENTS));
    if (unknown.length > 0) {
        console.error(`Unknown config key(s): ${unknown.join(", ")}. See --list on the runner.`);
        Deno.exit(1);
    }
    const exc = ONLY.filter((k) => EXPERIMENTS[k].excluded);
    if (exc.length > 0) {
        console.error(
            `${yell("⚠")} running EXCLUDED target(s) on explicit request: ${exc.join(", ")} ` +
                `(${EXPERIMENTS[exc[0]].excluded})`,
        );
    }
    targets = ONLY;
}
targets = targets.filter((k) => !SKIP.has(k));

// ── disk state ───────────────────────────────────────────────────
/** Newest final report for a config (`experiment-<cfg>-<digits>.json`), if any. */
function finalReportOf(cfg: string): string | null {
    const re = new RegExp(`^experiment-${cfg}-\\d+\\.json$`);
    let newest: string | null = null;
    for (const e of Deno.readDirSync(Deno.cwd())) {
        if (e.isFile && re.test(e.name) && (!newest || e.name > newest)) newest = e.name;
    }
    return newest;
}

function hasCheckpoint(cfg: string): boolean {
    try {
        Deno.statSync(`experiment-${cfg}-checkpoint.json`);
        return true;
    } catch {
        return false;
    }
}

interface ReportStats {
    passB: number;
    passE: number;
    goals: number;
    regressions: number;
}

function statsOf(reportFile: string): ReportStats | null {
    try {
        const r = JSON.parse(Deno.readTextFileSync(reportFile)) as {
            baseline: { breakdown: { status: string }[] };
            experiment: { breakdown: { status: string }[] };
            drift: { regressions: unknown[] };
        };
        const pass = (b: { status: string }[]) => b.filter((g) => g.status === "SUCCESS").length;
        return {
            passB: pass(r.baseline.breakdown),
            passE: pass(r.experiment.breakdown),
            goals: Math.max(r.baseline.breakdown.length, r.experiment.breakdown.length),
            regressions: r.drift.regressions.length,
        };
    } catch {
        return null;
    }
}

// ── environment sanity ───────────────────────────────────────────
async function checkEnvironment(needsDocker: boolean): Promise<void> {
    try {
        const res = await fetch(`${ROOKIE_URL}/docs`, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await res.body?.cancel();
    } catch (e) {
        console.error(
            `\n${red("✗")} Rookie is not reachable at ${bold(ROOKIE_URL)} (${
                (e as Error).message
            }).\n  Start the stack first: ${cyan("deno task start")}\n`,
        );
        Deno.exit(1);
    }
    // Only http/db targets need Docker; a pure-only batch does not.
    if (!needsDocker) return;
    const docker = await new Deno.Command("docker", {
        args: ["version"],
        stdout: "null",
        stderr: "null",
    })
        .output().catch(() => ({ code: 1 }));
    if (docker.code !== 0) {
        console.error(
            `\n${red("✗")} Docker daemon is not available — http/db targets need it.\n`,
        );
        Deno.exit(1);
    }
}

// ── run one target (tee output to logs/<cfg>.log) ────────────────
function writeAllSync(w: { writeSync(p: Uint8Array): number }, data: Uint8Array): void {
    let n = 0;
    while (n < data.length) n += w.writeSync(data.subarray(n));
}

const running = new Set<Deno.ChildProcess>();

/**
 * Run one target as a child process, output tee'd to logs/<cfg>.log. With
 * `liveStdout` (sequential mode) the child's output is also mirrored to the
 * console; in parallel mode it is not — interleaving N rich card-based streams
 * on one terminal is unreadable, so the per-target log file is the live view.
 */
async function runTarget(cfg: string, liveStdout: boolean): Promise<number> {
    const log = Deno.openSync(`logs/${cfg}.log`, { write: true, create: true, truncate: true });
    const child = new Deno.Command(Deno.execPath(), {
        args: [
            "run",
            "--allow-all",
            "scripts/experiment-runner.ts",
            "--config",
            cfg,
            ...PASSTHROUGH,
        ],
        stdout: "piped",
        stderr: "piped",
        env: { ROOKIE_URL },
    }).spawn();
    running.add(child);

    const tee = async (stream: ReadableStream<Uint8Array>) => {
        for await (const chunk of stream) {
            if (liveStdout) writeAllSync(Deno.stdout, chunk);
            writeAllSync(log, chunk);
        }
    };
    await Promise.all([tee(child.stdout), tee(child.stderr)]);
    const status = await child.status;
    running.delete(child);
    log.close();
    return status.code;
}

// ── batch summary ────────────────────────────────────────────────
interface TargetResult {
    cfg: string;
    status: "ok" | "failed" | "skipped";
    ms: number;
    stats: ReportStats | null;
}

const results: TargetResult[] = [];

function printSummary(totalMs: number): void {
    const ok = results.filter((r) => r.status === "ok").length;
    const skipped = results.filter((r) => r.status === "skipped").length;
    const failed = results.filter((r) => r.status === "failed");

    card(`Batch summary · ${ok} ran, ${skipped} skipped, ${failed.length} failed`, [
        `${dim("Duration")}  ${fmtDur(totalMs)}`,
        `${dim("Reports ")}  ${Deno.cwd()}`,
        `${dim("Logs    ")}  logs/<config>.log`,
    ]);

    console.log(
        `\n  ${dim("target".padEnd(15))}${dim("status".padEnd(10))}${dim("time".padEnd(9))}${
            dim("goals old→new".padEnd(15))
        }${dim("regressions")}`,
    );
    for (const r of results) {
        const icon = r.status === "ok"
            ? green("✓ ok    ")
            : r.status === "skipped"
            ? gray("· done  ")
            : red("✗ failed");
        const time = r.status === "skipped" ? "—" : fmtDur(r.ms);
        const goals = r.stats
            ? `${r.stats.passB}/${r.stats.goals} → ${
                r.stats.passE >= r.stats.passB
                    ? green(`${r.stats.passE}/${r.stats.goals}`)
                    : red(`${r.stats.passE}/${r.stats.goals}`)
            }`
            : dim("—");
        const regr = r.stats
            ? (r.stats.regressions > 0 ? red(String(r.stats.regressions)) : green("0"))
            : dim("—");
        console.log(
            `  ${r.cfg.padEnd(15)}${padVis(icon, 10)}${time.padEnd(9)}${padVis(goals, 15)}${regr}`,
        );
    }

    if (failed.length > 0) {
        console.log(
            `\n  ${yell("⚠")} Failed: ${failed.map((f) => bold(f.cfg)).join(", ")} — ` +
                `checkpoints kept; ${bold("rerun this script")} to resume them.`,
        );
    }
    console.log();
}

// ── main ─────────────────────────────────────────────────────────
const plan = targets.map((cfg) => {
    const report = finalReportOf(cfg);
    return { cfg, report, resume: !report && hasCheckpoint(cfg) };
});
const pending = plan.filter((p) => !p.report);

// How many targets run concurrently. Default = all pending (full parallel);
// `--jobs N` caps it. Each target uses its own container name + host port
// (targets.ts), so concurrent http/db targets don't collide.
const JOBS = Math.max(1, Number(arg("--jobs") ?? String(Math.max(1, pending.length))) || 1);

card("Rookie · Documentation Drift — full sample", [
    `${dim("Targets ")}  ${targets.length} (${pending.length} to run, ${
        targets.length - pending.length
    } already done)`,
    `${dim("Jobs    ")}  ${JOBS} in parallel${JOBS === 1 ? " (sequential)" : ""}`,
    `${dim("Protocol")}  ${
        PASSTHROUGH.includes("--no-freeze")
            ? yell("ABLATION — goal rerun only, code REGENERATED (no freeze)")
            : "frozen code (paired comparison)"
    }${
        PASSTHROUGH.filter((f) => f !== "--no-freeze").length > 0
            ? dim(` · ${PASSTHROUGH.filter((f) => f !== "--no-freeze").join(" ")}`)
            : ""
    }`,
    `${dim("Rookie  ")}  ${ROOKIE_URL}`,
    `${dim("Pilots  ")}  ${INCLUDE_PILOTS ? "included" : "excluded (--include-pilots to add)"}`,
    ...(excluded.length > 0 && !ONLY
        ? [`${dim("Dropped ")}  ${excluded.length} excluded targets (SELECTION.md §11)`]
        : []),
]);

console.log();
for (const p of plan) {
    const mark = p.report
        ? `${green("✓")} ${dim(`done — ${p.report}`)}`
        : p.resume
        ? `${yell("↻")} ${dim("will resume from checkpoint")}`
        : `${gray("○")} ${dim("pending")}`;
    console.log(`  ${p.cfg.padEnd(15)} ${mark}`);
}

if (DRY_RUN) {
    console.log(`\n${dim("Dry run — nothing executed.")}\n`);
    Deno.exit(0);
}

const needsDocker = pending.some((p) => EXPERIMENTS[p.cfg].runtime !== "pure");
if (pending.length > 0) await checkEnvironment(needsDocker);
Deno.mkdirSync("logs", { recursive: true });

/**
 * Remove containers left behind by earlier crashed/interrupted runs. Sandboxes
 * that outlived their timeout keep consuming Docker-VM memory and CPU (one was
 * observed alive for 38h), which slows every later container and shows up as
 * spurious timeouts. Safe here: nothing of ours is running yet at batch start.
 */
async function sweepOrphanContainers(): Promise<void> {
    try {
        const { stdout } = await new Deno.Command("docker", {
            args: ["ps", "-aq", "--filter", "name=rookie-sbx-", "--filter", "name=rookie-exp-"],
            stdout: "piped",
            stderr: "null",
        }).output();
        const ids = new TextDecoder().decode(stdout).trim().split("\n").filter(Boolean);
        if (ids.length === 0) return;
        await new Deno.Command("docker", {
            args: ["rm", "-f", ...ids],
            stdout: "null",
            stderr: "null",
        }).output();
        console.log(`  ${yell("⚠")} removed ${ids.length} orphaned container(s) from earlier runs`);
    } catch { /* docker unavailable — nothing to sweep */ }
}
if (pending.length > 0) await sweepOrphanContainers();

Deno.addSignalListener("SIGINT", () => {
    console.log(
        `\n\n${yell("⚠")} Interrupted — running targets keep their checkpoints; ` +
            `rerun this script to resume.\n`,
    );
    for (const child of running) {
        try {
            child.kill("SIGINT");
        } catch { /* already gone */ }
    }
    Deno.exit(130);
});

const t0 = Date.now();

// Already-done targets are recorded up front (not re-run).
for (const p of plan) {
    if (p.report) {
        results.push({ cfg: p.cfg, status: "skipped", ms: 0, stats: statsOf(p.report) });
        console.log(
            `  ${green("✓")} ${bold(p.cfg)} ${dim(`already done (${p.report}) — skipping`)}`,
        );
    }
}

// Live console mirroring only makes sense sequentially; in parallel each target's
// log file is the live view (logs/<cfg>.log).
const liveStdout = JOBS === 1;
let aborted = false;

const runOne = async (cfg: string, resume: boolean): Promise<void> => {
    if (aborted) return;
    const t = Date.now();
    console.log(
        `  ${cyan("▶")} ${bold(cfg)} started${resume ? yell(" (resume)") : ""} ` +
            `${dim(`· log: logs/${cfg}.log`)}`,
    );
    const code = await runTarget(cfg, liveStdout);
    const ms = Date.now() - t;
    if (code === 0) {
        const report = finalReportOf(cfg);
        results.push({ cfg, status: "ok", ms, stats: report ? statsOf(report) : null });
        console.log(`  ${green("✓")} ${bold(cfg)} done ${dim(`· ${fmtDur(ms)}`)}`);
    } else {
        results.push({ cfg, status: "failed", ms, stats: null });
        console.log(`  ${red("✗")} ${bold(cfg)} failed (exit ${code}) ${dim(`· ${fmtDur(ms)}`)}`);
        if (BAIL) aborted = true; // stop launching new targets (in-flight ones finish)
    }
};

if (pending.length > 0) {
    console.log(`\n${dim(`Running ${pending.length} target(s), ${JOBS} at a time…`)}\n`);
    // Concurrency pool: at most JOBS targets in flight at once.
    let next = 0;
    const workers = Array.from({ length: Math.min(JOBS, pending.length) }, async () => {
        while (next < pending.length && !aborted) {
            const p = pending[next++];
            await runOne(p.cfg, p.resume);
        }
    });
    await Promise.all(workers);
}

printSummary(Date.now() - t0);
Deno.exit(results.filter((r) => r.status === "failed").length > 0 ? 1 : 0);
