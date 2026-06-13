#!/usr/bin/env -S deno run --allow-read
/**
 * print-report.ts
 *
 * Pretty-prints an experiment JSON report produced by experiment-runner.ts.
 *
 * Usage:
 *   deno run --allow-read scripts/print-report.ts <report.json>
 *   deno run --allow-read scripts/print-report.ts <report.json> --goals
 *   deno run --allow-read scripts/print-report.ts <report.json> --gaps
 *   deno run --allow-read scripts/print-report.ts <report.json> --full
 */

// ─────────────────────────────────────────────────────────────────
//  ANSI COLORS
// ─────────────────────────────────────────────────────────────────
const isTTY = Deno.stdout.isTerminal();
const c = isTTY
  ? { R:"\x1b[0m", b:"\x1b[1m", d:"\x1b[2m", rd:"\x1b[31m", gr:"\x1b[32m",
      ye:"\x1b[33m", bl:"\x1b[34m", mg:"\x1b[35m", cy:"\x1b[36m",
      wh:"\x1b[37m", gy:"\x1b[90m" }
  : Object.fromEntries(["R","b","d","rd","gr","ye","bl","mg","cy","wh","gy"].map(k => [k, ""])) as Record<string,string>;

const bold    = (s: string) => `${c.b}${s}${c.R}`;
const dim     = (s: string) => `${c.d}${c.gy}${s}${c.R}`;
const green   = (s: string) => `${c.gr}${s}${c.R}`;
const red     = (s: string) => `${c.rd}${s}${c.R}`;
const yellow  = (s: string) => `${c.ye}${s}${c.R}`;
const cyan    = (s: string) => `${c.cy}${s}${c.R}`;
const gray    = (s: string) => `${c.gy}${s}${c.R}`;

// ─────────────────────────────────────────────────────────────────
//  TYPES
// ─────────────────────────────────────────────────────────────────
interface GoalResult {
  goal: string;
  status: string;
  reportId: string | null;
}

interface DocumentationGap {
  fragment: string;
  proposedFix?: string;
  affectedGoals?: string[];
  file?: string;
  documentationGap?: string;
  lineStart?: number;
  lineEnd?: number;
  verified?: boolean;
  occurrences?: number;
  meanConfidence?: number;
}

interface TopFailingFunction {
  functionName: string;
  count: number;
  goals: string[];
}

interface StructuredSummary {
  executiveSummary?: string;
  overallPassRate?: number;
  failureTaxonomy?: Record<string, number>;
  topFailingFunctions?: TopFailingFunction[];
  goalsBreakdown?: GoalResult[];
  documentationGapDetails?: DocumentationGap[];
  recommendations?: string[];
}

interface PhaseData {
  masterPlanId: string | null;
  goals: string[];
  breakdown: GoalResult[];
  structuredSummary: StructuredSummary | null;
  markdownSummary: string | null;
}

interface DriftData {
  regressions:  Array<{ goal: string; baseline: string; experiment: string; reportId: string | null }>;
  improvements: Array<{ goal: string; baseline: string; experiment: string }>;
  stable:       Array<{ goal: string; status: string }>;
}

interface Report {
  meta: {
    project:   string;
    oldImage:  string;
    newImage:  string;
    projectId: string;
    timestamp: string;
    outputFile?: string;
  };
  baseline:   PhaseData;
  experiment: PhaseData;
  drift:      DriftData;
  docsPatch?: {
    patchFile: string | null;
    markdownFile: string | null;
    patchedClusters: number;
    unpatchedClusters: number;
  };
}

// ─────────────────────────────────────────────────────────────────
//  LAYOUT
// ─────────────────────────────────────────────────────────────────
const W = 70;

const hline  = (ch = "─") => ch.repeat(W);
const vline  = (ch = "═") => bold(ch.repeat(W));

function header(title: string, sub = ""): void {
  console.log(`\n${vline()}`);
  const pad = Math.max(0, Math.floor((W - title.length) / 2));
  console.log(bold(" ".repeat(pad) + title));
  if (sub) console.log(gray(" ".repeat(Math.max(0, Math.floor((W - sub.length) / 2))) + sub));
  console.log(vline());
}

function section(title: string): void {
  console.log(`\n${bold(cyan("▸ " + title))}`);
  console.log(gray(hline()));
}

function kv(label: string, value: string, indent = 2): void {
  console.log(" ".repeat(indent) + bold(label.padEnd(16)) + value);
}

