#!/usr/bin/env -S deno run --allow-all
/**
 * experiment-runner.ts
 *
 * Documentation-drift experiment. The unit under test is an npm library and the
 * drift axis is its VERSION. Depending on the target's runtime (SELECTION.md §7)
 * a throwaway container may back the run, held constant across both phases:
 *   • "pure" — no container (CLI/parser/build libraries);
 *   • "http" — an httpbin container (HTTP clients; ctx.baseUrl);
 *   • "db"   — a Postgres container (ORMs; ctx.connectionString).
 *
 *  Phase 1 — Index:      fetch OLD-version docs → Rookie project
 *  Phase 2 — Baseline:   OLD docs × <pkg>@oldVersion → Master Planner (gen + run goals)
 *  Phase 3 — Experiment: same goals × <pkg>@newVersion (planner/rerun)
 *  Phase 4 — Report:     diff structured summaries, save JSON + full report bundle
 *
 * Crash resilience: after each phase a checkpoint
 * (`experiment-<config>-checkpoint.json`) records the ids produced so far
 * (projectId, baseline/experiment master-plan ids). On the next invocation the
 * runner AUTOMATICALLY resumes from the checkpoint — completed phases are
 * skipped and their results re-fetched from Rookie's database. The checkpoint
 * is deleted on success. `--fresh` discards it and starts over.
 *
 * The experiment phase re-executes the baseline's generated programs VERBATIM
 * (freeze) against the new version, so drift is measured on identical code and
 * the agent cannot regenerate around the change. `--no-freeze` restores the old
 * regenerate-per-version behaviour. `--ablation` adds a no-docs arm (rerun the
 * goals without documentation) to measure the documentation's value.
 *
 * Usage:
 *   deno run --allow-all scripts/experiment-runner.ts --config execa
 *   deno run --allow-all scripts/experiment-runner.ts --config typeorm --verbose
 *   deno run --allow-all scripts/experiment-runner.ts --config execa --ablation
 *   deno run --allow-all scripts/experiment-runner.ts --config execa --no-freeze
 *   deno run --allow-all scripts/experiment-runner.ts --config execa --fresh
 *   deno run --allow-all scripts/experiment-runner.ts --config execa \
 *       --project-id <id> --baseline-id <masterPlanId>   # manual recovery
 *   ROOKIE_URL=http://localhost:3000 deno run --allow-all scripts/experiment-runner.ts
 */

// ─────────────────────────────────────────────────────────────────
//  ANSI COLORS
// ─────────────────────────────────────────────────────────────────
import {
    type ContainerConfig,
    type DocsConfig,
    EXPERIMENTS,
    type HealthConfig,
    type PlannerConfig,
} from "./experiments/targets.ts";
import {
    CHANGELOG_SEEDS,
    driftEvidenceSignals,
    expectedApiSymbols,
    renderChangelogSeed,
    scoreBreakingChanges,
} from "../src/eval/changelogSeed.ts";
import { analyzeStepDrift, type GoalSteps } from "../src/eval/stepDrift.ts";

const isTTY = Deno.stdout.isTerminal();
const c = isTTY
    ? {
        R: "\x1b[0m",
        b: "\x1b[1m",
        d: "\x1b[2m",
        rd: "\x1b[31m",
        gr: "\x1b[32m",
        ye: "\x1b[33m",
        bl: "\x1b[34m",
        mg: "\x1b[35m",
        cy: "\x1b[36m",
        gy: "\x1b[90m",
    }
    : Object.fromEntries(
        ["R", "b", "d", "rd", "gr", "ye", "bl", "mg", "cy", "gy"].map((k) => [k, ""]),
    ) as Record<string, string>;

const bold = (s: string) => `${c.b}${s}${c.R}`;
const dim = (s: string) => `${c.d}${c.gy}${s}${c.R}`;
const green = (s: string) => `${c.gr}${s}${c.R}`;
const red = (s: string) => `${c.rd}${s}${c.R}`;
const yell = (s: string) => `${c.ye}${s}${c.R}`;
const cyan = (s: string) => `${c.cy}${s}${c.R}`;
const gray = (s: string) => `${c.gy}${s}${c.R}`;

// ─────────────────────────────────────────────────────────────────
//  RUNNER-LOCAL TYPES
//  (target configs + their types live in ./experiments/targets.ts;
//   the selection protocol is documented in ./experiments/SELECTION.md)
// ─────────────────────────────────────────────────────────────────
interface GoalResult {
    goal: string;
    status: string;
    reportId: string | null;
}

interface MasterPlanRun {
    masterPlan: Record<string, unknown> | null;
    goals: string[];
    breakdown: GoalResult[];
}

// ─────────────────────────────────────────────────────────────────
//  CLI ARGS
// ─────────────────────────────────────────────────────────────────
const arg = (k: string): string | null => {
    const i = Deno.args.indexOf(k);
    return i !== -1 ? Deno.args[i + 1] ?? null : null;
};
const flag = (k: string): boolean => Deno.args.includes(k);

const configName = arg("--config") ?? "execa";
const VERBOSE = flag("--verbose") || flag("-v");
/** Discard any checkpoint and start the experiment from scratch. */
const FRESH = flag("--fresh");
/** Manual-recovery overrides (seed the checkpoint with known-good ids). */
const OVERRIDE_PROJECT_ID = arg("--project-id");
const OVERRIDE_BASELINE_ID = arg("--baseline-id");
/** Regenerate the experiment phase instead of freezing baseline code (old behaviour). */
const NO_FREEZE = flag("--no-freeze");
/** Add a docs-ablation arm: rerun the baseline goals WITHOUT docs to measure doc value. */
const ABLATION = flag("--ablation");

if (flag("--list")) {
    console.log("Available experiment targets:\n");
    for (const [key, t] of Object.entries(EXPERIMENTS)) {
        const mark = t.pilot
            ? " [pilot]"
            : t.selectionRank
            ? ` [sample, rank ${t.selectionRank}]`
            : "";
        const excl = t.excluded ? ` [EXCLUDED — ${t.excluded}]` : "";
        const backing = t.runtime === "pure" ? "pure" : `${t.runtime} · ${t.image}`;
        const drift =
            `${t.library.pkg} ${t.library.oldVersion} -> ${t.library.newVersion} (${backing})`;
        console.log(`  ${key.padEnd(14)} ${drift}${mark}${excl}`);
    }
    Deno.exit(0);
}
const cfg = EXPERIMENTS[configName];

if (!cfg) {
    console.error(
        `Unknown config "${configName}". Available: ${Object.keys(EXPERIMENTS).join(", ")}`,
    );
    Deno.exit(1);
}
if (cfg.excluded) {
    console.error(
        `⚠ "${configName}" is excluded from the sample (${cfg.excluded}) — ` +
            `running it manually for investigation only; its results are NOT part of the study.`,
    );
}

const ROOKIE_URL = (Deno.env.get("ROOKIE_URL") ?? "http://localhost:3000").replace(/\/$/, "");
const enc = new TextEncoder();

// ─────────────────────────────────────────────────────────────────
//  UTILITIES
// ─────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function fill(value: unknown, vars: Record<string, unknown>): unknown {
    if (typeof value === "string") {
        return value.replace(
            /\{(\w+)\}/g,
            (_, k) => (vars[k] != null ? String(vars[k]) : `{${k}}`),
        );
    }
    if (Array.isArray(value)) {
        return value.map((v) => fill(v, vars));
    }
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, fill(v, vars)]),
        );
    }
    return value;
}

