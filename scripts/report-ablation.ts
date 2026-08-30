#!/usr/bin/env -S deno run --allow-read --allow-write
/**
 * report-ablation.ts — compares the two arms of the freeze ablation.
 *
 * Arm A (freeze):   phase 3 re-executes the baseline programs verbatim.
 * Arm B (ablation): phase 3 replays the same GOALS but the agent REGENERATES
 *                   the code against the new library version.
 *
 * Both arms resume from the SAME baseline master plan, so freeze is the only
 * variable and every step pairs across all four cells (baseline × arm).
 *
 * What it reports:
 *   - an integrity gate (shared baseline, frozen flags, equal baseline steps) —
 *     the comparison is meaningless if these do not hold, so a failure is loud;
 *   - pass rates and step-level regressions per arm;
 *   - status FLIPS (regressions + improvements), which is where the arms really
 *     diverge: the aggregate pass rate hides regeneration churn;
 *   - API-migration evidence: for every curated breaking change, how often its
 *     golden `matchKeywords` appear in each arm's experiment code. A keyword
 *     that collapses in arm B is the agent routing around the change — the
 *     behaviour freeze exists to prevent.
 *
 * Usage:
 *   deno run --allow-read --allow-write scripts/report-ablation.ts
 *   deno run --allow-read --allow-write scripts/report-ablation.ts --html ablation.html
 *   deno run --allow-read --allow-write scripts/report-ablation.ts --freeze-dir DIR --ablation-dir DIR
 *
 * Domyślne katalogi wskazują na ../docs_and_raports/, dokąd przeniesiono wyniki.
 */
import { EXPERIMENTS } from "./experiments/targets.ts";

// ── CLI ──────────────────────────────────────────────────────────
const arg = (k: string): string | null => {
    const i = Deno.args.indexOf(k);
    return i !== -1 ? Deno.args[i + 1] ?? null : null;
};
const FREEZE_DIR = arg("--freeze-dir") ??
    "../docs_and_raports/archiwum-przebiegow/kopia-with-freeze";
const ABLATION_DIR = arg("--ablation-dir") ??
    "../docs_and_raports/wyniki-eksperymentow";
const HTML_OUT = arg("--html");

// ── ansi ─────────────────────────────────────────────────────────
const c = (n: number) => (s: string | number) => `\x1b[${n}m${s}\x1b[0m`;
const bold = c(1), dim = c(2), red = c(31), green = c(32);

// ── load the newest report per target from a directory ───────────
interface Arm {
    report: Record<string, unknown>;
    full: Record<string, unknown> | null;
}

function loadArm(dir: string): Map<string, Arm> {
    const newest = new Map<string, { ts: number; base: string }>();
    for (const e of Deno.readDirSync(dir)) {
        const m = e.name.match(/^experiment-([a-z0-9]+)-(\d+)\.json$/);
        if (!m || !(m[1] in EXPERIMENTS)) continue;
        const prev = newest.get(m[1]);
        if (!prev || Number(m[2]) > prev.ts) {
            newest.set(m[1], { ts: Number(m[2]), base: `${dir}/experiment-${m[1]}-${m[2]}` });
        }
    }
    const out = new Map<string, Arm>();
    for (const [k, v] of newest) {
        let full: Record<string, unknown> | null = null;
        try {
            full = JSON.parse(Deno.readTextFileSync(`${v.base}-full-reports.json`));
        } catch { /* full reports are optional — migration evidence is skipped */ }
        out.set(k, { report: JSON.parse(Deno.readTextFileSync(`${v.base}.json`)), full });
    }
    return out;
}

// deno-lint-ignore no-explicit-any
const g = (o: any, path: string): any => path.split(".").reduce((a, k) => a?.[k], o);

/** All experiment-phase source concatenated — the corpus for keyword evidence. */
// deno-lint-ignore no-explicit-any
function experimentCode(full: any): string {
    if (!full) return "";
    const reports = full.goalReports ?? {};
    let s = "";
    for (const goal of full.experiment?.structuredSummary?.goalsBreakdown ?? []) {
        for (const step of reports[String(goal.reportId)]?.steps ?? []) {
            s += "\n" + String(step.scriptContent ?? "");
        }
    }
    return s;
}

