#!/usr/bin/env -S deno run --allow-all
/**
 * preflight.ts — technical validation of experiment targets BEFORE any run.
 *
 * Per target: (1) the npm version pair is resolvable, (2) for http/db targets
 * the container image resolves, starts and becomes healthy, (3) every OLD-tag
 * docs file is reachable. Pure targets skip all container checks. Teardown
 * afterwards.
 *
 * A target failing preflight is replaced via the pre-registered replacement
 * rule (SELECTION.md §6) and the failure is logged in SELECTION.md §11 —
 * never silently swapped.
 *
 * Usage:
 *   deno run --allow-all scripts/experiments/preflight.ts --config execa
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

async function fetchDoc(url: string): Promise<{ ok: boolean; bytes: number; status: number }> {
    const r = await fetch(url, {
        signal: AbortSignal.timeout(20_000),
        headers: { "User-Agent": "rookie-preflight/1.0" },
    });
    const body = await r.text();
    return { ok: r.ok, bytes: body.length, status: r.status };
}

async function preflightTarget(_key: string, cfg: ExperimentConfig): Promise<StepResult[]> {
    const steps: StepResult[] = [];
    const push = (step: string, ok: boolean, detail = "") => {
        steps.push({ step, ok, detail });
        console.log(`   ${ok ? "✓" : "✗"} ${step}${detail ? ` — ${detail}` : ""}`);
    };

    const vars = { hostPort: cfg.container?.hostPort ?? "" };

    // 0) library version pair resolvable on npm (drift axis)
    for (const v of [cfg.library.oldVersion, cfg.library.newVersion]) {
        const spec = `${cfg.library.pkg}@${v}`;
        let ok = false;
        try {
            const u = `https://registry.npmjs.org/${cfg.library.pkg.replace("/", "%2f")}/${v}`;
            const r = await fetch(u, { signal: AbortSignal.timeout(15_000) });
            await r.body?.cancel();
            ok = r.ok;
        } catch { /* network */ }
        push(`npm ${spec}`, ok, ok ? "" : "not resolvable");
    }
    if (steps.some((s) => !s.ok)) return steps;

    // 1) docs source — every OLD-tag file must resolve (raw markdown).
    const docUrls = [cfg.docs.url, ...(cfg.docs.extraFiles ?? [])].map((u) => fill(u, vars));
    for (const [i, url] of docUrls.entries()) {
        try {
            const { ok, bytes, status } = await fetchDoc(url);
            const min = i === 0 ? 200 : 100; // primary must be substantial
            push(
                `${i === 0 ? "docs" : "  extra doc"} ${url.split("/").pop()}`,
                ok && bytes > min,
                `HTTP ${status}, ${bytes} bytes`,
            );
        } catch (e) {
            push(`docs ${url}`, false, (e as Error).message.slice(0, 100));
        }
    }
    if (steps.some((s) => !s.ok)) return steps;

    // 2) pure targets need no container — done.
    if (cfg.runtime === "pure" || !cfg.container || !cfg.image) {
        push("container", true, "not required (pure)");
        return steps;
    }

    // 3) container image resolvable
    const m = await docker(["manifest", "inspect", cfg.image]);
    push(`image tag ${cfg.image}`, m.code === 0, m.code === 0 ? "" : m.out.trim().slice(0, 80));
    if (m.code !== 0) return steps;

    // 4) start container + health
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
        cfg.image,
        ...(cfg.container.cmd ?? []),
    ]);
    push("container start", run.code === 0, run.code === 0 ? "" : run.out.trim().slice(0, 120));
    if (run.code !== 0) return steps;

    try {
        const health = cfg.health!;
        const healthTarget = fill(health.url, vars);
        let healthy = false;
        for (let i = 0; i < health.retries && !healthy; i++) {
            try {
                if (health.mode === "tcp") {
                    const [host, portStr] = healthTarget.split(":");
                    const conn = await Deno.connect({
                        hostname: host || "localhost",
                        port: Number(portStr),
                    });
                    conn.close();
                    healthy = true;
                } else {
                    const r = await fetch(healthTarget, { signal: AbortSignal.timeout(3000) });
                    await r.body?.cancel();
                    healthy = r.ok;
                }
            } catch { /* not ready */ }
            if (!healthy) await sleep(health.intervalMs);
        }
        push(
            `health (${health.mode}) ${healthTarget}`,
            healthy,
            healthy ? "" : `not healthy after ${health.retries} tries`,
        );
    } finally {
        await docker(["rm", "-f", cfg.container.name]);
    }

    return steps;
}

// ── main ─────────────────────────────────────────────────────────
const single = arg("--config");
const all = flag("--all");
const skipPilots = flag("--skip-pilots");
const includeExcluded = flag("--include-excluded");

// `--all` skips targets already excluded after a preflight failure
// (SELECTION.md §11); use --include-excluded (or --config <name>) to retry one.
const selected: [string, ExperimentConfig][] = single
    ? [[single, EXPERIMENTS[single]]]
    : all
    ? Object.entries(EXPERIMENTS).filter(([, c]) =>
        !(skipPilots && c.pilot) && (includeExcluded || !c.excluded)
    )
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
    const backing = cfg.runtime === "pure" ? "pure" : `${cfg.runtime} · ${cfg.image}`;
    console.log(
        `\n■ ${key} (${cfg.name})  ${cfg.library.pkg} ` +
            `${cfg.library.oldVersion} -> ${cfg.library.newVersion}  [${backing}]`,
    );
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
            "(SELECTION.md §6) and log the substitution in §11.",
    );
}
Deno.exit(anyFail ? 1 : 0);