// Visual kit — calm, stream-friendly presentation: a rounded header card,
// numbered phase brackets (┌─ … ╰─) with elapsed times, and a results card.
const W = 64;
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const visLen = (s: string) => stripAnsi(s).length;
const padVis = (s: string, w: number) => s + " ".repeat(Math.max(0, w - visLen(s)));

function fmtDur(ms: number): string {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
    return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** Rounded card with a title and aligned label/value rows. */
function card(title: string, rows: [string, string][], width = W): void {
    const inner = width - 2;
    console.log(`\n${gray("╭" + "─".repeat(inner) + "╮")}`);
    console.log(`${gray("│")} ${padVis(bold(title), inner - 2)} ${gray("│")}`);
    if (rows.length > 0) {
        console.log(`${gray("│")}${" ".repeat(inner)}${gray("│")}`);
        const lw = Math.max(...rows.map(([l]) => l.length));
        for (const [label, value] of rows) {
            const line = `${dim(label.padEnd(lw))}  ${value}`;
            console.log(`${gray("│")} ${padVis(line, inner - 2)} ${gray("│")}`);
        }
    }
    console.log(`${gray("╰" + "─".repeat(inner) + "╯")}`);
}

let phaseStartedAt = 0;

/** Open a numbered phase bracket; content lines keep the `│` gutter. */
function phase(n: number, total: number, title: string, note?: string): void {
    phaseStartedAt = Date.now();
    const label = ` ${bold(cyan(`Phase ${n}/${total}`))} ${gray("·")} ${bold(title)}` +
        (note ? `  ${dim(note)}` : "") + " ";
    console.log(`\n${gray("┌─")}${label}${gray("─".repeat(Math.max(2, W - visLen(label) - 2)))}`);
}

/** Close the current phase bracket with a status note and elapsed time. */
function phaseEnd(note = "done", ok = true): void {
    const icon = ok ? green("✓") : yell("⚠");
    console.log(`${gray("╰─")} ${icon} ${note} ${dim(`· ${fmtDur(Date.now() - phaseStartedAt)}`)}`);
}

function writeStdout(s: string): void {
    Deno.stdout.writeSync(enc.encode(s));
}

// ─────────────────────────────────────────────────────────────────
//  DOCKER
// ─────────────────────────────────────────────────────────────────
async function docker(...args: string[]): Promise<{ code: number; stderr: string }> {
    const { code, stderr } = await new Deno.Command("docker", {
        args,
        stdout: "null",
        stderr: "piped",
    }).output();
    return { code, stderr: new TextDecoder().decode(stderr) };
}

async function dockerStop(name: string): Promise<void> {
    await new Deno.Command("docker", { args: ["stop", name], stdout: "null", stderr: "null" })
        .output().catch(() => {});
    await new Deno.Command("docker", { args: ["rm", name], stdout: "null", stderr: "null" })
        .output().catch(() => {});
}

async function dockerStart(image: string, container: ContainerConfig): Promise<void> {
    await dockerStop(container.name);
    const envArgs = Object.entries(container.env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
    const args = [
        "run",
        "-d",
        "--name",
        container.name,
        "-p",
        `${container.hostPort}:${container.port}`,
        ...envArgs,
        image,
        ...(container.cmd ?? []),
    ];
    console.log(`${gray("│")}  ${yell("▸")} docker: starting ${bold(image)}`);
    const { code, stderr } = await docker(...args);
    if (code !== 0) throw new Error(`Failed to start ${image}: ${stderr}`);
}

/** True when a TCP socket to host:port opens — the readiness probe for DB engines. */
async function tcpOpen(hostPort: string): Promise<boolean> {
    const [host, portStr] = hostPort.split(":");
    try {
        const conn = await Deno.connect({ hostname: host || "localhost", port: Number(portStr) });
        conn.close();
        return true;
    } catch {
        return false;
    }
}

async function waitHealthy(healthCfg: HealthConfig, vars: Record<string, unknown>): Promise<void> {
    const target = fill(healthCfg.url, vars) as string;
    for (let i = 1; i <= healthCfg.retries; i++) {
        try {
            const ok = healthCfg.mode === "tcp"
                ? await tcpOpen(target)
                : (await fetch(target, { signal: AbortSignal.timeout(3000) })).ok;
            if (ok) {
                writeStdout("\r" + " ".repeat(60) + "\r");
                console.log(`${gray("│")}  ${green("✓")} container healthy on :${vars.hostPort}`);
                return;
            }
        } catch { /* not ready */ }
        writeStdout(`\r${gray("│")}  ${gray(`waiting for health… ${i}/${healthCfg.retries}`)}`);
        await sleep(healthCfg.intervalMs);
    }
    writeStdout("\n");
    throw new Error(`Container not healthy after ${healthCfg.retries} retries`);
}

// ─────────────────────────────────────────────────────────────────
//  ROOKIE API
// ─────────────────────────────────────────────────────────────────
async function rookieCall<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${ROOKIE_URL}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body != null ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
        throw new Error(`Rookie ${method} ${path} → HTTP ${res.status}: ${await res.text()}`);
    }
    return res.json() as Promise<T>;
}

async function uploadFileToRookie(filename: string, content: string): Promise<{ id: string }> {
    const form = new FormData();
    form.append("file", new Blob([content], { type: "text/markdown" }), filename);
    const res = await fetch(`${ROOKIE_URL}/files/upload`, { method: "POST", body: form });
    if (!res.ok) throw new Error(`File upload failed: HTTP ${res.status}: ${await res.text()}`);
    return res.json() as Promise<{ id: string }>;
}

async function ingestDocs(
    docsCfg: DocsConfig,
    vars: Record<string, unknown>,
): Promise<{ id: string; files?: unknown[] }> {
    // The OLD-tag README + in-repo docs, fetched verbatim and uploaded as one
    // file each — the FULL version-pinned doc set for the old library version.
    const url = fill(docsCfg.url, vars) as string;
    const urls = [url, ...((docsCfg.extraFiles ?? []).map((u) => fill(u, vars) as string))];
    console.log(
        `${gray("│")}  ${yell("▸")} fetching docs (raw markdown): ${urls.length} file(s)`,
    );
    const pkgSlug = cfg.library.pkg.replace(/[^\w.-]/g, "_");
    const fileIds: string[] = [];
    let totalChars = 0;
    for (const fileUrl of urls) {
        const res = await fetch(fileUrl, {
            signal: AbortSignal.timeout(20_000),
            headers: { "User-Agent": "rookie-experiment/1.0" },
        });
        if (!res.ok) throw new Error(`Cannot fetch ${fileUrl}: HTTP ${res.status}`);
        const markdown = await res.text();
        if (markdown.length < 100) {
            throw new Error(`Docs file too small (${markdown.length} B): ${fileUrl}`);
        }
        totalChars += markdown.length;
        const base = fileUrl.split("/").pop()?.replace(/[^\w.-]/g, "_") || "doc.md";
        const fname = `${configName}-${pkgSlug}-${base}`;
        const file = await uploadFileToRookie(fname, markdown);
        fileIds.push(file.id);
        console.log(`${gray("│")}    ${dim(`${base} — ${markdown.length} B`)}`);
    }
    console.log(
        `${gray("│")}  ${yell("▸")} uploaded ${fileIds.length} file(s), ${totalChars} chars (~${
            Math.round(totalChars / 4)
        } tokens)`,
    );
    const project = await rookieCall<{ id: string; files?: unknown[] }>("POST", "/projects", {
        projectName: `${cfg.name} docs – ${cfg.library.oldVersion}`,
        fileIds,
    });
    console.log(`${gray("│")}  ${green("✓")} project created: ${bold(project.id)}`);
    return project;
}

