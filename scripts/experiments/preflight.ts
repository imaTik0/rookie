#!/usr/bin/env -S deno run --allow-all
/**
 * preflight.ts — technical validation of experiment targets BEFORE any run.
 *
 * Per target: (1) both image tags resolvable, (2) OLD container starts and
 * becomes healthy, (3) docs source reachable (and parseable for swagger-json),
 * (4) credential setup hook succeeds. Teardown afterwards.
 *
 * A target failing preflight is replaced via the pre-registered replacement
 * rule (SELECTION.md §6) and the failure is logged in SELECTION.md §8 —
 * never silently swapped.
 *
 * Usage:
 *   deno run --allow-all scripts/experiments/preflight.ts --config memos
 *   deno run --allow-all scripts/experiments/preflight.ts --all
 *   deno run --allow-all scripts/experiments/preflight.ts --all --skip-pilots
 */
import { type ExperimentConfig, EXPERIMENTS } from "./targets.ts";

const argIdx = (k: string) => Deno.args.indexOf(k);
const arg = (k: string) => (argIdx(k) !== -1 ? Deno.args[argIdx(k) + 1] ?? null : null);
const flag = (k: string) => Deno.args.includes(k);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function fill(s: string, vars: Record<string, unknown>): string {
    return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : `{${k}}`));
}

async function docker(args: string[], quiet = true): Promise<{ code: number; out: string }> {
    const { code, stdout, stderr } = await new Deno.Command("docker", {
        args,
        stdout: "piped",
        stderr: quiet ? "piped" : "inherit",
    }).output();
    const dec = new TextDecoder();
    return { code, out: dec.decode(stdout) + dec.decode(stderr) };
}

interface StepResult {
    step: string;
    ok: boolean;
    detail: string;
}

async function preflightTarget(key: string, cfg: ExperimentConfig): Promise<StepResult[]> {
    const steps: StepResult[] = [];
    const push = (step: string, ok: boolean, detail = "") => {
        steps.push({ step, ok, detail });
        console.log(`   ${ok ? "✓" : "✗"} ${step}${detail ? ` — ${detail}` : ""}`);
    };

    const imageVersion = cfg.oldImage.split(":")[1] ?? "";
    const vars = {
        hostPort: cfg.container.hostPort,
        docsVersion: imageVersion.split(".").slice(0, 2).join("."),
        oldTag: imageVersion,
        docsMajor: imageVersion.replace(/^v/, "").split(/[.-]/)[0],
    };

    // 1) image tags resolvable
    for (const image of [cfg.oldImage, cfg.newImage]) {
        const m = await docker(["manifest", "inspect", image]);
        push(`image tag ${image}`, m.code === 0, m.code === 0 ? "" : m.out.trim().slice(0, 80));
    }
    if (steps.some((s) => !s.ok)) return steps;

    // 2) start OLD container + health
    await docker(["rm", "-f", cfg.container.name]);
    const envArgs = Object.entries(cfg.container.env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
    const run = await docker([
        "run",
        "-d",
        "--name",
        cfg.container.name,
        "-p",
        `${cfg.container.hostPort}:${cfg.container.port}`,
        ...envArgs,
        cfg.oldImage,
        ...(cfg.container.cmd ?? []),
    ]);
    push("container start", run.code === 0, run.code === 0 ? "" : run.out.trim().slice(0, 120));
    if (run.code !== 0) return steps;

    try {
        const healthUrl = fill(cfg.health.url, vars);
        let healthy = false;
        for (let i = 0; i < cfg.health.retries && !healthy; i++) {
            try {
                const r = await fetch(healthUrl, { signal: AbortSignal.timeout(3000) });
                await r.body?.cancel();
                healthy = r.ok;
            } catch { /* not ready */ }
            if (!healthy) await sleep(cfg.health.intervalMs);
        }
        push(
            `health ${healthUrl}`,
            healthy,
            healthy ? "" : `not healthy after ${cfg.health.retries} tries`,
        );
        if (!healthy) return steps;

        // 3) docs source
        const docsUrl = fill(cfg.docs.url, vars);
        try {
            const r = await fetch(docsUrl, {
                signal: AbortSignal.timeout(20_000),
                headers: { "User-Agent": "rookie-preflight/1.0" },
            });
            const body = await r.text();
            if (cfg.docs.mode === "swagger-json") {
                let parsed = false;
                let paths = 0;
                try {
                    const spec = JSON.parse(body);
                    parsed = typeof spec === "object" && spec !== null;
                    paths = spec?.paths ? Object.keys(spec.paths).length : 0;
                } catch { /* not JSON */ }
                push(
                    `docs (swagger-json) ${docsUrl}`,
                    r.ok && parsed && paths > 0,
                    `HTTP ${r.status}, ${paths} paths`,
                );
            } else {
                const bytes = body.length;
                push(
                    `docs (url-crawl) ${docsUrl}`,
                    r.ok && bytes > 2000,
                    `HTTP ${r.status}, ${bytes} bytes`,
                );
            }
        } catch (e) {
            push(`docs ${docsUrl}`, false, (e as Error).message.slice(0, 100));
        }

        // 4) setup hook
        if (cfg.setup) {
            try {
                const varsOut = await cfg.setup(cfg.container.name);
                push("setup hook", true, Object.keys(varsOut).join(", ") || "no vars");
            } catch (e) {
                push("setup hook", false, (e as Error).message.slice(0, 140));
            }
        } else {
            push("setup hook", true, "not required");
        }
    } finally {
        await docker(["rm", "-f", cfg.container.name]);
    }

    return steps;
}

// ── main ─────────────────────────────────────────────────────────
const single = arg("--config");
const all = flag("--all");
const skipPilots = flag("--skip-pilots");

const selected: [string, ExperimentConfig][] = single
    ? [[single, EXPERIMENTS[single]]]
    : all
    ? Object.entries(EXPERIMENTS).filter(([, c]) => !(skipPilots && c.pilot))
    : [];

if (selected.length === 0 || selected.some(([, c]) => !c)) {
    console.error(
        `Usage: preflight.ts --config <name> | --all [--skip-pilots]\n` +
            `Available: ${Object.keys(EXPERIMENTS).join(", ")}`,
    );
    Deno.exit(1);
}

const summary: Record<string, { ok: boolean; failed: string[] }> = {};
for (const [key, cfg] of selected) {
    console.log(`\n■ ${key} (${cfg.name})  ${cfg.oldImage} -> ${cfg.newImage}`);
    const steps = await preflightTarget(key, cfg);
    const failed = steps.filter((s) => !s.ok).map((s) => s.step);
    summary[key] = { ok: failed.length === 0, failed };
}

console.log("\n═══ PREFLIGHT SUMMARY ═══");
let anyFail = false;
for (const [key, s] of Object.entries(summary)) {
    console.log(
        `  ${s.ok ? "PASS" : "FAIL"}  ${key}${s.ok ? "" : "  (" + s.failed.join("; ") + ")"}`,
    );
    if (!s.ok) anyFail = true;
}
if (anyFail) {
    console.log(
        "\nFailures are technical preflight failures: apply the replacement rule " +
            "(SELECTION.md §6) and log the substitution in §8.",
    );
}
Deno.exit(anyFail ? 1 : 0);