/** Strip ANSI codes to measure visible length */
function vislen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function cell(s: string, len: number, align: "left" | "right" = "left"): string {
  const plain = s.replace(/\x1b\[[0-9;]*m/g, "");
  if (plain.length > len) {
    // Truncate the visible text while keeping the ANSI codes at the start intact
    return s.slice(0, s.length - plain.length + len - 1) + "…";
  }
  const spaces = " ".repeat(len - plain.length);
  return align === "right" ? spaces + s : s + spaces;
}

function tableRow(...cols: string[]): string {
  return "  │ " + cols.join(" │ ") + " │";
}

function tableDivider(widths: number[], ch = "─"): string {
  return "  ├─" + widths.map(w => ch.repeat(w + 2)).join("─┼─") + "─┤";
}

function tableTop(widths: number[]): string {
  return "  ┌─" + widths.map(w => "─".repeat(w + 2)).join("─┬─") + "─┐";
}

function tableBottom(widths: number[]): string {
  return "  └─" + widths.map(w => "─".repeat(w + 2)).join("─┴─") + "─┘";
}

// ─────────────────────────────────────────────────────────────────
//  STATUS HELPERS
// ─────────────────────────────────────────────────────────────────
function colorStatus(status: string | undefined): string {
  if (!status) return gray("—");
  if (status === "SUCCESS")         return green("SUCCESS");
  if (status === "FAILED")          return red("FAILED");
  if (status === "PARTIAL_FAILURE") return yellow("PARTIAL");
  return yellow(status);
}

const STATUS_RANK: Record<string, number> = { SUCCESS: 2, PARTIAL_FAILURE: 1, FAILED: 0 };
const rankOf = (s: string) => STATUS_RANK[s] ?? 0;

function driftArrow(bStatus: string, eStatus: string): string {
  if (rankOf(eStatus) < rankOf(bStatus)) return red("↓ REGRESSED");
  if (rankOf(eStatus) > rankOf(bStatus)) return green("↑ IMPROVED");
  if (bStatus === "SUCCESS")             return green("= STABLE");
  return gray("= UNCHANGED");
}

function buildBar(pct: number, width: number): string {
  const filled = Math.round(pct / 100 * width);
  const color  = pct >= 80 ? c.gr : pct >= 50 ? c.ye : c.rd;
  return color + "█".repeat(filled) + c.gy + "░".repeat(width - filled) + c.R;
}

function buildInlineBar(count: number, max: number, width: number, color: string): string {
  const filled = max ? Math.round(count / max * width) : 0;
  return color + "▇".repeat(filled) + c.gy + "·".repeat(width - filled) + c.R;
}

// ─────────────────────────────────────────────────────────────────
//  SECTIONS
// ─────────────────────────────────────────────────────────────────
function printMeta(r: Report): void {
  section("Metadata");
  kv("Project:",   bold(r.meta.project));
  kv("Old image:", r.meta.oldImage);
  kv("New image:", r.meta.newImage);
  kv("Project ID:", gray(r.meta.projectId));
  kv("Timestamp:", r.meta.timestamp);
  if (r.meta.outputFile) kv("File:", dim(r.meta.outputFile));
}

function printOverview(r: Report): void {
  const { baseline: b, experiment: e, drift: d } = r;
  const bPass  = b.breakdown.filter(x => x.status === "SUCCESS").length;
  const ePass  = e.breakdown.filter(x => x.status === "SUCCESS").length;
  const bTotal = b.breakdown.length;
  const eTotal = e.breakdown.length;
  const bRate  = bTotal ? Math.round(bPass / bTotal * 100) : 0;
  const eRate  = eTotal ? Math.round(ePass / eTotal * 100) : 0;

  section("Overall Results");
  console.log(`\n  ${bold("Baseline")}   (old docs + old API)`);
  console.log(`  ${buildBar(bRate, 30)}  ${bold(`${bPass}/${bTotal}`)} passed  ${gray(`(${bRate}%)`)}`);
  console.log(`\n  ${bold("Experiment")} (old docs + new API)`);
  console.log(`  ${buildBar(eRate, 30)}  ${bold(`${ePass}/${eTotal}`)} passed  ${eRate < bRate ? red(`(${eRate}%)`) : green(`(${eRate}%)`)}`);

  console.log();
  if (d.regressions.length === 0 && d.improvements.length === 0) {
    console.log(`  ${green("✓")}  ${bold("No drift detected")} — documentation stable across versions.`);
  } else {
    if (d.regressions.length > 0)
      console.log(`  ${red("⚠")}  ${bold(red(`${d.regressions.length} regression(s)`))} — goals that PASSED on old API but FAILED on new API`);
    if (d.improvements.length > 0)
      console.log(`  ${green("↑")}  ${bold(green(`${d.improvements.length} improvement(s)`))} — goals that FAILED on old API but PASSED on new API`);
  }
}

function printGoalsTable(r: Report): void {
  const allGoals = [...new Set([
    ...r.baseline.breakdown.map(x => x.goal),
    ...r.experiment.breakdown.map(x => x.goal),
  ])];

  section("Goals Comparison");

  const [WG, WB, WE, WD] = [38, 9, 9, 14];
  const widths = [WG, WB, WE, WD];

  console.log(tableTop(widths));
  console.log(tableRow(cell(bold("Goal"), WG), cell(bold("Baseline"), WB), cell(bold("Exp."), WE), cell(bold("Drift"), WD)));
  console.log(tableDivider(widths, "═"));

  for (const goal of allGoals) {
    const b = r.baseline.breakdown.find(x => x.goal === goal);
    const e = r.experiment.breakdown.find(x => x.goal === goal);
    console.log(tableRow(
      cell(goal, WG),
      cell(colorStatus(b?.status), WB),
      cell(colorStatus(e?.status), WE),
      cell(b && e ? driftArrow(b.status, e.status) : gray("—"), WD),
    ));
  }

  console.log(tableBottom(widths));

  if (r.drift.regressions.length > 0) {
    console.log();
    console.log(`  ${red("Regressions:")}`);
    r.drift.regressions.forEach(reg => console.log(`  ${red("•")} ${bold(reg.goal)}`));
  }
}

function printFailureTaxonomy(r: Report): void {
  const bTax = r.baseline.structuredSummary?.failureTaxonomy  ?? {};
  const eTax = r.experiment.structuredSummary?.failureTaxonomy ?? {};
  const classes = [...new Set([...Object.keys(bTax), ...Object.keys(eTax)])].sort();
  if (classes.length === 0) return;

  section("Failure Taxonomy");
  const maxCount = Math.max(1, ...Object.values(bTax), ...Object.values(eTax));
  const BAR_W = 20;
  const [WC, WB, WE] = [16, BAR_W + 5, BAR_W + 5];
  const widths = [WC, WB, WE];

  console.log(tableTop(widths));
  console.log(tableRow(cell(bold("Error class"), WC), cell(bold("Baseline"), WB), cell(bold("Experiment"), WE)));
  console.log(tableDivider(widths, "═"));

  for (const cls of classes) {
    const bCnt = bTax[cls] ?? 0;
    const eCnt = eTax[cls] ?? 0;
    const bBar = buildInlineBar(bCnt, maxCount, BAR_W, c.bl) + " " + String(bCnt).padStart(2);
    const eBar = buildInlineBar(eCnt, maxCount, BAR_W, eCnt > bCnt ? c.rd : c.gr) + " " + String(eCnt).padStart(2);
    console.log(tableRow(cell(yellow(cls), WC), cell(bBar, WB), cell(eBar, WE)));
  }

  console.log(tableBottom(widths));
}

function printDocGaps(r: Report): void {
  const gaps = r.experiment.structuredSummary?.documentationGapDetails ?? [];
  if (gaps.length === 0) {
    console.log(`\n  ${gray("No documentation gaps reported.")}`);
    return;
  }

  section(`Documentation Gaps  (${gaps.length} clustered)`);
  gaps.forEach((gap, i) => {
    const badges = [
      gap.documentationGap ? yellow(gap.documentationGap) : null,
      gap.occurrences ? gray(`×${gap.occurrences}`) : null,
      gap.meanConfidence !== undefined ? gray(`conf ${gap.meanConfidence}`) : null,
      gap.verified === true
        ? green("✓ verified")
        : gap.verified === false
        ? red("✗ unverified")
        : null,
    ].filter(Boolean).join("  ");
    console.log(`\n  ${cyan(bold(`${i + 1}.`))} ${bold(gap.fragment ?? "(no fragment)")}`);
    if (badges) console.log(`     ${badges}`);
    if (gap.file) {
      const loc = gap.lineStart
        ? `${gap.file}:${gap.lineStart}${gap.lineEnd && gap.lineEnd !== gap.lineStart ? `–${gap.lineEnd}` : ""}`
        : gap.file;
      console.log(`     ${gray("Location:")} ${dim(loc)}`);
    }
    if (gap.proposedFix) console.log(`     ${yellow("Proposed fix:")} ${gap.proposedFix}`);
    if (gap.affectedGoals?.length) {
      console.log(`     ${gray("Affected goals:")}`);
      gap.affectedGoals.forEach(g => console.log(`       ${gray("·")} ${dim(g)}`));
    }
  });
}

function printDocsPatch(r: Report): void {
  const p = r.docsPatch;
  if (!p || (!p.patchFile && !p.markdownFile)) return;
  section("Documentation Fix Proposal");
  console.log(`  ${p.patchedClusters} patchable cluster(s), ${p.unpatchedClusters} suggestion(s) without verified location`);
  if (p.patchFile)    console.log(`  ${green("✓")} unified diff:  ${cyan(p.patchFile)}  ${dim("(git apply-able)")}`);
  if (p.markdownFile) console.log(`  ${green("✓")} PR-style note: ${cyan(p.markdownFile)}`);
}

function printTopFailingFunctions(r: Report): void {
  const funcs = r.experiment.structuredSummary?.topFailingFunctions ?? [];
  if (funcs.length === 0) return;

  section("Top Failing API Functions  (experiment)");
  const [WF, WN, WG] = [32, 7, 22];
  const widths = [WF, WN, WG];

  console.log(tableTop(widths));
  console.log(tableRow(cell(bold("Function"), WF), cell(bold("Count"), WN), cell(bold("Goals"), WG)));
  console.log(tableDivider(widths, "═"));

  for (const fn of funcs) {
    console.log(tableRow(
      cell(red(fn.functionName ?? "?"), WF),
      cell(String(fn.count ?? 0), WN),
      cell(dim((fn.goals ?? []).join(", ")), WG),
    ));
  }

  console.log(tableBottom(widths));
}

function printExecutiveSummaries(r: Report): void {
  const bSummary = r.baseline.structuredSummary?.executiveSummary;
  const eSummary = r.experiment.structuredSummary?.executiveSummary;
  if (!bSummary && !eSummary) return;

  section("Executive Summaries");
  if (bSummary) {
    console.log(`\n  ${bold(green("Baseline"))}  (old docs + old API)`);
    bSummary.split("\n").forEach(l => console.log(`  ${l}`));
  }
  if (eSummary) {
    console.log(`\n  ${bold(red("Experiment"))}  (old docs + new API)`);
    eSummary.split("\n").forEach(l => console.log(`  ${l}`));
  }
}

function printRecommendations(r: Report): void {
  const recs = r.experiment.structuredSummary?.recommendations ?? [];
  if (recs.length === 0) return;

  section("Recommendations");
  recs.forEach((rec, i) => console.log(`  ${gray(`${i + 1}.`)} ${rec}`));
}

// ─────────────────────────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────────────────────────
function main(): void {
  const filePath = Deno.args[0];
  if (!filePath || filePath.startsWith("--")) {
    console.error("Usage: deno run --allow-read scripts/print-report.ts <report.json> [--goals] [--gaps] [--full]");
    Deno.exit(1);
  }

  let report: Report;
  try {
    report = JSON.parse(Deno.readTextFileSync(filePath)) as Report;
  } catch (err) {
    console.error(`Cannot read "${filePath}": ${(err as Error).message}`);
    Deno.exit(1);
  }

  const showGoals = Deno.args.includes("--goals") || Deno.args.includes("--full");
  const showGaps  = Deno.args.includes("--gaps")  || Deno.args.includes("--full");
  const showFull  = Deno.args.includes("--full");

  header(
    `Experiment Report — ${report.meta?.project ?? "Unknown"}`,
    report.meta?.timestamp ? new Date(report.meta.timestamp).toLocaleString() : "",
  );

  printMeta(report);
  printOverview(report);

  if (showGoals) {
    printGoalsTable(report);
  } else {
    // Compact: just list regressions inline
    const regs = report.drift?.regressions ?? [];
    if (regs.length > 0) {
      section("Regressions");
      regs.forEach(reg => console.log(`  ${red("•")} ${bold(reg.goal)}`));
    }
  }

  printFailureTaxonomy(report);

  if (showGaps || showFull) printDocGaps(report);
  if (showFull) {
    printTopFailingFunctions(report);
    printExecutiveSummaries(report);
  }
  printDocsPatch(report);
  printRecommendations(report);

  console.log(`\n${vline()}\n`);
}

main();