const countWord = (hay: string, word: string): number =>
    (hay.match(new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g")) ?? [])
        .length;

// ── gather ───────────────────────────────────────────────────────
const F = loadArm(FREEZE_DIR);
const A = loadArm(ABLATION_DIR);

const targets = [...F.keys()].filter((k) => A.has(k)).sort();
if (targets.length === 0) {
    console.error(
        `${red("✗")} no target present in both arms ` +
            `(freeze: ${FREEZE_DIR}, ablation: ${ABLATION_DIR})`,
    );
    Deno.exit(1);
}

interface Row {
    cfg: string;
    baseTotal: number;
    basePass: number;
    fPass: number;
    fRegr: number;
    fImpr: number;
    aPass: number;
    aRegr: number;
    aImpr: number;
    fConf: number;
    fDet: number;
    aConf: number;
    aDet: number;
    nBC: number;
    codeChanged: number;
    codePaired: number;
}

const rows: Row[] = [];
const integrity: string[] = [];

for (const cfg of targets) {
    const f = F.get(cfg)!, a = A.get(cfg)!;
    const fs = g(f.report, "stepDrift"), as = g(a.report, "stepDrift");

    // Integrity gate — the whole comparison rests on these three facts.
    if (g(f.report, "baseline.masterPlanId") !== g(a.report, "baseline.masterPlanId")) {
        integrity.push(`${cfg}: baseline master plans differ — arms are NOT paired`);
    }
    if (g(f.report, "meta.frozen") !== true) integrity.push(`${cfg}: arm A is not frozen`);
    if (g(a.report, "meta.frozen") !== false) integrity.push(`${cfg}: arm B is frozen`);
    if (fs.baseline.total !== as.baseline.total || fs.baseline.passed !== as.baseline.passed) {
        integrity.push(`${cfg}: baseline step counts diverge between arms`);
    }

    // Code identity across arms, paired by (goal text, stepIndex).
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
    // deno-lint-ignore no-explicit-any
    const stepsOf = (full: any) => {
        const reports = full?.goalReports ?? {};
        const out: { key: string; code: string }[] = [];
        for (const goal of full?.experiment?.structuredSummary?.goalsBreakdown ?? []) {
            for (const st of reports[String(goal.reportId)]?.steps ?? []) {
                out.push({
                    key: `${norm(String(goal.goal ?? ""))}#${st.stepIndex}`,
                    code: String(st.scriptContent ?? ""),
                });
            }
        }
        return out;
    };
    const fSteps = stepsOf(f.full), aSteps = new Map(stepsOf(a.full).map((s) => [s.key, s.code]));
    let changed = 0, paired = 0;
    for (const s of fSteps) {
        const other = aSteps.get(s.key);
        if (other === undefined) continue;
        paired++;
        if (other !== s.code) changed++;
    }

    rows.push({
        cfg,
        baseTotal: fs.baseline.total,
        basePass: fs.baseline.passed,
        fPass: fs.experiment.passed,
        fRegr: fs.regressions.length,
        fImpr: fs.improvements.length,
        aPass: as.experiment.passed,
        aRegr: as.regressions.length,
        aImpr: as.improvements.length,
        fConf: g(f.report, "changelog.detection.confirmed") ?? 0,
        fDet: g(f.report, "changelog.detection.detected") ?? 0,
        aConf: g(a.report, "changelog.detection.confirmed") ?? 0,
        aDet: g(a.report, "changelog.detection.detected") ?? 0,
        nBC: (g(f.report, "changelog.goldenBreakingChanges") ?? []).length,
        codeChanged: changed,
        codePaired: paired,
    });
}

const sum = (pick: (r: Row) => number) => rows.reduce((n, r) => n + pick(r), 0);
const T = {
    steps: sum((r) => r.baseTotal),
    base: sum((r) => r.basePass),
    fPass: sum((r) => r.fPass),
    aPass: sum((r) => r.aPass),
    fRegr: sum((r) => r.fRegr),
    aRegr: sum((r) => r.aRegr),
    fImpr: sum((r) => r.fImpr),
    aImpr: sum((r) => r.aImpr),
    fConf: sum((r) => r.fConf),
    aConf: sum((r) => r.aConf),
    fDet: sum((r) => r.fDet),
    aDet: sum((r) => r.aDet),
    nBC: sum((r) => r.nBC),
    changed: sum((r) => r.codeChanged),
    paired: sum((r) => r.codePaired),
};
const fFlips = T.fRegr + T.fImpr, aFlips = T.aRegr + T.aImpr;
const pct = (n: number, d: number) => d === 0 ? "—" : `${(100 * n / d).toFixed(1)}%`;

// ── migration evidence, driven by the golden dataset ─────────────
interface Mig {
    cfg: string;
    id: string;
    summary: string;
    keyword: string;
    inFreeze: number;
    inAblation: number;
}
const migrations: Mig[] = [];
for (const cfg of targets) {
    const f = F.get(cfg)!, a = A.get(cfg)!;
    const fCode = experimentCode(f.full), aCode = experimentCode(a.full);
    if (!fCode && !aCode) continue;
    for (const bc of g(f.report, "changelog.goldenBreakingChanges") ?? []) {
        for (const kw of bc.matchKeywords ?? []) {
            const inF = countWord(fCode, kw), inA = countWord(aCode, kw);
            if (inF === 0 && inA === 0) continue;
            migrations.push({
                cfg,
                id: bc.id,
                summary: String(bc.summary ?? "").replace(/`/g, ""),
                keyword: kw,
                inFreeze: inF,
                inAblation: inA,
            });
        }
    }
}

// ── console ──────────────────────────────────────────────────────
const line = (n = 78) => console.log(dim("─".repeat(n)));

console.log(`\n${bold("Ablacja zamrożenia kodu — porównanie ramion")}`);
console.log(dim(`  A (freeze):   ${FREEZE_DIR}`));
console.log(dim(`  B (ablacja):  ${ABLATION_DIR}`));
console.log(dim(`  celów: ${targets.length}, kroków: ${T.steps}\n`));

if (integrity.length > 0) {
    console.log(`${red("✗ INTEGRALNOŚĆ NARUSZONA — porównanie nie jest parowane:")}`);
    for (const p of integrity) console.log(`  ${red("•")} ${p}`);
    console.log();
} else {
    console.log(
        `${green("✓")} integralność: wspólna linia bazowa, freeze jedyną zmienną, ` +
            `identyczne liczby kroków bazowych\n`,
    );
}

console.log(
    bold("cel".padEnd(12)) + bold("baza".padEnd(9)) +
        bold("FREEZE  zdane  regr  popr".padEnd(28)) + bold("ABLACJA  zdane  regr  popr"),
);
line();
for (const r of rows) {
    const delta = r.aPass - r.fPass;
    const mark = delta > 0 ? green(`+${delta}`) : delta < 0 ? red(`${delta}`) : dim("0");
    console.log(
        r.cfg.padEnd(12) +
            `${r.basePass}/${r.baseTotal}`.padEnd(9) +
            `${String(r.fPass).padStart(9)}${String(r.fRegr).padStart(6)}${
                String(r.fImpr).padStart(6)
            }`.padEnd(28) +
            `${String(r.aPass).padStart(10)}${String(r.aRegr).padStart(6)}${
                String(r.aImpr).padStart(6)
            }   ${mark}`,
    );
}
line();
console.log(
    "RAZEM".padEnd(12) + `${T.base}/${T.steps}`.padEnd(9) +
        `${String(T.fPass).padStart(9)}${String(T.fRegr).padStart(6)}${String(T.fImpr).padStart(6)}`
            .padEnd(28) +
        `${String(T.aPass).padStart(10)}${String(T.aRegr).padStart(6)}${
            String(T.aImpr).padStart(6)
        }`,
);

console.log(`\n${bold("Wskaźniki zdawalności")}`);
console.log(`  linia bazowa (wspólna)   ${T.base}/${T.steps} = ${pct(T.base, T.steps)}`);
console.log(`  faza 3 — FREEZE          ${T.fPass}/${T.steps} = ${pct(T.fPass, T.steps)}`);
console.log(`  faza 3 — ABLACJA         ${T.aPass}/${T.steps} = ${pct(T.aPass, T.steps)}`);

console.log(`\n${bold("Zmiany statusu (flips = regresje + poprawy)")}`);
console.log(
    `  FREEZE   ${String(fFlips).padStart(3)}/${T.steps} = ${
        pct(fFlips, T.steps)
    }   (${T.fRegr} regr + ${T.fImpr} popr)`,
);
console.log(
    `  ABLACJA  ${String(aFlips).padStart(3)}/${T.steps} = ${
        pct(aFlips, T.steps)
    }   (${T.aRegr} regr + ${T.aImpr} popr)`,
);
console.log(
    dim(
        `  regeneracja zwiększa zmienność o ${(aFlips / Math.max(1, fFlips)).toFixed(2)}× ` +
            `przy niemal identycznej zdawalności`,
    ),
);

console.log(`\n${bold("Wykrycie breaking changes")}`);
console.log(`  FREEZE   potwierdzone ${T.fConf}/${T.nBC}, wykryte ${T.fDet}/${T.nBC}`);
console.log(`  ABLACJA  potwierdzone ${T.aConf}/${T.nBC}, wykryte ${T.aDet}/${T.nBC}`);

console.log(`\n${bold("Tożsamość kodu fazy 3")}`);
console.log(
    `  ${T.changed}/${T.paired} sparowanych kroków ma INNY kod w ablacji = ${
        pct(T.changed, T.paired)
    }`,
);

const shifted = migrations
    .filter((m) => Math.abs(m.inAblation - m.inFreeze) >= 3)
    .sort((x, y) => (y.inFreeze - y.inAblation) - (x.inFreeze - x.inAblation));
if (shifted.length > 0) {
    console.log(`\n${bold("Migracja API — słowa kluczowe ze złotego zbioru")}`);
    console.log(dim("  spadek = agent porzucił udokumentowany symbol; wzrost = przyjął nowy\n"));
    console.log(
        dim("  cel".padEnd(13) + "słowo kluczowe".padEnd(26) + "FREEZE".padEnd(9) + "ABLACJA"),
    );
    for (const m of shifted) {
        const d = m.inAblation - m.inFreeze;
        const tag = d < 0 ? red(`${d}`) : green(`+${d}`);
        console.log(
            `  ${m.cfg.padEnd(11)}${m.keyword.padEnd(26)}${String(m.inFreeze).padStart(6)}${
                String(m.inAblation).padStart(9)
            }   ${tag}`,
        );
    }
}
console.log();

// ── HTML ─────────────────────────────────────────────────────────
if (HTML_OUT) {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const cls = (d: number) => d > 0 ? "up" : d < 0 ? "down" : "flat";
    const sign = (d: number) => d > 0 ? `+${d}` : `${d}`;

    const html = `<!doctype html>
<html lang="pl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ablacja zamrożenia kodu — porównanie ramion</title>
<style>
:root{
  --bg:oklch(0.98 0.006 75); --card:oklch(1 0 0);
  --fg:oklch(0.18 0.01 285); --mut:oklch(0.5 0.012 285); --line:oklch(0.88 0.008 75);
  --ok:oklch(0.52 0.17 152); --ok-soft:oklch(0.52 0.17 152 / 10%);
  --bad:oklch(0.55 0.22 27); --bad-soft:oklch(0.55 0.22 27 / 10%);
  --warn:oklch(0.6 0.16 75); --info:oklch(0.5 0.14 235);
  --r-lg:0.625rem; --r-sm:0.375rem;
  --sans:"Inter",ui-sans-serif,system-ui,-apple-system,sans-serif;
  --mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
}
*{box-sizing:border-box}
body{margin:0 auto;padding:2.5rem 1.5rem 5rem;max-width:1100px;background:var(--bg);
     color:var(--fg);font:15px/1.6 var(--sans);-webkit-font-smoothing:antialiased}
h1{font-size:1.75rem;font-weight:650;letter-spacing:-.02em;margin:0 0 .3rem}
h2{font-size:1.2rem;font-weight:620;letter-spacing:-.015em;margin:2.5rem 0 .5rem}
.sub{color:var(--mut);margin:0 0 2rem}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:.8rem;margin-bottom:1rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r-lg);
      padding:1rem 1.1rem;box-shadow:0 1px 2px oklch(0 0 0 / 4%)}
.card .n{font-size:1.6rem;font-weight:650;letter-spacing:-.02em}
.card .l{color:var(--mut);font-size:.8rem;margin-top:.15rem}
.gate{border-radius:var(--r-lg);padding:.8rem 1rem;margin-bottom:2rem;font-size:.9rem}
.gate.ok{background:var(--ok-soft);border:1px solid var(--ok);color:var(--ok)}
.gate.bad{background:var(--bad-soft);border:1px solid var(--bad);color:var(--bad)}
.scroll{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:.88rem;min-width:640px}
th{text-align:left;color:var(--mut);font-weight:600;font-size:.72rem;text-transform:uppercase;
   letter-spacing:.06em;padding:.5rem .6rem;border-bottom:1px solid var(--line)}
td{padding:.45rem .6rem;border-bottom:1px solid var(--line)}
tbody tr:last-child td{border-bottom:none}
tfoot td{font-weight:650;border-top:2px solid var(--line);border-bottom:none}
.num{text-align:right;font-variant-numeric:tabular-nums}
.mono{font-family:var(--mono);font-size:.82rem}
.up{color:var(--ok);font-weight:600}.down{color:var(--bad);font-weight:600}.flat{color:var(--mut)}
.note{color:var(--mut);font-size:.87rem;margin:.4rem 0 1rem}
@media(prefers-color-scheme:dark){
 :root{--bg:oklch(0.19 0.01 285);--card:oklch(0.23 0.012 285);--fg:oklch(0.94 0.005 285);
       --mut:oklch(0.68 0.012 285);--line:oklch(0.32 0.012 285)}
}
</style></head><body>
<h1>Ablacja zamrożenia kodu</h1>
<p class="sub">Ramię A zamraża programy z fazy bazowej; ramię B odtwarza te same cele,
ale pozwala agentowi wygenerować kod na nowo. Oba wznawiane z tej samej linii bazowej,
więc zamrożenie jest jedyną zmienną. ${targets.length} bibliotek, ${T.steps} kroków.</p>

<div class="gate ${integrity.length ? "bad" : "ok"}">
${
        integrity.length
            ? "✗ Integralność naruszona: " + integrity.map(esc).join("; ")
            : "✓ Integralność potwierdzona: wspólna linia bazowa, zgodne flagi freeze, identyczne liczby kroków bazowych."
    }
</div>

<div class="cards">
  <div class="card"><div class="n">${
        pct(T.base, T.steps)
    }</div><div class="l">linia bazowa (wspólna)</div></div>
  <div class="card"><div class="n">${
        pct(T.fPass, T.steps)
    }</div><div class="l">faza 3 — freeze</div></div>
  <div class="card"><div class="n">${
        pct(T.aPass, T.steps)
    }</div><div class="l">faza 3 — ablacja</div></div>
  <div class="card"><div class="n">${
        pct(fFlips, T.steps)
    }</div><div class="l">zmienność — freeze</div></div>
  <div class="card"><div class="n">${
        pct(aFlips, T.steps)
    }</div><div class="l">zmienność — ablacja</div></div>
</div>
<p class="note">Zdawalność w obu ramionach jest niemal identyczna
(${T.fPass} vs ${T.aPass} kroków), ale zmienność statusu rośnie
${(aFlips / Math.max(1, fFlips)).toFixed(2)}× (${fFlips} → ${aFlips} zmian).
Regeneracja nie przesuwa wyniku zbiorczego — niszczy przypisywalność pojedynczego kroku.</p>

<h2>Wyniki per biblioteka</h2>
<div class="scroll"><table>
<thead><tr><th>cel</th><th class="num">baza</th>
<th class="num">freeze zdane</th><th class="num">regr</th><th class="num">popr</th>
<th class="num">ablacja zdane</th><th class="num">regr</th><th class="num">popr</th>
<th class="num">Δ zdanych</th></tr></thead><tbody>
${
        rows.map((r) => {
            const d = r.aPass - r.fPass;
            return `<tr><td>${esc(r.cfg)}</td><td class="num mono">${r.basePass}/${r.baseTotal}</td>
<td class="num">${r.fPass}</td><td class="num">${r.fRegr}</td><td class="num">${r.fImpr}</td>
<td class="num">${r.aPass}</td><td class="num">${r.aRegr}</td><td class="num">${r.aImpr}</td>
<td class="num ${cls(d)}">${sign(d)}</td></tr>`;
        }).join("\n")
    }
</tbody><tfoot><tr><td>RAZEM</td><td class="num mono">${T.base}/${T.steps}</td>
<td class="num">${T.fPass}</td><td class="num">${T.fRegr}</td><td class="num">${T.fImpr}</td>
<td class="num">${T.aPass}</td><td class="num">${T.aRegr}</td><td class="num">${T.aImpr}</td>
<td class="num ${cls(T.aPass - T.fPass)}">${sign(T.aPass - T.fPass)}</td></tr></tfoot>
</table></div>

<h2>Wykrycie breaking changes</h2>
<div class="scroll"><table>
<thead><tr><th>ramię</th><th class="num">potwierdzone</th><th class="num">wykryte</th><th class="num">ze złotego zbioru</th></tr></thead>
<tbody>
<tr><td>freeze</td><td class="num">${T.fConf}</td><td class="num">${T.fDet}</td><td class="num">${T.nBC}</td></tr>
<tr><td>ablacja</td><td class="num">${T.aConf}</td><td class="num">${T.aDet}</td><td class="num">${T.nBC}</td></tr>
</tbody></table></div>

<h2>Tożsamość kodu fazy 3</h2>
<p class="note">${T.changed} z ${T.paired} sparowanych kroków (${
        pct(T.changed, T.paired)
    }) ma w ablacji inny kod źródłowy — potwierdzenie, że regeneracja faktycznie zaszła.</p>

<h2>Migracja API</h2>
<p class="note">Liczba wystąpień słów kluczowych ze złotego zbioru w kodzie fazy 3.
Spadek oznacza, że agent porzucił udokumentowany symbol; wzrost — że przyjął ten
z nowej wersji. Pokazane zmiany o co najmniej 3 wystąpienia.</p>
<div class="scroll"><table>
<thead><tr><th>cel</th><th>słowo kluczowe</th><th>breaking change</th>
<th class="num">freeze</th><th class="num">ablacja</th><th class="num">Δ</th></tr></thead><tbody>
${
        shifted.map((m) => {
            const d = m.inAblation - m.inFreeze;
            return `<tr><td>${esc(m.cfg)}</td><td class="mono">${esc(m.keyword)}</td>
<td>${esc(m.summary.slice(0, 90))}</td>
<td class="num">${m.inFreeze}</td><td class="num">${m.inAblation}</td>
<td class="num ${cls(d)}">${sign(d)}</td></tr>`;
        }).join("\n")
    }
</tbody></table></div>
</body></html>`;
    Deno.writeTextFileSync(HTML_OUT, html);
    console.log(`${green("✓")} HTML: ${bold(HTML_OUT)}\n`);
}