// ─────────────────────────────────────────────────────────────────
//  NDJSON STREAM  (master planner uses streamText → NDJSON)
// ─────────────────────────────────────────────────────────────────
async function* ndJsonStream(url: string, body: unknown): AsyncGenerator<Record<string, unknown>> {
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Planner stream HTTP ${res.status}: ${await res.text()}`);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
            const t = line.trim();
            if (t) {
                try {
                    yield JSON.parse(t);
                } catch { /* skip malformed */ }
            }
        }
    }
    if (buf.trim()) {
        try {
            yield JSON.parse(buf.trim());
        } catch { /* trailing data */ }
    }
}

// ─────────────────────────────────────────────────────────────────
//  AGENT ACTIVITY RENDERER
//  Renders the structured agent events (token / tool_call / tool_result /
//  assistant_end / phase / log) that arrive inside each GOAL_PROGRESS.
//  On a TTY it shows a live, in-place "typing" line that collapses into a
//  tidy one-line summary once each unit finishes. When piped, it prints only
//  the collapsed summaries (no token spam).
// ─────────────────────────────────────────────────────────────────
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const GUTTER = `${gray("│")}  `;

/** Flatten to a single line and clamp to the terminal tail (keeps the newest text). */
function oneLine(s: string, max = 76): string {
    const flat = s.replace(/\s+/g, " ").trim();
    return flat.length > max ? "…" + flat.slice(flat.length - max + 1) : flat;
}

/** Strip control sentinels the agent uses internally so they don't leak into summaries. */
function cleanThought(s: string): string {
    return s
        .replace(/READY_FOR_GENERATION|VERIFICATION_COMPLETE|NEEDS_RESEARCH:/g, "")
        .trim();
}

function createAgentRenderer() {
    let streamBuf = "";
    let spin = 0;
    let liveActive = false;

    const clearLive = () => {
        if (liveActive && isTTY) writeStdout("\r\x1b[2K");
        liveActive = false;
    };
    const commit = (line: string) => {
        clearLive();
        console.log(GUTTER + line);
    };

    const reset = () => {
        clearLive();
        streamBuf = "";
    };

    const feed = (raw: string) => {
        let ev: Record<string, unknown>;
        try {
            ev = JSON.parse(raw);
        } catch {
            ev = { type: "log", content: raw };
        }

        switch (ev.type) {
            case "phase":
                clearLive();
                streamBuf = "";
                console.log(GUTTER + dim(`◆ ${ev.content}`));
                break;

            case "token": {
                streamBuf += String(ev.content ?? "");
                if (isTTY) {
                    spin = (spin + 1) % SPINNER.length;
                    writeStdout(
                        `\r\x1b[2K${GUTTER}${cyan(SPINNER[spin])} ${dim(oneLine(streamBuf))}`,
                    );
                    liveActive = true;
                }
                break;
            }

            case "assistant_end": {
                const summary = oneLine(cleanThought(String(ev.content ?? streamBuf)), 80);
                if (summary) commit(`${cyan("◇")} ${summary}`);
                else clearLive();
                streamBuf = "";
                break;
            }

            case "tool_call": {
                const args = ev.args && typeof ev.args === "object"
                    ? oneLine(
                        Object.values(ev.args as Record<string, unknown>).map(String).join("  "),
                        60,
                    )
                    : "";
                commit(`${yell("⚙")} ${bold(String(ev.name))}${args ? "  " + dim(args) : ""}`);
                break;
            }

            case "tool_result":
                commit(`  ${gray("↳")} ${dim(oneLine(String(ev.preview ?? ""), 80))}`);
                break;

            case "log": {
                const txt = String(ev.content ?? "");
                // Hide the high-frequency context-budget chatter unless --verbose.
                if (!VERBOSE && /^Context size:|^Token budget|^Context after/.test(txt)) break;
                commit(dim(oneLine(txt, 90)));
                break;
            }
        }
    };

    return { feed, reset, clearLive };
}

// ─────────────────────────────────────────────────────────────────
//  MASTER PLANNER
// ─────────────────────────────────────────────────────────────────
async function runMasterPlanner(
    projectId: string,
    plannerCfg: PlannerConfig,
    vars: Record<string, unknown>,
    /** When set, calls /planner/rerun instead of /planner/run — reuses goals from this master plan. */
    rerunFromMasterPlanId?: string,
    /** npm install pins for this phase (library drift: `<pkg>@<version>`). */
    packageOverrides?: Record<string, string>,
    /** Changelog-drift seed — steers goal generation on the baseline run only. */
    changelogSeed?: string,
    /** Methodology levers (see THREATS): freeze re-execution, docs ablation, and
     *  the documented API symbols goals should exercise (faithfulness). */
    extra?: { freeze?: boolean; withoutDocs?: boolean; expectedApis?: string[] },
): Promise<MasterPlanRun> {
    const context = fill(plannerCfg.initialContext, vars) as string;

    let masterPlan: Record<string, unknown> | null = null;
    let goals: string[] = [];
    const breakdown: GoalResult[] = [];

    const agent = createAgentRenderer();

    const streamBody = rerunFromMasterPlanId
        ? {
            masterPlanId: rerunFromMasterPlanId,
            projectId,
            initialContext: context,
            packageOverrides,
            freeze: extra?.freeze,
            withoutDocs: extra?.withoutDocs,
            expectedApis: extra?.expectedApis,
            // A frozen rerun scores ONLY the baseline's verbatim programs, so the
            // doc-example smoke phase carries no signal there — skipping it saves
            // up to 10 containers + installs per target.
            skipDocExamples: extra?.freeze === true,
        }
        : {
            projectId,
            maxGoals: plannerCfg.maxGoals,
            initialContext: context,
            packageOverrides,
            changelogSeed,
            withoutDocs: extra?.withoutDocs,
            expectedApis: extra?.expectedApis,
        };
    const streamPath = rerunFromMasterPlanId ? "/planner/rerun" : "/planner/run";

    for await (const event of ndJsonStream(`${ROOKIE_URL}${streamPath}`, streamBody)) {
        switch (event.type) {
            case "INIT":
                if (VERBOSE) console.log(`${gray("│")}  ${dim(`init: ${event.projectId}`)}`);
                break;

            case "log":
                if (VERBOSE) console.log(`${gray("│")}  ${dim(String(event.content))}`);
                break;

            case "GOALS_GENERATED": {
                goals = event.goals as string[];
                const goalsLabel = event.note
                    ? `${goals.length} goals (reused from prior run):`
                    : `${goals.length} goals generated:`;
                console.log(`${gray("│")}  ${cyan("◆")} ${bold(goalsLabel)}`);
                goals.forEach((g, i) => console.log(`${gray("│")}    ${gray(`${i + 1}.`)} ${g}`));
                break;
            }

            case "GOAL_START":
                agent.reset();
                console.log(`${gray("│")}`);
                console.log(
                    `${gray("│")}  ${yell("▶")} ${
                        bold(`[${Number(event.index) + 1}/${event.total}]`)
                    } ${event.goal}`,
                );
                break;

            case "GOAL_PROGRESS":
                // event.log is itself a structured agent event (token/tool_call/…).
                agent.feed(String(event.log));
                break;

            case "GOAL_COMPLETE": {
                agent.clearLive();
                const status = String(event.status);
                const icon = status === "SUCCESS"
                    ? green("✓")
                    : status === "PARTIAL_FAILURE"
                    ? yell("◐")
                    : red("✗");
                const stat = status === "SUCCESS"
                    ? green(status)
                    : status === "PARTIAL_FAILURE"
                    ? yell(status)
                    : red(status);
                console.log(
                    `${gray("│")}       ${icon} ${stat}  ${
                        event.reportId ? gray(String(event.reportId)) : ""
                    }`,
                );
                breakdown.push({
                    goal: String(event.goal),
                    status,
                    reportId: event.reportId as string | null ?? null,
                });
                break;
            }

            case "SUMMARY_GENERATED":
                console.log(`${gray("│")}`);
                console.log(`${gray("│")}  ${cyan("◆")} ${bold("Executive Summary:")}`);
                String(event.summary ?? "").split("\n").slice(0, 8).forEach((l) =>
                    console.log(`${gray("│")}    ${l}`)
                );
                break;

            case "COMPLETE":
                {
                    masterPlan = event.result as Record<string, unknown>;
                    const id = planId(masterPlan);
                    console.log(`${gray("│")}`);
                    console.log(
                        `${gray("│")}  ${green("✓")} master plan complete  ${id ? gray(id) : ""}`,
                    );
                }
                break;

            case "ERROR":
                console.log(`${gray("│")}  ${red("✗ ERROR:")} ${event.message}`);
                throw new Error(`Master planner failed: ${event.message}`);
        }
    }

    return { masterPlan, goals, breakdown };
}

// ─────────────────────────────────────────────────────────────────
//  CHECKPOINT / RESUME
//  Written after every completed phase so a crash mid-experiment loses at
//  most the phase that was in flight. Auto-loaded on the next run; --fresh
//  discards it. Deleted after the final report is written.
// ─────────────────────────────────────────────────────────────────
interface Checkpoint {
    config: string;
    /** Container image (constant across phases); undefined for pure targets. */
    image?: string;
    updatedAt: string;
    projectId?: string;
    baselineMasterPlanId?: string;
    experimentMasterPlanId?: string;
}

const CHECKPOINT_FILE = `${Deno.cwd()}/experiment-${configName}-checkpoint.json`;

let warnedCheckpointMismatch = false;

function loadCheckpoint(): Checkpoint | null {
    try {
        const ckpt = JSON.parse(Deno.readTextFileSync(CHECKPOINT_FILE)) as Checkpoint;
        if (ckpt.image !== cfg.image) {
            if (!warnedCheckpointMismatch) {
                warnedCheckpointMismatch = true;
                console.log(
                    `${yell("⚠")} checkpoint ${CHECKPOINT_FILE} was made for image ` +
                        `${ckpt.image ?? "(pure)"}, but the config now says ` +
                        `${cfg.image ?? "(pure)"} — ignoring it (starting fresh).`,
                );
            }
            return null;
        }
        return ckpt;
    } catch {
        return null;
    }
}

function saveCheckpoint(patch: Partial<Checkpoint>): void {
    const base: Checkpoint = loadCheckpoint() ?? {
        config: configName,
        image: cfg.image,
        updatedAt: "",
    };
    const next = { ...base, ...patch, updatedAt: new Date().toISOString() };
    Deno.writeTextFileSync(CHECKPOINT_FILE, JSON.stringify(next, null, 2));
}

function clearCheckpoint(): void {
    try {
        Deno.removeSync(CHECKPOINT_FILE);
    } catch { /* nothing to clear */ }
}

/** True when the checkpointed project still exists server-side. */
async function projectExists(id: string): Promise<boolean> {
    try {
        await rookieCall("GET", `/projects/${id}`);
        return true;
    } catch {
        return false;
    }
}

/**
 * Rebuild a MasterPlanRun from a saved MASTER_PLAN report so a completed
 * phase can be skipped on resume. Returns null when the report is missing
 * or not a master plan (the phase then re-runs normally).
 */
/**
 * Master-plan id, tolerant of the two shapes it arrives in: the streamed
 * COMPLETE result carries Mongo's `_id`, but a report fetched from the
 * `/reports` API is serialised with `id`. Reading only `_id` silently loses the
 * id on the resume path — which drops Phase 3 into generating FRESH goals
 * instead of re-running the baseline's, making the two phases incomparable.
 */
const planId = (p: Record<string, unknown> | null | undefined): string | undefined =>
    (p?._id ?? p?.id) as string | undefined;

async function fetchMasterPlanRun(masterPlanId: string): Promise<MasterPlanRun | null> {
    try {
        const plan = await rookieCall<Record<string, unknown>>("GET", `/reports/${masterPlanId}`);
        if (plan.type !== "MASTER_PLAN") return null;
        const summary = plan.structuredSummary as Record<string, unknown> | undefined;
        const breakdown = ((summary?.goalsBreakdown ?? []) as Record<string, unknown>[])
            .map((g) => ({
                goal: String(g.goal ?? ""),
                status: String(g.status ?? "FAILED"),
                reportId: (g.reportId as string | null) ?? null,
            }));
        return {
            masterPlan: plan,
            goals: (plan.masterPlanGoals ?? []) as string[],
            breakdown,
        };
    } catch {
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────
//  FULL REPORT DOWNLOAD
//  Persists the complete master-plan documents AND every per-goal report
//  (masterPlanReports) to disk, so the experiment artefacts survive
//  independently of the Rookie database.
// ─────────────────────────────────────────────────────────────────
async function downloadFullReports(
    baselineId: string | null,
    experimentId: string | null,
    outBase: string,
): Promise<{
    file: string | null;
    goalReports: number;
    /** Fetched plans + per-goal reports, reused for step-level drift analysis. */
    plans: Record<string, Record<string, unknown>>;
    reports: Record<string, unknown>;
}> {
    const bundle: Record<string, unknown> = {};
    const goalReports: Record<string, unknown> = {};
    const plans: Record<string, Record<string, unknown>> = {};
    let fetched = 0;

    for (const [key, id] of [["baseline", baselineId], ["experiment", experimentId]] as const) {
        if (!id) continue;
        try {
            const plan = await rookieCall<Record<string, unknown>>("GET", `/reports/${id}`);
            bundle[key] = plan;
            plans[key] = plan;
            for (const rid of (plan.masterPlanReports ?? []) as string[]) {
                if (rid in goalReports) continue;
                try {
                    goalReports[rid] = await rookieCall("GET", `/reports/${rid}`);
                    fetched++;
                } catch {
                    goalReports[rid] = { error: "failed to fetch" };
                }
            }
        } catch {
            console.log(`${gray("│")}  ${yell("⚠")} could not fetch full report ${id}`);
        }
    }
    if (Object.keys(bundle).length === 0) {
        return { file: null, goalReports: 0, plans, reports: goalReports };
    }

    bundle.goalReports = goalReports;
    const file = `${outBase}-full-reports.json`;
    Deno.writeTextFileSync(file, JSON.stringify(bundle, null, 2));
    return { file, goalReports: fetched, plans, reports: goalReports };
}

/**
 * Reshape a master plan + its per-goal reports into the goal→steps structure the
 * step-level drift analysis consumes. Each step is one generated program.
 */
function toGoalSteps(
    plan: Record<string, unknown> | undefined,
    reports: Record<string, unknown>,
): GoalSteps[] {
    const summary = plan?.structuredSummary as Record<string, unknown> | undefined;
    const breakdown = (summary?.goalsBreakdown ?? []) as Record<string, unknown>[];
    return breakdown.map((g) => {
        const rep = reports[String(g.reportId)] as Record<string, unknown> | undefined;
        const steps = (rep?.steps ?? []) as Record<string, unknown>[];
        return {
            goal: String(g.goal ?? ""),
            steps: steps.map((s) => {
                const fa = s.failureAnalysis as Record<string, unknown> | undefined;
                return {
                    stepIndex: Number(s.stepIndex ?? 0),
                    status: String(s.status ?? "FAILED"),
                    description: String(s.stepDescription ?? ""),
                    evidence: [s.error, fa?.failedFunction, fa?.reasoning, fa?.suggestedDocsFix]
                        .filter(Boolean).join(" ").slice(0, 1500),
                };
            }),
        };
    });
}

// ─────────────────────────────────────────────────────────────────
//  DRIFT ANALYSIS
//  Status-aware: SUCCESS (2) > PARTIAL_FAILURE (1) > FAILED (0).
//  A drop in rank is a regression (e.g. SUCCESS → PARTIAL_FAILURE),
//  a rise is an improvement — partial failures are signal, not noise.
// ─────────────────────────────────────────────────────────────────
const STATUS_RANK: Record<string, number> = { SUCCESS: 2, PARTIAL_FAILURE: 1, FAILED: 0 };
const rankOf = (s: string) => STATUS_RANK[s] ?? 0;

function analyzeDrift(baselineBreakdown: GoalResult[], experimentBreakdown: GoalResult[]) {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();

    const regressions: Array<
        { goal: string; baseline: string; experiment: string; reportId: string | null }
    > = [];
    const improvements: Array<{ goal: string; baseline: string; experiment: string }> = [];
    const stable: Array<{ goal: string; status: string }> = [];

    for (const b of baselineBreakdown) {
        const match = experimentBreakdown.find((e) => norm(e.goal) === norm(b.goal)) ??
            experimentBreakdown[baselineBreakdown.indexOf(b)];
        if (!match) continue;

        if (rankOf(match.status) < rankOf(b.status)) {
            regressions.push({
                goal: b.goal,
                baseline: b.status,
                experiment: match.status,
                reportId: match.reportId,
            });
        } else if (rankOf(match.status) > rankOf(b.status)) {
            improvements.push({ goal: b.goal, baseline: b.status, experiment: match.status });
        } else {
            stable.push({ goal: b.goal, status: b.status });
        }
    }

    return { regressions, improvements, stable };
}

// ─────────────────────────────────────────────────────────────────
//  DOCS PATCH  (fetch the aggregated documentation fix proposal)
// ─────────────────────────────────────────────────────────────────
async function fetchDocsPatch(
    masterPlanId: string | null,
    outBase: string,
): Promise<
    {
        patchFile: string | null;
        markdownFile: string | null;
        patchedClusters: number;
        unpatchedClusters: number;
    }
> {
    const empty = { patchFile: null, markdownFile: null, patchedClusters: 0, unpatchedClusters: 0 };
    if (!masterPlanId) return empty;
    try {
        const [diffRes, mdRes] = await Promise.all([
            fetch(`${ROOKIE_URL}/reports/${masterPlanId}/docs-patch?format=diff`),
            fetch(`${ROOKIE_URL}/reports/${masterPlanId}/docs-patch?format=markdown`),
        ]);
        if (!diffRes.ok || !mdRes.ok) return empty;

        const patched = Number(diffRes.headers.get("X-Patched-Clusters") ?? "0");
        const unpatched = Number(diffRes.headers.get("X-Unpatched-Clusters") ?? "0");
        const diff = await diffRes.text();
        const md = await mdRes.text();

        let patchFile: string | null = null;
        let markdownFile: string | null = null;
        if (diff.trim()) {
            patchFile = `${outBase}-docs.patch`;
            Deno.writeTextFileSync(patchFile, diff);
        }
        if (md.trim()) {
            markdownFile = `${outBase}-docs-proposal.md`;
            Deno.writeTextFileSync(markdownFile, md);
        }
        return { patchFile, markdownFile, patchedClusters: patched, unpatchedClusters: unpatched };
    } catch {
        return empty;
    }
}

// ─────────────────────────────────────────────────────────────────
//  FINAL REPORT PRINT
// ─────────────────────────────────────────────────────────────────
function printFinalSummary(report: Record<string, unknown>, totalMs?: number): void {
    const { meta, baseline, experiment, drift, docsPatch } = report as {
        meta: {
            project: string;
            library: string;
            oldVersion: string;
            newVersion: string;
            runtime: string;
            image?: string | null;
            projectId: string;
            outputFile: string;
            fullReportsFile?: string | null;
        };
        baseline: { breakdown: GoalResult[]; structuredSummary: Record<string, unknown> | null };
        experiment: { breakdown: GoalResult[]; structuredSummary: Record<string, unknown> | null };
        drift: {
            regressions: Array<{ goal: string; experiment: string }>;
            improvements: Array<{ goal: string }>;
        };
        docsPatch?: {
            patchFile: string | null;
            markdownFile: string | null;
            patchedClusters: number;
            unpatchedClusters: number;
        };
    };

    const passOf = (b: GoalResult[]) => b.filter((r) => r.status === "SUCCESS").length;
    const partialOf = (b: GoalResult[]) => b.filter((r) => r.status === "PARTIAL_FAILURE").length;
    const passB = passOf(baseline.breakdown);
    const passE = passOf(experiment.breakdown);
    const partB = partialOf(baseline.breakdown);
    const partE = partialOf(experiment.breakdown);
    const n = Math.max(baseline.breakdown.length, experiment.breakdown.length);
    const bar = (pass: number, total: number, width = 12) => {
        const filled = total === 0 ? 0 : Math.round((pass / total) * width);
        return green("█".repeat(filled)) + gray("░".repeat(width - filled));
    };

    card(`Results · ${meta.project}`, [
        [
            "Library",
            `${meta.library} ${meta.oldVersion} ${gray("→")} ${meta.newVersion}` +
            (meta.image ? gray(`  (${meta.runtime} · ${meta.image})`) : gray("  (pure)")),
        ],
        ["Report", meta.outputFile],
        ...(meta.fullReportsFile ? [["Bundle", meta.fullReportsFile] as [string, string]] : []),
        ...(totalMs !== undefined ? [["Duration", fmtDur(totalMs)] as [string, string]] : []),
    ]);

    console.log(`\n  ${bold("Goal pass rate")}`);
    console.log(
        `    ${dim("baseline  ")}  ${bar(passB, n)}  ${bold(green(`${passB}/${n}`))}` +
            (partB ? yell(`  +${partB} partial`) : ""),
    );
    console.log(
        `    ${dim("experiment")}  ${bar(passE, n)}  ${
            bold(passE >= passB ? green(`${passE}/${n}`) : red(`${passE}/${n}`))
        }` + (partE ? yell(`  +${partE} partial`) : ""),
    );

    if (drift.regressions.length === 0) {
        console.log(`\n  ${green("✓")} No regressions — documentation stable across versions.`);
    } else {
        console.log(
            `\n  ${red("⚠")} ${
                bold(red(`${drift.regressions.length} regression(s)`))
            } — documentation drift detected`,
        );
        for (const r of drift.regressions) {
            console.log(`    ${red("•")} ${bold(r.goal)}`);
            console.log(`      ${green("SUCCESS")} ${gray("→")} ${red(r.experiment)}`);
        }
    }

    if (drift.improvements.length > 0) {
        console.log(
            `\n  ${cyan("↑")} ${drift.improvements.length} improvement(s) in new version`,
        );
        drift.improvements.forEach((r) => console.log(`    ${cyan("•")} ${r.goal}`));
    }

    const tax = (experiment.structuredSummary?.failureTaxonomy ?? {}) as Record<string, number>;
    if (Object.keys(tax).length > 0) {
        console.log(`\n  ${bold("Failure taxonomy (experiment):")}`);
        for (const [cls, cnt] of Object.entries(tax).sort(([, a], [, b]) => b - a)) {
            const bar = "█".repeat(Math.min(cnt * 2, 20));
            console.log(`    ${yell(cls.padEnd(14))} ${bar} ${cnt}`);
        }
    }

    const gaps = (experiment.structuredSummary?.documentationGapDetails ?? []) as Array<{
        fragment: string;
        proposedFix?: string;
        file?: string;
        lineStart?: number;
        verified?: boolean;
        occurrences?: number;
        meanConfidence?: number;
        documentationGap?: string;
    }>;
    if (gaps.length > 0) {
        console.log(`\n  ${bold("Top documentation gaps (clustered):")}`);
        gaps.slice(0, 4).forEach((g, i) => {
            const loc = g.verified && g.file
                ? green(`✓ ${g.file}${g.lineStart ? `:${g.lineStart}` : ""}`)
                : yell("unverified");
            const meta = [
                g.documentationGap,
                g.occurrences ? `×${g.occurrences}` : null,
                g.meanConfidence !== undefined ? `conf ${g.meanConfidence}` : null,
            ].filter(Boolean).join(" ");
            console.log(`    ${gray(`${i + 1}.`)} [${loc}] ${dim(meta)}`);
            console.log(`       ${oneLine(g.fragment, 90)}`);
            if (g.proposedFix) console.log(`       ${dim("Fix: " + oneLine(g.proposedFix, 84))}`);
        });
    }

    if (docsPatch && (docsPatch.patchFile || docsPatch.markdownFile)) {
        console.log(`\n  ${bold("Documentation fix proposal:")}`);
        console.log(
            `    ${docsPatch.patchedClusters} patchable cluster(s), ${docsPatch.unpatchedClusters} suggestion(s) without verified location`,
        );
        if (docsPatch.patchFile) {
            console.log(
                `    ${green("✓")} unified diff:   ${cyan(docsPatch.patchFile)}  ${
                    dim("(git apply-able)")
                }`,
            );
        }
        if (docsPatch.markdownFile) {
            console.log(`    ${green("✓")} PR-style note:  ${cyan(docsPatch.markdownFile)}`);
        }
    }

    console.log(`\n${gray("─".repeat(W))}`);
}

// ─────────────────────────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
    // The only template var is the container's host port (used by http/db ctx).
    // Pure targets have no container, so {hostPort} is simply unused.
    const vars: Record<string, unknown> = {
        hostPort: cfg.container?.hostPort ?? "",
    };

    const t0 = Date.now();

    // ── Resume state ────────────────────────────────────────────────
    if (FRESH) clearCheckpoint();
    if (OVERRIDE_PROJECT_ID) saveCheckpoint({ projectId: OVERRIDE_PROJECT_ID });
    if (OVERRIDE_BASELINE_ID) saveCheckpoint({ baselineMasterPlanId: OVERRIDE_BASELINE_ID });
    const ckpt = loadCheckpoint();
    const ckptDone = ckpt
        ? [
            ckpt.projectId && "index",
            ckpt.baselineMasterPlanId && "baseline",
            ckpt.experimentMasterPlanId && "experiment",
        ].filter(Boolean).join(", ")
        : "";

    card(`Rookie · Documentation Drift — ${cfg.name}`, [
        ["Config", configName],
        [
            "Library",
            `${cfg.library.pkg} ${cfg.library.oldVersion} ${gray("→")} ${cfg.library.newVersion}`,
        ],
        ["Runtime", cfg.image ? `${cfg.runtime} · ${cfg.image}` : "pure (no container)"],
        ["Rookie", ROOKIE_URL],
        ...(VERBOSE ? [["Verbose", "on"] as [string, string]] : []),
        ...(ckpt
            ? [[
                "Resume",
                `${green("✓")} checkpoint ${dim(`(${ckptDone || "empty"} · --fresh to discard)`)}`,
            ] as [string, string]]
            : []),
    ]);

    // ── Phase 1: index docs ─────────────────────────────────────────
    // Docs are version-pinned raw markdown fetched from GitHub, independent of
    // the runtime container — no container is needed to index them.
    phase(1, 4, "Indexing documentation", "version-pinned raw markdown");
    let project: { id: string; files?: unknown[] };
    let indexResumed = false;
    if (ckpt?.projectId && await projectExists(ckpt.projectId)) {
        project = { id: ckpt.projectId };
        indexResumed = true;
        console.log(`${gray("│")}  ${green("✓")} resumed — reusing project ${bold(project.id)}`);
    } else {
        if (ckpt?.projectId) {
            console.log(
                `${gray("│")}  ${
                    yell("⚠")
                } checkpointed project ${ckpt.projectId} no longer exists — re-indexing`,
            );
        }
        project = await ingestDocs(cfg.docs, vars);
        saveCheckpoint({ projectId: project.id });
    }
    phaseEnd(indexResumed ? "resumed from checkpoint" : `project ${project.id}`);

    // Start/stop the runtime container (http/db) around a phase; pure targets
    // have no container, so these are no-ops.
    const startBacking = async (): Promise<void> => {
        if (!cfg.container || !cfg.image) return;
        await dockerStart(cfg.image, cfg.container);
        await waitHealthy(cfg.health!, vars);
    };
    const stopBacking = async (): Promise<void> => {
        if (cfg.container) await dockerStop(cfg.container.name);
    };
    // Library drift: pin `<pkg>@<version>` for the phase; force-install peer
    // packages at latest in both phases so only the library version varies.
    const libOverrides = (version: string): Record<string, string> => {
        const o: Record<string, string> = { [cfg.library.pkg]: version };
        for (const p of cfg.library.extraPackages ?? []) o[p] = "latest";
        // Family peers must move WITH the library (see LibraryConfig.versionedExtras).
        for (const p of cfg.library.versionedExtras ?? []) o[p] = version;
        return o;
    };

    // ── Phase 2: baseline — OLD docs × OLD library ──────────────────
    phase(2, 4, "Baseline", "old docs × old library");
    console.log(
        `${gray("│")}  ${
            dim(
                `library under test: ${cfg.library.pkg} ` +
                    `${cfg.library.oldVersion} → ${cfg.library.newVersion}`,
            )
        }`,
    );
    // Changelog-drift seed: steers goal generation toward documented breaking
    // changes (baseline run only); also the golden dataset for scoring detection.
    const seed = CHANGELOG_SEEDS[configName];
    // Documented API symbols goals should exercise — drives the docs-faithfulness
    // (dodge) check so an agent that routes around the documented API is flagged.
    const expectedApis = seed ? expectedApiSymbols(seed) : undefined;
    if (seed) {
        console.log(
            `${gray("│")}  ${
                dim(`changelog seed: ${seed.breakingChanges.length} breaking changes`)
            }`,
        );
        if (expectedApis && expectedApis.length > 0) {
            console.log(
                `${gray("│")}  ${dim(`expected documented APIs: ${expectedApis.join(", ")}`)}`,
            );
        }
    }

    let baselineRun: MasterPlanRun | null = null;
    if (ckpt?.baselineMasterPlanId) {
        baselineRun = await fetchMasterPlanRun(ckpt.baselineMasterPlanId);
        if (baselineRun) {
            console.log(
                `${gray("│")}  ${green("✓")} resumed — reusing baseline master plan ` +
                    `${bold(ckpt.baselineMasterPlanId)} (${baselineRun.goals.length} goals)`,
            );
        } else {
            console.log(
                `${gray("│")}  ${
                    yell("⚠")
                } checkpointed baseline ${ckpt.baselineMasterPlanId} not found — re-running`,
            );
        }
    }

    if (!baselineRun) {
        await startBacking();
        baselineRun = await runMasterPlanner(
            project.id,
            cfg.planner,
            vars,
            undefined,
            libOverrides(cfg.library.oldVersion),
            renderChangelogSeed(seed),
            { expectedApis },
        );
        await stopBacking();
        const bId = planId(baselineRun.masterPlan) ?? null;
        if (bId) saveCheckpoint({ baselineMasterPlanId: bId });
    }
    const { masterPlan: bPlan, goals: bGoals, breakdown: bBreakdown } = baselineRun;
    const passCount = (b: GoalResult[]) => b.filter((r) => r.status === "SUCCESS").length;
    phaseEnd(`${passCount(bBreakdown)}/${bBreakdown.length} goals passed`);

    // ── Phase 3: experiment — OLD docs + NEW API ────────────────────
    // By default the baseline's generated programs are re-executed VERBATIM
    // (freeze) against the new version — drift is measured on identical code and
    // the agent cannot regenerate around the change. `--no-freeze` restores the
    // old behaviour (regenerate code for the new version).
    const freeze = !NO_FREEZE;
    const baselineMasterPlanId = planId(bPlan) ?? null;
    phase(3, 4, "Experiment", freeze ? "frozen code × new library" : "old docs × new library");
    let experimentRun: MasterPlanRun | null = null;
    if (ckpt?.experimentMasterPlanId) {
        experimentRun = await fetchMasterPlanRun(ckpt.experimentMasterPlanId);
        if (experimentRun) {
            console.log(
                `${gray("│")}  ${green("✓")} resumed — reusing experiment master plan ` +
                    `${bold(ckpt.experimentMasterPlanId)}`,
            );
        } else {
            console.log(
                `${gray("│")}  ${
                    yell("⚠")
                } checkpointed experiment run ${ckpt.experimentMasterPlanId} not found — re-running`,
            );
        }
    }
    if (!experimentRun) {
        if (baselineMasterPlanId) {
            console.log(
                `${gray("│")}  ${dim(`reusing goals from master plan ${baselineMasterPlanId}`)}`,
            );
        } else {
            console.log(
                `${gray("│")}  ${
                    yell("⚠")
                } baseline master plan ID not found — generating fresh goals`,
            );
        }
        if (freeze && baselineMasterPlanId) {
            console.log(
                `${gray("│")}  ${
                    dim("freeze: re-executing baseline programs verbatim (no regeneration)")
                }`,
            );
        }
        await startBacking();
        experimentRun = await runMasterPlanner(
            project.id,
            cfg.planner,
            vars,
            baselineMasterPlanId ?? undefined,
            libOverrides(cfg.library.newVersion),
            undefined,
            { freeze: freeze && !!baselineMasterPlanId, expectedApis },
        );
        await stopBacking();
        const eId = planId(experimentRun.masterPlan) ?? null;
        if (eId) saveCheckpoint({ experimentMasterPlanId: eId });
    }
    const { masterPlan: ePlan, goals: eGoals, breakdown: eBreakdown } = experimentRun;
    phaseEnd(`${passCount(eBreakdown)}/${eBreakdown.length} goals passed`);

    // ── Phase 3b (optional): docs-ablation arm ──────────────────────
    // Re-run the baseline goals on the OLD library but WITHOUT documentation
    // (no RAG). Documentation value = baseline pass rate − no-docs pass rate.
    let ablation: { passRate: number; passed: number; total: number } | null = null;
    if (ABLATION && baselineMasterPlanId) {
        phase(3, 4, "Ablation", "no-docs (parametric knowledge only)");
        await startBacking();
        const ablationRun = await runMasterPlanner(
            project.id,
            cfg.planner,
            vars,
            baselineMasterPlanId,
            libOverrides(cfg.library.oldVersion),
            undefined,
            { withoutDocs: true, expectedApis },
        );
        await stopBacking();
        const passed = passCount(ablationRun.breakdown);
        const total = ablationRun.breakdown.length;
        ablation = { passed, total, passRate: total === 0 ? 0 : passed / total };
        phaseEnd(`no-docs: ${passed}/${total} goals passed`);
    }

    // ── Phase 4: diff + docs patch + save ───────────────────────────
    phase(4, 4, "Report & artifacts");
    const drift = analyzeDrift(bBreakdown, eBreakdown);

    const stamp = Date.now();
    const outBase = `${Deno.cwd()}/experiment-${configName}-${stamp}`;
    const outFile = `${outBase}.json`;

    // Pull the aggregated, verified documentation fix proposal for the
    // experiment run (old docs × new API — where the drift shows up).
    const docsPatch = await fetchDocsPatch(
        planId(ePlan) ?? null,
        outBase,
    );
    // Persist the complete report documents (master plans + every per-goal
    // report) so the run's evidence lives on disk, not only in Mongo.
    const fullReports = await downloadFullReports(
        baselineMasterPlanId,
        planId(ePlan) ?? null,
        outBase,
    );
    if (fullReports.file) {
        console.log(
            `${gray("│")}  ${green("✓")} full reports saved: ${bold(fullReports.file)} ` +
                `(${fullReports.goalReports} per-goal reports)`,
        );
    }

    // ── Step-level (paired) drift ────────────────────────────────────────
    // Each step is an independent generated program, and the frozen experiment
    // re-runs the SAME programs — so step i is directly comparable across
    // versions. This is finer-grained than goal status, which cannot move when a
    // goal is PARTIAL_FAILURE in both phases even though steps regressed.
    const stepDrift = analyzeStepDrift(
        toGoalSteps(fullReports.plans.baseline, fullReports.reports),
        toGoalSteps(fullReports.plans.experiment, fullReports.reports),
    );
    if (stepDrift.paired > 0) {
        const pct = (s: { passRate: number }) => `${(s.passRate * 100).toFixed(0)}%`;
        console.log(
            `${gray("│")}  ${
                stepDrift.regressions.length > 0 ? red("⚠") : green("✓")
            } steps: ${stepDrift.baseline.passed}/${stepDrift.baseline.total} (${
                pct(stepDrift.baseline)
            })` +
                ` → ${stepDrift.experiment.passed}/${stepDrift.experiment.total} (${
                    pct(stepDrift.experiment)
                })` +
                `  ${red(`-${stepDrift.regressions.length}`)} / ${
                    cyan(`+${stepDrift.improvements.length}`)
                }`,
        );
    }

    // Golden-dataset scoring: which documented breaking changes did the pipeline
    // surface? Evidence is restricted to DRIFT — regressed steps and gaps that are
    // new in the experiment. Scoring every experiment finding inflates recall,
    // because goals are seeded from the changelog and therefore mention those APIs
    // by construction (observed: 3/3 recall on a target with zero drift).
    let breakingChangeDetection: ReturnType<typeof scoreBreakingChanges> | null = null;
    if (seed) {
        const summaryGaps = (plan: Record<string, unknown> | null | undefined) =>
            ((plan?.structuredSummary as Record<string, unknown> | undefined)
                ?.documentationGapDetails ?? []) as Record<string, unknown>[];
        const signals = driftEvidenceSignals({
            stepRegressions: stepDrift.regressions,
            experimentGaps: summaryGaps(ePlan as Record<string, unknown> | null),
            baselineGaps: summaryGaps(bPlan as Record<string, unknown> | null),
        });
        breakingChangeDetection = scoreBreakingChanges(seed, signals);
        console.log(
            `${gray("│")}  ${
                breakingChangeDetection.detected > 0 ? green("✓") : yell("○")
            } breaking-change recall: ${breakingChangeDetection.detected}/${breakingChangeDetection.total}` +
                ` (${(breakingChangeDetection.recall * 100).toFixed(0)}%)` +
                dim(` — from ${signals.length} drift-tied signal(s)`),
        );
    }

    // Docs-faithfulness (dodge) summary from the BASELINE generation — the frozen
    // experiment reuses those programs, so faithfulness is a property of the
    // baseline. `docValue` (with-docs minus no-docs pass rate) needs --ablation.
    const faithfulness =
        ((bPlan as Record<string, unknown> | null)?.executionPlan as Record<string, unknown>)
            ?.faithfulness ?? null;
    const baselinePassRate = bBreakdown.length === 0
        ? 0
        : passCount(bBreakdown) / bBreakdown.length;

    const report = {
        meta: {
            project: cfg.name,
            configKey: configName,
            library: cfg.library.pkg,
            oldVersion: cfg.library.oldVersion,
            newVersion: cfg.library.newVersion,
            runtime: cfg.runtime,
            image: cfg.image ?? null,
            frozen: freeze,
            projectId: project.id,
            timestamp: new Date().toISOString(),
            rookieUrl: ROOKIE_URL,
            outputFile: outFile,
            fullReportsFile: fullReports.file,
        },
        faithfulness,
        ablation: ablation
            ? { ...ablation, baselinePassRate, docValue: baselinePassRate - ablation.passRate }
            : null,
        baseline: {
            masterPlanId: planId(bPlan) ?? null,
            goals: bGoals,
            breakdown: bBreakdown,
            structuredSummary: (bPlan as Record<string, unknown> | null)?.structuredSummary ?? null,
            markdownSummary: ((bPlan as Record<string, unknown> | null)?.detailedResults as
                | Record<string, unknown>
                | undefined)?.finalOutput ?? null,
        },
        experiment: {
            masterPlanId: planId(ePlan) ?? null,
            goals: eGoals,
            breakdown: eBreakdown,
            structuredSummary: (ePlan as Record<string, unknown> | null)?.structuredSummary ?? null,
            markdownSummary: ((ePlan as Record<string, unknown> | null)?.detailedResults as
                | Record<string, unknown>
                | undefined)?.finalOutput ?? null,
        },
        drift,
        stepDrift,
        docsPatch,
        changelog: seed
            ? {
                changelogUrl: seed.changelogUrl,
                oldVersion: seed.oldVersion,
                newVersion: seed.newVersion,
                goldenBreakingChanges: seed.breakingChanges,
                detection: breakingChangeDetection,
            }
            : null,
    };

    Deno.writeTextFileSync(outFile, JSON.stringify(report, null, 2));
    clearCheckpoint();
    phaseEnd(`report ${outFile}`);
    printFinalSummary(report as unknown as Record<string, unknown>, Date.now() - t0);

    // Methodology signals (freeze / faithfulness / ablation).
    if (freeze) {
        console.log(
            `  ${dim("Experiment ran on FROZEN baseline code (same programs, new version).")}`,
        );
    }
    const f = faithfulness as
        | { checkedSteps: number; faithfulSteps: number; dodgedGoals: string[] }
        | null;
    if (f) {
        const dodged = f.dodgedGoals.length;
        console.log(
            `  ${dodged > 0 ? yell("⚠") : green("✓")} Docs-faithfulness: ` +
                `${f.faithfulSteps}/${f.checkedSteps} steps used a documented API` +
                (dodged > 0 ? `, ${bold(red(`${dodged} goal(s) dodged`))}` : ""),
        );
    }
    if (report.ablation) {
        const a = report.ablation;
        console.log(
            `  ${bold("Documentation value")} (docs vs no-docs): ` +
                `${(a.baselinePassRate * 100).toFixed(0)}% → ${(a.passRate * 100).toFixed(0)}% ` +
                `= ${bold(`${(a.docValue * 100).toFixed(0)} pts`)}`,
        );
    }
    console.log(
        `  ${dim("Detailed view:")} ${
            cyan(`deno run --allow-all scripts/print-report.ts ${outFile}`)
        }\n`,
    );
}

// Never leave the target container running: an interrupted or crashed run used
// to leak it (holding its published port), so a later run could silently talk to
// a stale server.
function cleanupTargetContainer(): void {
    if (!cfg?.container) return;
    try {
        new Deno.Command("docker", {
            args: ["rm", "-f", cfg.container.name],
            stdout: "null",
            stderr: "null",
        }).outputSync();
    } catch { /* docker gone or already removed */ }
}

Deno.addSignalListener("SIGINT", () => {
    console.log(`\n${yell("⚠")} interrupted — removing target container…`);
    cleanupTargetContainer();
    Deno.exit(130);
});

main().catch((err) => {
    console.error(`\n${red("[fatal]")} ${err.message}`);
    if (VERBOSE) console.error(err.stack);
    cleanupTargetContainer();
    try {
        Deno.statSync(CHECKPOINT_FILE);
        console.error(
            `${yell("⚠")} checkpoint kept: ${CHECKPOINT_FILE} — ` +
                `rerun the same command to resume from the last completed phase.`,
        );
    } catch { /* no checkpoint — nothing was completed */ }
    Deno.exit(1);
});
