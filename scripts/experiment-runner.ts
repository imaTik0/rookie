#!/usr/bin/env -S deno run --allow-all
/**
 * experiment-runner.ts
 *
 * Documentation-drift experiment for Dockerized projects.
 *
 *  Phase 1 — Index:      Start OLD container → crawl swagger URL → Rookie project
 *  Phase 2 — Baseline:   OLD docs + OLD API  → Master Planner (generates & runs goals)
 *  Phase 3 — Experiment: OLD docs + NEW API  → Master Planner (same project, new container)
 *  Phase 4 — Report:     diff structured summaries, save JSON
 *
 * Usage:
 *   deno run --allow-all scripts/experiment-runner.ts
 *   deno run --allow-all scripts/experiment-runner.ts --config gitea
 *   deno run --allow-all scripts/experiment-runner.ts --config gitea --verbose
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

const configName = arg("--config") ?? "gitea";
const VERBOSE = flag("--verbose") || flag("-v");

if (flag("--list")) {
    console.log("Available experiment targets:\n");
    for (const [key, t] of Object.entries(EXPERIMENTS)) {
        const mark = t.pilot
            ? " [pilot]"
            : t.selectionRank
            ? ` [sample, rank ${t.selectionRank}]`
            : "";
        console.log(`  ${key.padEnd(14)} ${t.oldImage} -> ${t.newImage}${mark}`);
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

function banner(title: string, width = 66): void {
    const line = "═".repeat(width);
    const pad = Math.max(0, Math.floor((width - title.length - 2) / 2));
    console.log(`\n${bold(line)}`);
    console.log(
        bold(
            `${"═".repeat(pad)} ${title} ${
                "═".repeat(Math.max(0, width - pad - title.length - 2))
            }`,
        ),
    );
    console.log(bold(line));
}

function section(title: string): void {
    console.log(`\n${bold(cyan("┌─ " + title))}`);
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

async function waitHealthy(healthCfg: HealthConfig, vars: Record<string, unknown>): Promise<void> {
    const url = fill(healthCfg.url, vars) as string;
    for (let i = 1; i <= healthCfg.retries; i++) {
        try {
            const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
            if (r.ok) {
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

interface JobView {
    id: string;
    status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
    result?: Record<string, unknown>;
    error?: string;
    progress?: string;
}

/** Poll an async job to a terminal status, returning its result payload. */
async function pollJob(jobId: string, label: string): Promise<Record<string, unknown>> {
    let lastProgress = "";
    while (true) {
        const job = await rookieCall<JobView>("GET", `/jobs/${jobId}`);
        if (job.progress && job.progress !== lastProgress) {
            lastProgress = job.progress;
            console.log(`${gray("│")}       ${dim(job.progress)}`);
        }
        if (job.status === "SUCCEEDED") return job.result ?? {};
        if (job.status === "FAILED" || job.status === "CANCELLED") {
            throw new Error(
                `${label} job ${job.status.toLowerCase()}: ${job.error ?? "(no detail)"}`,
            );
        }
        await sleep(1500);
    }
}

// ─────────────────────────────────────────────────────────────────
//  SWAGGER JSON → MARKDOWN
//  Converts an OpenAPI 2.x / 3.x spec into a flat Markdown document
//  that the RAG chunker can index (HTML crawler skips JSON responses).
//
//  Key difference from a naive converter: Gitea ships Swagger 2.0 where
//  every body parameter is  { "in": "body", "schema": { "$ref": "#/definitions/Foo" } }
//  A converter that ignores $ref leaves the RAG with zero body field info,
//  causing the agent to loop endlessly searching for schema details.
// ─────────────────────────────────────────────────────────────────

/** Walk a JSON Pointer path like "#/definitions/Foo" inside `spec`. */
function resolveRef(spec: Record<string, unknown>, ref: string): Record<string, unknown> | null {
    const parts = ref.replace(/^#\//, "").split("/");
    let node: unknown = spec;
    for (const part of parts) {
        if (!node || typeof node !== "object") return null;
        node = (node as Record<string, unknown>)[part];
    }
    return (node as Record<string, unknown>) ?? null;
}

/** Recursively expand a schema node, resolving any $ref up to `depth` levels. */
function expandSchema(
    spec: Record<string, unknown>,
    schema: Record<string, unknown>,
    depth = 2,
): Record<string, unknown> {
    if (schema.$ref && typeof schema.$ref === "string") {
        const resolved = resolveRef(spec, schema.$ref);
        if (!resolved || depth <= 0) return resolved ?? schema;
        return expandSchema(spec, resolved, depth - 1);
    }
    return schema;
}

/** Emit flat `- \`field\` \`type\` — description` lines for a schema's properties. */
function renderSchemaProps(
    spec: Record<string, unknown>,
    schema: Record<string, unknown>,
    lines: string[],
    indent = "  ",
): void {
    const expanded = expandSchema(spec, schema);
    const required = new Set<string>((expanded.required ?? []) as string[]);
    const properties = expanded.properties as Record<string, Record<string, unknown>> | undefined;
    if (!properties) return;

    for (const [field, fieldSchema] of Object.entries(properties)) {
        const fs = expandSchema(spec, fieldSchema, 1);
        const type = (fs.type ?? fs.format ??
            (fs.$ref ? (fs.$ref as string).split("/").pop() : "object")) as string;
        const req = required.has(field) ? " *(required)*" : "";
        const desc = fs.description ? ` — ${fs.description}` : "";
        lines.push(`${indent}- \`${field}\` \`${type}\`${req}${desc}`);
    }
}

function swaggerToMarkdown(spec: Record<string, unknown>): string {
    const info = (spec.info ?? {}) as Record<string, unknown>;
    const paths = (spec.paths ?? {}) as Record<string, Record<string, unknown>>;
    const isV2 = typeof spec.swagger === "string" && spec.swagger.startsWith("2");
    const servers = isV2
        ? [{ url: (spec.basePath as string | undefined) ?? "/" }]
        : (spec.servers ?? []) as Array<{ url: string }>;

    // Group operations by first tag
    const byTag = new Map<
        string,
        Array<{ method: string; path: string; op: Record<string, unknown> }>
    >();
    for (const [path, methods] of Object.entries(paths)) {
        for (const [method, op] of Object.entries(methods)) {
            if (!op || typeof op !== "object") continue;
            const operation = op as Record<string, unknown>;
            if (!operation.operationId) continue;
            const tag = (operation.tags as string[] | undefined)?.[0] ?? "General";
            if (!byTag.has(tag)) byTag.set(tag, []);
            byTag.get(tag)!.push({ method: method.toUpperCase(), path, op: operation });
        }
    }

    const lines: string[] = [
        `# ${info.title ?? "API Documentation"}`,
        `**Version:** ${info.version ?? "unknown"}`,
        "",
    ];
    if (info.description) lines.push(String(info.description), "");
    if (servers.length) lines.push(`**Base URL:** \`${servers[0].url}\``, "");

    for (const [tag, ops] of [...byTag.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        lines.push(`## ${tag}`, "");
        for (const { method, path, op } of ops) {
            lines.push(`### \`${method} ${path}\``);
            if (op.summary) lines.push(`**Summary:** ${op.summary}`);
            if (op.description) lines.push(String(op.description));

            const params = (op.parameters ?? []) as Array<Record<string, unknown>>;

            // ── Non-body parameters (path, query, header) ──────────────
            const nonBody = params.filter((p) => p.in !== "body");
            if (nonBody.length) {
                lines.push("", "**Parameters:**");
                for (const p of nonBody) {
                    const req = p.required ? "*(required)*" : "*(optional)*";
                    const type = (p.schema as Record<string, unknown> | undefined)?.type ??
                        p.type ?? "?";
                    lines.push(
                        `- \`${p.name}\` (${p.in}) ${req} \`${type}\` — ${p.description ?? ""}`,
                    );
                }
            }

            // ── Swagger 2.0 body parameter (uses $ref into definitions) ─
            const bodyParam = params.find((p) => p.in === "body") as
                | Record<string, unknown>
                | undefined;
            if (bodyParam?.schema) {
                const schemaNode = bodyParam.schema as Record<string, unknown>;
                const refName = typeof schemaNode.$ref === "string"
                    ? schemaNode.$ref.split("/").pop()
                    : undefined;
                lines.push("", `**Request body** (${refName ?? "object"}):`);
                renderSchemaProps(spec, schemaNode, lines);
            }

            // ── OpenAPI 3.x requestBody ─────────────────────────────────
            const reqBody = op.requestBody as Record<string, unknown> | undefined;
            if (reqBody?.content) {
                lines.push("", "**Request body:**");
                for (
                    const [ct, media] of Object.entries(
                        reqBody.content as Record<string, Record<string, unknown>>,
                    )
                ) {
                    lines.push(`- Content-Type: \`${ct}\``);
                    if (media.schema) {
                        renderSchemaProps(
                            spec,
                            media.schema as Record<string, unknown>,
                            lines,
                            "    ",
                        );
                    }
                }
            }

            lines.push("", "**Responses:**");
            for (
                const [code, resp] of Object.entries(
                    (op.responses ?? {}) as Record<string, Record<string, unknown>>,
                )
            ) {
                lines.push(`- **${code}** — ${resp.description ?? ""}`);
            }
            lines.push("");
        }
    }
    return lines.join("\n");
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
    image: string,
    vars: Record<string, unknown>,
): Promise<{ id: string; files?: unknown[] }> {
    const url = fill(docsCfg.url, vars) as string;
    const version = image.split(":")[1] ?? image;

    if (docsCfg.mode === "swagger-json") {
        console.log(`${gray("│")}  ${yell("▸")} fetching swagger JSON: ${bold(url)}`);
        const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(`Cannot fetch swagger JSON: HTTP ${res.status}`);

        const spec = await res.json() as Record<string, unknown>;
        const markdown = swaggerToMarkdown(spec);
        const chars = markdown.length;
        console.log(
            `${gray("│")}  ${yell("▸")} converted to Markdown (${chars} chars, ~${
                Math.round(chars / 4)
            } tokens)`,
        );

        const file = await uploadFileToRookie(`${configName}-api-${version}.md`, markdown);
        console.log(`${gray("│")}  ${yell("▸")} uploaded: ${gray(file.id)}`);

        const project = await rookieCall<{ id: string; files?: unknown[] }>("POST", "/projects", {
            projectName: `${cfg.name} API – ${version}`,
            fileIds: [file.id],
        });
        console.log(`${gray("│")}  ${green("✓")} project created: ${bold(project.id)}`);
        return project;
    } else {
        // url-crawl: delegate to Rookie's built-in HTML crawler, now an async job.
        console.log(`${gray("│")}  ${yell("▸")} crawling (async job): ${bold(url)}`);
        const job = await rookieCall<JobView>("POST", "/projects/from-url", {
            projectName: `${cfg.name} API – ${version}`,
            url,
            maxPages: docsCfg.maxPages,
        });
        const result = await pollJob(job.id, "Crawl");
        const projectId = String(result.projectId);
        const project = await rookieCall<{ id: string; files?: unknown[] }>(
            "GET",
            `/projects/${projectId}`,
        );
        console.log(
            `${gray("│")}  ${green("✓")} project created: ${bold(project.id)} (${
                project.files?.length ?? "?"
            } pages)`,
        );
        return project;
    }
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
): Promise<MasterPlanRun> {
    const context = fill(plannerCfg.initialContext, vars) as string;

    let masterPlan: Record<string, unknown> | null = null;
    let goals: string[] = [];
    const breakdown: GoalResult[] = [];

    const agent = createAgentRenderer();

    const streamBody = rerunFromMasterPlanId
        ? { masterPlanId: rerunFromMasterPlanId, projectId, initialContext: context }
        : { projectId, maxGoals: plannerCfg.maxGoals, initialContext: context };
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
                masterPlan = event.result as Record<string, unknown>;
                console.log(`${gray("│")}`);
                console.log(
                    `${gray("│")}  ${green("✓")} master plan complete  ${
                        (event.result as Record<string, unknown>)?._id
                            ? gray(String((event.result as Record<string, unknown>)._id))
                            : ""
                    }`,
                );
                break;

            case "ERROR":
                console.log(`${gray("│")}  ${red("✗ ERROR:")} ${event.message}`);
                throw new Error(`Master planner failed: ${event.message}`);
        }
    }

    return { masterPlan, goals, breakdown };
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
function printFinalSummary(report: Record<string, unknown>): void {
    const { meta, baseline, experiment, drift, docsPatch } = report as {
        meta: {
            project: string;
            oldImage: string;
            newImage: string;
            projectId: string;
            outputFile: string;
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

    const W = 66;
    const passOf = (b: GoalResult[]) => b.filter((r) => r.status === "SUCCESS").length;
    const partialOf = (b: GoalResult[]) => b.filter((r) => r.status === "PARTIAL_FAILURE").length;
    const passB = passOf(baseline.breakdown);
    const passE = passOf(experiment.breakdown);
    const partB = partialOf(baseline.breakdown);
    const partE = partialOf(experiment.breakdown);
    const n = Math.max(baseline.breakdown.length, experiment.breakdown.length);

    banner(`EXPERIMENT RESULTS — ${meta.project}`, W);
    console.log(`  ${bold("Old image:")} ${meta.oldImage}`);
    console.log(`  ${bold("New image:")} ${meta.newImage}`);
    console.log(`  ${bold("Project: ")} ${meta.projectId}`);
    console.log(`  ${bold("Saved:   ")} ${meta.outputFile}`);
    console.log(`\n${bold("─".repeat(W))}`);
    console.log(
        `  Baseline   (old docs + old API):  ${bold(green(`${passB}/${n}`))} passed${
            partB ? yell(`  (+${partB} partial)`) : ""
        }`,
    );
    console.log(
        `  Experiment (old docs + new API):  ${
            bold(passE >= passB ? green(`${passE}/${n}`) : red(`${passE}/${n}`))
        } passed${partE ? yell(`  (+${partE} partial)`) : ""}`,
    );
    console.log(bold("─".repeat(W)));

    if (drift.regressions.length === 0) {
        console.log(`\n  ${green("✓")}  No regressions — documentation stable across versions.`);
    } else {
        console.log(
            `\n  ${red("⚠")}  ${
                bold(red(`${drift.regressions.length} regression(s)`))
            } — documentation drift detected:`,
        );
        for (const r of drift.regressions) {
            console.log(`\n    ${red("•")} ${bold(r.goal)}`);
            console.log(`      baseline → ${green("SUCCESS")}   experiment → ${red(r.experiment)}`);
        }
    }

    if (drift.improvements.length > 0) {
        console.log(
            `\n  ${cyan("↑")}  ${drift.improvements.length} improvement(s) in new version:`,
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

    console.log(`\n${bold("═".repeat(W))}\n`);
}

// ─────────────────────────────────────────────────────────────────
//  GITEA SETUP HELPER  (creates admin user + API token via docker exec)
// ─────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
    // docsVersion = "major.minor" extracted from the old image tag
    const imageVersion = cfg.oldImage.split(":")[1] ?? "";
    const docsVersion = imageVersion.split(".").slice(0, 2).join(".");
    // {oldTag} = full old image tag (e.g. "2.9.3", "v2.11");
    // {docsMajor} = leading version segment (e.g. "29" for nextcloud:29-apache).
    const oldTag = imageVersion;
    const docsMajor = imageVersion.replace(/^v/, "").split(/[.-]/)[0];
    const vars: Record<string, unknown> = {
        hostPort: cfg.container.hostPort,
        docsVersion,
        oldTag,
        docsMajor,
    };

    banner(`Experiment: ${cfg.name}  (${configName})`);
    console.log(`  ${bold("Old:")}    ${cfg.oldImage}`);
    console.log(`  ${bold("New:")}    ${cfg.newImage}`);
    console.log(`  ${bold("Rookie:")} ${ROOKIE_URL}`);
    console.log(`  ${bold("Verbose:")} ${VERBOSE}`);

    // ── Phase 1: index docs ─────────────────────────────────────────
    // If the docs URL is external (not localhost) we skip starting the container —
    // the external docs site is independent of which Docker image we test against.
    const resolvedDocsUrl = fill(cfg.docs.url, vars) as string;
    const externalDocs = !resolvedDocsUrl.includes("localhost") &&
        !resolvedDocsUrl.includes("127.0.0.1");

    section(`Phase 1/3 — Indexing documentation  (${externalDocs ? "external" : "container"})`);
    if (!externalDocs) {
        await dockerStart(cfg.oldImage, cfg.container);
        await waitHealthy(cfg.health, vars);
    }
    const project = await ingestDocs(cfg.docs, cfg.oldImage, vars);
    if (!externalDocs) await dockerStop(cfg.container.name);

    // ── Phase 2: baseline — OLD docs + OLD API ──────────────────────
    section("Phase 2/3 — Baseline: OLD docs × OLD API");
    await dockerStart(cfg.oldImage, cfg.container);
    await waitHealthy(cfg.health, vars);
    if (cfg.setup) Object.assign(vars, await cfg.setup(cfg.container.name));
    const { masterPlan: bPlan, goals: bGoals, breakdown: bBreakdown } = await runMasterPlanner(
        project.id,
        cfg.planner,
        vars,
    );
    await dockerStop(cfg.container.name);

    // ── Phase 3: experiment — OLD docs + NEW API ────────────────────
    // Reuses the goals generated in Phase 2 via /planner/rerun so the two runs
    // are directly comparable (same goals, same project, different API version).
    const baselineMasterPlanId = (bPlan?._id as string | undefined) ?? null;
    section("Phase 3/3 — Experiment: OLD docs × NEW API");
    if (baselineMasterPlanId) {
        console.log(
            `${gray("│")}  ${dim(`reusing goals from master plan ${baselineMasterPlanId}`)}`,
        );
    } else {
        console.log(
            `${gray("│")}  ${yell("⚠")} baseline master plan ID not found — generating fresh goals`,
        );
    }
    await dockerStart(cfg.newImage, cfg.container);
    await waitHealthy(cfg.health, vars);
    if (cfg.setup) Object.assign(vars, await cfg.setup(cfg.container.name));
    const { masterPlan: ePlan, goals: eGoals, breakdown: eBreakdown } = await runMasterPlanner(
        project.id,
        cfg.planner,
        vars,
        baselineMasterPlanId ?? undefined,
    );
    await dockerStop(cfg.container.name);

    // ── Phase 4: diff + docs patch + save ───────────────────────────
    const drift = analyzeDrift(bBreakdown, eBreakdown);

    const stamp = Date.now();
    const outBase = `${Deno.cwd()}/experiment-${configName}-${stamp}`;
    const outFile = `${outBase}.json`;

    // Pull the aggregated, verified documentation fix proposal for the
    // experiment run (old docs × new API — where the drift shows up).
    const docsPatch = await fetchDocsPatch(
        (ePlan?._id as string | undefined) ?? null,
        outBase,
    );
    const report = {
        meta: {
            project: cfg.name,
            configKey: configName,
            oldImage: cfg.oldImage,
            newImage: cfg.newImage,
            projectId: project.id,
            timestamp: new Date().toISOString(),
            rookieUrl: ROOKIE_URL,
            outputFile: outFile,
        },
        baseline: {
            masterPlanId: bPlan?._id ?? null,
            goals: bGoals,
            breakdown: bBreakdown,
            structuredSummary: (bPlan as Record<string, unknown> | null)?.structuredSummary ?? null,
            markdownSummary: ((bPlan as Record<string, unknown> | null)?.detailedResults as
                | Record<string, unknown>
                | undefined)?.finalOutput ?? null,
        },
        experiment: {
            masterPlanId: ePlan?._id ?? null,
            goals: eGoals,
            breakdown: eBreakdown,
            structuredSummary: (ePlan as Record<string, unknown> | null)?.structuredSummary ?? null,
            markdownSummary: ((ePlan as Record<string, unknown> | null)?.detailedResults as
                | Record<string, unknown>
                | undefined)?.finalOutput ?? null,
        },
        drift,
        docsPatch,
    };

    Deno.writeTextFileSync(outFile, JSON.stringify(report, null, 2));
    printFinalSummary(report as unknown as Record<string, unknown>);
    console.log(
        `  Run ${
            bold(cyan(`deno run --allow-all scripts/print-report.ts ${outFile}`))
        } for a detailed view.\n`,
    );
}

main().catch((err) => {
    console.error(`\n${red("[fatal]")} ${err.message}`);
    if (VERBOSE) console.error(err.stack);
    Deno.exit(1);
});
