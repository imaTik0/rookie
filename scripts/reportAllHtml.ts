/**
 * reportAllHtml.ts — self-contained HTML rendering for report-all.ts.
 *
 * One standalone file (inline CSS/JS, no network) so it can be opened anywhere
 * or attached to the thesis. Granular by design: every goal expands into its
 * individual steps with the baseline/experiment status of each, and regressed
 * steps carry the error that caused them — that is the evidence behind each
 * drift claim.
 */
import type { TargetView } from "./report-all.ts";

const esc = (s: unknown): string =>
    String(s ?? "")
        .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");

const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 100));

/** Colour class for a step/goal status. */
const cls = (s: string) =>
    s === "SUCCESS" ? "ok" : s === "PARTIAL_FAILURE" ? "warn" : s === "—" ? "none" : "bad";

function bars(bp: number, ep: number): string {
    return `<div class="bars">
      <div class="barrow"><span class="lbl">baseline</span>
        <span class="bar"><i style="width:${bp}%"></i></span><b>${bp}%</b></div>
      <div class="barrow"><span class="lbl">experiment</span>
        <span class="bar ${
        ep < bp ? "down" : ""
    }"><i style="width:${ep}%"></i></span><b>${ep}%</b></div>
    </div>`;
}

// ── JavaScript syntax highlighting ────────────────────────────────────────────
// Tokenised at GENERATION time, so the page stays a static self-contained file:
// no client-side script, no CDN, and it still renders with JS disabled.

const JS_KEYWORDS = new Set([
    "const",
    "let",
    "var",
    "function",
    "return",
    "async",
    "await",
    "import",
    "export",
    "from",
    "as",
    "class",
    "extends",
    "super",
    "new",
    "delete",
    "typeof",
    "instanceof",
    "in",
    "of",
    "if",
    "else",
    "for",
    "while",
    "do",
    "switch",
    "case",
    "break",
    "continue",
    "try",
    "catch",
    "finally",
    "throw",
    "yield",
    "static",
    "get",
    "set",
    "default",
    "void",
]);
const JS_LITERALS = new Set(["true", "false", "null", "undefined", "this", "NaN", "Infinity"]);
const JS_BUILTINS = new Set([
    "console",
    "process",
    "JSON",
    "Object",
    "Array",
    "String",
    "Number",
    "Boolean",
    "Math",
    "Promise",
    "Error",
    "Map",
    "Set",
    "Date",
    "RegExp",
    "Symbol",
    "BigInt",
    "globalThis",
    "require",
    "module",
    "exports",
    "Buffer",
    "URL",
    "fetch",
    "assert",
    "setTimeout",
]);

/**
 * One pass over the source, matching (in priority order) comments, strings and
 * template literals, numbers, identifiers, then punctuation. Every token's text
 * is HTML-escaped as it is wrapped, so highlighting can never inject markup.
 */
function highlightJs(code: string): string {
    const TOKEN =
        /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(`(?:\\[\s\S]|[^`\\])*`|'(?:\\[\s\S]|[^'\\\n])*'|"(?:\\[\s\S]|[^"\\\n])*")|(\b\d[\w.]*\b)|([A-Za-z_$][\w$]*)|([{}()[\];,.:?=+\-*/%<>!&|^~]+)/g;
    let out = "";
    let last = 0;
    for (const m of code.matchAll(TOKEN)) {
        const i = m.index ?? 0;
        if (i > last) out += esc(code.slice(last, i));
        last = i + m[0].length;
        const [, comment, str, num, ident, punct] = m;
        if (comment !== undefined) out += `<span class="c">${esc(comment)}</span>`;
        else if (str !== undefined) out += `<span class="s">${esc(str)}</span>`;
        else if (num !== undefined) out += `<span class="n">${esc(num)}</span>`;
        else if (ident !== undefined) {
            const after = code.slice(last).match(/^\s*\(/); // call site?
            const before = code.slice(0, i).match(/\.\s*$/); // member access?
            const kls = JS_KEYWORDS.has(ident)
                ? "k"
                : JS_LITERALS.has(ident)
                ? "l"
                : after
                ? "f"
                : (!before && JS_BUILTINS.has(ident))
                ? "b"
                : before
                ? "p"
                : "";
            out += kls ? `<span class="${kls}">${esc(ident)}</span>` : esc(ident);
        } else if (punct !== undefined) out += `<span class="o">${esc(punct)}</span>`;
    }
    out += esc(code.slice(last));
    return out;
}

/**
 * Render a unified diff. Colouring is per line-prefix (`+`/`-`/`@@`/`---`/`+++`),
 * which is all a docs patch needs and keeps this dependency-free. Text is escaped
 * per line, so patch content can never inject markup.
 */
function renderDiff(patch: string): string {
    return patch.split("\n").map((line) => {
        const k = line.startsWith("+++") || line.startsWith("---")
            ? "dfile"
            : line.startsWith("@@")
            ? "dhunk"
            : line.startsWith("+")
            ? "dadd"
            : line.startsWith("-")
            ? "ddel"
            : "dctx";
        return `<span class="${k}">${esc(line) || "&nbsp;"}</span>`;
    }).join("\n");
}

/**
 * The actionable output: what the pipeline proposes changing in the docs.
 * Shows the git-apply-able unified diff, plus each verified gap as an explicit
 * current-text → proposed-text pair.
 */
function docsDiffBlock(t: TargetView): string {
    if (!t.docsPatch && t.gaps.length === 0) return "";
    const gapCards = t.gaps.filter((g) => g.proposedFix).slice(0, 6).map((g) => `
      <div class="ev">
        <div class="dh">
          ${g.documentationGap ? `<span class="pill kind">${esc(g.documentationGap)}</span>` : ""}
          ${
        g.verified
            ? `<span class="pill ok">verified</span>`
            : `<span class="pill none">unverified location</span>`
    }
          ${
        g.file
            ? `<span class="loc">${esc(g.file)}${g.lineStart ? `:${g.lineStart}` : ""}</span>`
            : ""
    }
          ${g.occurrences ? `<span class="loc">×${g.occurrences}</span>` : ""}
        </div>
        <div class="evh" style="margin-top:.45rem">Current documentation</div>
        <pre class="cur">${esc(g.fragment ?? "").slice(0, 900)}</pre>
        <div class="evh" style="margin-top:.5rem">Proposed replacement</div>
        <pre class="prop">${esc(g.proposedFix ?? "").slice(0, 1200)}</pre>
      </div>`).join("");

    return `<h3>Suggested documentation changes</h3>
    ${
        t.docsPatch
            ? `<div class="ev">
             <div class="dh">
               <span class="pill ok">${t.patchedClusters} patchable</span>
               ${
                t.unpatchedClusters
                    ? `<span class="pill none">${t.unpatchedClusters} without verified location</span>`
                    : ""
            }
               <span class="loc">unified diff — <code>git apply</code></span>
             </div>
             <pre class="diff">${renderDiff(t.docsPatch)}</pre>
           </div>`
            : ""
    }
    ${gapCards}`;
}

/** Line-numbered gutter for a code block (rendered as a sibling column). */
function lineNumbers(code: string): string {
    const n = code.split("\n").length;
    return Array.from({ length: n }, (_, i) => i + 1).join("\n");
}

/**
 * The evidence view: for each documented breaking change, what the pipeline
 * actually produced — the frozen program that regressed, the error the new
 * version raised, and the documentation fix proposed in response.
 */
function detectionsBlock(t: TargetView): string {
    if (t.detections.length === 0) return "";
    const items = t.detections.map((d) => {
        const ev = d.evidence.map((e) => `
        <div class="ev">
          <div class="evh">Evidence — goal step #${e.stepIndex}</div>
          <div class="hint">${esc(e.stepDescription).slice(0, 220)}</div>
          ${
            e.error
                ? `<div class="evh" style="margin-top:.5rem">Error on ${esc(t.newVersion)}</div>
                 <pre class="err">${esc(e.error).slice(0, 700)}</pre>`
                : ""
        }
          ${
            e.code
                ? `<div class="evh" style="margin-top:.5rem">Generated program — complete, ${
                    e.code.split("\n").length
                } lines (passed on ${esc(t.oldVersion)})</div>
                 <div class="codewrap"><pre class="ln">${
                    lineNumbers(e.code)
                }</pre><pre class="code"><code>${highlightJs(e.code)}</code></pre></div>`
                : ""
        }
          ${
            e.reasoning
                ? `<div class="evh" style="margin-top:.5rem">Analysis</div>
                 <div class="hint">${esc(e.reasoning).slice(0, 600)}</div>`
                : ""
        }
          ${
            e.suggestedFix
                ? `<div class="evh" style="margin-top:.5rem">Suggested documentation fix</div>
                 <div class="fix">${esc(e.suggestedFix).slice(0, 700)}</div>
                 ${e.location ? `<div class="loc">📍 ${esc(e.location)}</div>` : ""}`
                : ""
        }
        </div>`).join("");

        return `<div class="det${
            d.via === "regression" ? " confirmed" : d.detected ? "" : " missed"
        }">
        <div class="dh">
          ${
            d.via === "regression"
                ? '<span class="pill ok">confirmed by runtime break</span>'
                : d.detected
                ? '<span class="pill warn">gap-only — nothing broke</span>'
                : '<span class="pill none">not detected</span>'
        }
          ${d.change.kind ? `<span class="pill kind">${esc(d.change.kind)}</span>` : ""}
          <span class="did">${esc(d.change.id)}</span>
        </div>
        <div class="dsum">${esc(d.change.summary)}</div>
        ${
            d.change.oldUsageHint
                ? `<div class="hint"><b>Old usage exercised:</b> ${
                    esc(d.change.oldUsageHint)
                }</div>`
                : ""
        }
        ${
            d.detected && ev === ""
                ? '<div class="hint"><i>Detected via a documentation gap rather than a specific regressed step.</i></div>'
                : ev
        }
      </div>`;
    }).join("");
    return `<h3>Documented breaking changes &amp; evidence</h3>${items}`;
}

function targetSection(t: TargetView): string {
    const bp = pct(t.step.baseline.passed, t.step.baseline.total);
    const ep = pct(t.step.experiment.passed, t.step.experiment.total);

    const goalBlocks = t.goals.map((g, gi) => {
        const stepRows = g.steps.map((s) =>
            `<tr class="${s.change}">
            <td class="num">${s.stepIndex}</td>
            <td class="desc">${esc(s.description).slice(0, 160)}</td>
            <td><span class="pill ${cls(s.baseline)}">${esc(s.baseline)}</span></td>
            <td><span class="pill ${cls(s.experiment)}">${esc(s.experiment)}</span></td>
            <td class="chg">${
                s.change === "regression"
                    ? '<span class="pill bad">▼ regressed</span>'
                    : s.change === "improvement"
                    ? '<span class="pill warn">▲ flaky</span>'
                    : s.change === "unpaired"
                    ? '<span class="pill none">unpaired</span>'
                    : ""
            }</td>
          </tr>${
                s.evidence
                    ? `<tr class="evrow"><td></td><td colspan="4"><pre>${
                        esc(s.evidence).slice(0, 900)
                    }</pre></td></tr>`
                    : ""
            }`
        ).join("");

        const nRegr = g.steps.filter((s) => s.change === "regression").length;
        const passed = g.steps.filter((s) => s.baseline === "SUCCESS").length;
        return `<details class="goal"${nRegr > 0 ? " open" : ""}>
          <summary>
            <span class="gi">#${gi + 1}</span>
            <span class="gt">${esc(g.goal).slice(0, 150)}</span>
            <span class="gs">
              <span class="pill ${cls(g.baselineStatus)}">${esc(g.baselineStatus)}</span>
              <span class="arrow">→</span>
              <span class="pill ${cls(g.experimentStatus)}">${esc(g.experimentStatus)}</span>
              <span class="cnt">${passed}/${g.steps.length} steps</span>
              ${nRegr > 0 ? `<span class="pill bad">${nRegr} regressed</span>` : ""}
            </span>
          </summary>
          <div class="scroll"><table class="steps">
            <thead><tr><th>#</th><th>program</th><th>old</th><th>new</th><th></th></tr></thead>
            <tbody>${stepRows}</tbody>
          </table></div>
        </details>`;
    }).join("");

    return `<section class="target pane" id="pane-t-${esc(t.key)}">
      <h2>${esc(t.name)} <span class="ver">${esc(t.library)} ${esc(t.oldVersion)} → ${
        esc(t.newVersion)
    }</span></h2>
      ${t.warning ? `<p class="warning">⚠ ${esc(t.warning)}</p>` : ""}
      <div class="meta">
        <span>runtime <b>${esc(t.runtime)}</b></span>
        <span>frozen code <b>${t.frozen ? "yes" : "no"}</b></span>
        <span>goals <b>${t.goalPass.baseline}/${t.goalPass.total} → ${t.goalPass.experiment}/${t.goalPass.total}</b></span>
        <span>steps <b>${t.step.baseline.passed}/${t.step.baseline.total} → ${t.step.experiment.passed}/${t.step.experiment.total}</b></span>
        <span>step regressions <b class="${
        t.step.regressions.length ? "hot" : ""
    }">${t.step.regressions.length}</b></span>
        ${
        t.recall
            ? `<span>confirmed <b>${t.recall.confirmed ?? 0}/${t.recall.total}</b></span>
               <span>detected <b>${t.recall.detected}/${t.recall.total}</b></span>`
            : ""
    }
        ${
        t.faithfulness
            ? `<span>used documented API <b>${t.faithfulness.faithfulSteps}/${t.faithfulness.checkedSteps}</b></span>`
            : ""
    }
      </div>
      ${bars(bp, ep)}
      ${detectionsBlock(t)}
      ${docsDiffBlock(t)}
      <h3>Goals &amp; steps</h3>
      ${goalBlocks}
    </section>`;
}

export function renderHtml(targets: TargetView[]): string {
    const sum = (f: (t: TargetView) => number) => targets.reduce((a, t) => a + f(t), 0);
    const bTot = sum((t) => t.step.baseline.total), bPass = sum((t) => t.step.baseline.passed);
    const eTot = sum((t) => t.step.experiment.total), ePass = sum((t) => t.step.experiment.passed);
    const regr = sum((t) => t.step.regressions.length);
    const impr = sum((t) => t.step.improvements.length);
    const recD = sum((t) => t.recall?.detected ?? 0), recT = sum((t) => t.recall?.total ?? 0);
    const recC = sum((t) => t.recall?.confirmed ?? 0);

    const rows = targets.map((t) => {
        const bp = pct(t.step.baseline.passed, t.step.baseline.total);
        const ep = pct(t.step.experiment.passed, t.step.experiment.total);
        return `<tr${t.warning ? ' class="flagged"' : ""}>
        <td><a href="#t-${esc(t.key)}">${esc(t.key)}</a>${t.warning ? " ⚠" : ""}</td>
        <td class="mono">${esc(t.oldVersion)} → ${esc(t.newVersion)}</td>
        <td>${t.goalPass.baseline}/${t.goalPass.total} → ${t.goalPass.experiment}/${t.goalPass.total}</td>
        <td>${t.step.baseline.passed}/${t.step.baseline.total} → ${t.step.experiment.passed}/${t.step.experiment.total}</td>
        <td class="${ep < bp ? "hot" : ""}">${bp}% → ${ep}%</td>
        <td class="${t.step.regressions.length ? "hot" : ""}">${t.step.regressions.length}</td>
        <td>${t.recall ? `${t.recall.confirmed ?? 0}/${t.recall.total}` : "—"}</td>
        <td>${t.recall ? `${t.recall.detected}/${t.recall.total}` : "—"}</td>
        <td>${
            t.faithfulness ? `${t.faithfulness.faithfulSteps}/${t.faithfulness.checkedSteps}` : "—"
        }</td>
      </tr>`;
    }).join("");

    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rookie — documentation-drift results</title>
<style>
/* Palette mirrors frontend/src/index.css (warm off-white, coral accent). */
:root{
  --bg:oklch(0.98 0.006 75); --surface:oklch(0.96 0.007 75); --card:oklch(1 0 0);
  --fg:oklch(0.18 0.01 285); --mut:oklch(0.5 0.012 285); --line:oklch(0.88 0.008 75);
  --accent:oklch(0.62 0.15 35); --accent-soft:oklch(0.62 0.15 35 / 10%);
  --ok:oklch(0.52 0.17 152); --ok-soft:oklch(0.52 0.17 152 / 10%);
  --warn:oklch(0.6 0.16 75); --warn-soft:oklch(0.6 0.16 75 / 12%);
  --bad:oklch(0.55 0.22 27); --bad-soft:oklch(0.55 0.22 27 / 10%);
  --info:oklch(0.5 0.14 235); --info-soft:oklch(0.5 0.14 235 / 10%);
  --r-lg:0.625rem; --r-md:0.5rem; --r-sm:0.375rem;
  --sans:"Inter",ui-sans-serif,system-ui,-apple-system,sans-serif;
  --mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
}
*{box-sizing:border-box}
body{margin:0 auto;padding:2.5rem 1.5rem 5rem;max-width:1180px;background:var(--bg);
     color:var(--fg);font:15px/1.6 var(--sans);-webkit-font-smoothing:antialiased;
     font-feature-settings:"cv11","ss01"}
h1{font-size:1.75rem;font-weight:650;letter-spacing:-.02em;margin:0 0 .3rem}
h2{font-size:1.3rem;font-weight:620;letter-spacing:-.015em;margin:0 0 .4rem;scroll-margin-top:1rem}
h3{font-size:.78rem;font-weight:600;margin:1.6rem 0 .6rem;color:var(--mut);
   text-transform:uppercase;letter-spacing:.06em}
.sub{color:var(--mut);margin:0 0 2rem}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:.8rem;margin-bottom:2.25rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r-lg);
      padding:1rem 1.1rem;box-shadow:0 1px 2px oklch(0 0 0 / 4%)}
.card .n{font-size:1.6rem;font-weight:650;letter-spacing:-.02em}
.card .l{color:var(--mut);font-size:.8rem;margin-top:.15rem}
.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
table{width:100%;border-collapse:collapse;font-size:.88rem}
.overview table,table.steps{min-width:660px}
th{text-align:left;color:var(--mut);font-weight:600;font-size:.72rem;text-transform:uppercase;
   letter-spacing:.06em;padding:.5rem .6rem;border-bottom:1px solid var(--line)}
td{padding:.5rem .6rem;border-bottom:1px solid var(--line);vertical-align:top}
.overview{background:var(--card);border:1px solid var(--line);border-radius:var(--r-lg);
          margin-bottom:2.5rem;box-shadow:0 1px 2px oklch(0 0 0 / 4%)}
.overview table{margin:0}.overview tbody tr:last-child td{border-bottom:none}
.overview tbody tr:hover{background:var(--surface)}
.overview tr.flagged{opacity:.6}
a{color:var(--accent);text-decoration:none;font-weight:550}a:hover{text-decoration:underline}
.mono,code,pre{font-family:var(--mono)}
.hot{color:var(--bad);font-weight:600}
.target{border-top:1px solid var(--line);padding-top:1.75rem;margin-top:2.75rem}
.ver{font-weight:400;color:var(--mut);font-size:.87rem;font-family:var(--mono)}
.warning{background:var(--warn-soft);border-left:3px solid var(--warn);padding:.55rem .8rem;
         border-radius:0 var(--r-sm) var(--r-sm) 0;color:oklch(0.42 0.12 75);font-size:.86rem}
.meta{display:flex;flex-wrap:wrap;gap:.35rem 1.3rem;color:var(--mut);font-size:.84rem;margin:.7rem 0 1.1rem}
.meta b{color:var(--fg);font-weight:600}
.bars{max-width:540px;margin-bottom:.6rem}
.barrow{display:flex;align-items:center;gap:.7rem;margin:.25rem 0;font-size:.82rem;color:var(--mut)}
.barrow .lbl{width:78px}
.bar{flex:1;height:8px;background:var(--surface);border:1px solid var(--line);border-radius:99px;overflow:hidden}
.bar i{display:block;height:100%;background:var(--ok);border-radius:99px}
.bar.down i{background:var(--bad)}
.barrow b{width:40px;text-align:right;color:var(--fg);font-variant-numeric:tabular-nums}
.pill{display:inline-block;padding:.1rem .5rem;border-radius:99px;font-size:.72rem;
      font-weight:600;white-space:nowrap;border:1px solid transparent}
.pill.ok{background:var(--ok-soft);color:var(--ok)}
.pill.bad{background:var(--bad-soft);color:var(--bad)}
.pill.warn{background:var(--warn-soft);color:oklch(0.45 0.13 75)}
.pill.none{background:var(--surface);color:var(--mut);border-color:var(--line)}
.pill.kind{background:var(--info-soft);color:var(--info)}

/* ── detected breaking changes ─────────────────────────────── */
.det{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--warn);
     border-radius:var(--r-md);padding:1rem 1.15rem;margin-bottom:.85rem;
     box-shadow:0 1px 2px oklch(0 0 0 / 4%)}
.det.missed{border-left-color:var(--line);opacity:.72}
.det.confirmed{border-left-color:var(--ok)}
.det .dh{display:flex;gap:.5rem;align-items:baseline;flex-wrap:wrap;margin-bottom:.35rem}
.det .did{font-family:var(--mono);font-size:.78rem;color:var(--mut)}
.det .dsum{font-size:.95rem;font-weight:550;margin:.15rem 0 .5rem}
.det .hint{font-size:.83rem;color:var(--mut);margin-bottom:.6rem}
.ev{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-sm);
    padding:.7rem .85rem;margin-top:.6rem}
.ev .evh{font-size:.74rem;font-weight:600;color:var(--mut);text-transform:uppercase;
         letter-spacing:.05em;margin-bottom:.35rem}
.ev pre{margin:0;padding:.6rem .7rem;background:var(--card);border:1px solid var(--line);
        border-radius:var(--r-sm);font-size:.76rem;line-height:1.5;white-space:pre-wrap;
        word-break:break-word;max-height:16rem;overflow:auto}
.ev pre.err{color:var(--bad);background:var(--bad-soft);border-color:transparent}
/* Syntax highlighting — warm light scheme, tokenised at generation time. */
.ev pre.code{background:oklch(0.99 0.004 75);line-height:1.6;tab-size:2}
pre.code code{font-family:var(--mono)}
pre.code .c{color:oklch(0.62 0.02 285);font-style:italic}   /* comment  */
pre.code .s{color:oklch(0.48 0.13 150)}                      /* string   */
pre.code .n{color:oklch(0.52 0.15 40)}                       /* number   */
pre.code .k{color:oklch(0.5 0.2 300);font-weight:550}        /* keyword  */
pre.code .l{color:oklch(0.52 0.15 40);font-weight:550}       /* literal  */
pre.code .f{color:oklch(0.48 0.14 255)}                      /* function */
pre.code .b{color:oklch(0.5 0.12 215)}                       /* builtin  */
pre.code .p{color:oklch(0.35 0.03 285)}                      /* property */
pre.code .o{color:oklch(0.58 0.02 285)}                      /* operator */
.ev .fix{background:var(--info-soft);border-left:3px solid var(--info);padding:.5rem .7rem;
         border-radius:0 var(--r-sm) var(--r-sm) 0;font-size:.84rem}
.ev .loc{font-family:var(--mono);font-size:.74rem;color:var(--mut);margin-top:.3rem}
.ev+.ev{margin-top:.75rem}

.goal{background:var(--card);border:1px solid var(--line);border-radius:var(--r-md);margin-bottom:.55rem}
.goal summary{cursor:pointer;padding:.65rem .85rem;display:flex;gap:.65rem;align-items:baseline;flex-wrap:wrap}
.goal summary:hover{background:var(--surface);border-radius:var(--r-md)}
.goal summary::-webkit-details-marker{display:none}
.goal .gi{color:var(--mut);font-size:.78rem;font-variant-numeric:tabular-nums}
.goal .gt{flex:1;min-width:250px;font-size:.87rem}
.goal .gs{display:flex;gap:.35rem;align-items:center}
.goal .arrow{color:var(--mut)}
.goal .cnt{color:var(--mut);font-size:.77rem}
table.steps{margin:0}
table.steps .num{color:var(--mut);width:2.2rem;font-variant-numeric:tabular-nums}
table.steps .desc{font-size:.83rem;color:var(--mut)}
table.steps tr.regression{background:var(--bad-soft)}
.evrow pre{margin:.2rem 0 .5rem;padding:.55rem .7rem;background:var(--card);
           border:1px solid var(--line);border-radius:var(--r-sm);font-size:.75rem;
           white-space:pre-wrap;word-break:break-word;color:var(--bad)}
/* ── documentation diffs ─────────────────────────────────── */
.ev pre.diff{font-size:.75rem;line-height:1.55;max-height:34rem;overflow:auto;
             background:oklch(0.99 0.004 75);padding:.6rem .5rem}
pre.diff span{display:block;padding:0 .35rem;white-space:pre-wrap;word-break:break-word}
pre.diff .dadd{background:var(--ok-soft);color:oklch(0.4 0.14 152)}
pre.diff .ddel{background:var(--bad-soft);color:oklch(0.45 0.18 27)}
pre.diff .dhunk{color:var(--info);font-weight:600;margin-top:.3rem}
pre.diff .dfile{color:var(--mut);font-weight:600}
pre.diff .dctx{color:oklch(0.42 0.02 285)}
.ev pre.cur{background:var(--bad-soft);border-color:transparent;color:oklch(0.4 0.05 27)}
.ev pre.prop{background:var(--ok-soft);border-color:transparent;color:oklch(0.34 0.06 152)}
/* ── tabs (one target per view; page is far too long otherwise) ── */
.tabs{position:sticky;top:0;z-index:5;display:flex;gap:.3rem;flex-wrap:wrap;
      padding:.6rem 0;margin-bottom:1.5rem;background:var(--bg);
      border-bottom:1px solid var(--line)}
.tab{font:inherit;font-size:.82rem;font-weight:550;cursor:pointer;color:var(--mut);
     background:transparent;border:1px solid transparent;border-radius:99px;
     padding:.3rem .75rem;display:inline-flex;align-items:center;gap:.35rem}
.tab:hover{background:var(--surface);color:var(--fg)}
.tab.active{background:var(--accent-soft);color:var(--accent);border-color:var(--accent)}
.tbadge{background:var(--bad-soft);color:var(--bad);border-radius:99px;
        padding:0 .35rem;font-size:.7rem;font-weight:700}
/* Without JS every pane stays visible, so the report still reads top-to-bottom. */
.js .pane{display:none}
.js .pane.show{display:block}
/* Full source, with a line-number gutter. */
.codewrap{display:flex;gap:0;border:1px solid var(--line);border-radius:var(--r-sm);
          overflow:auto;background:oklch(0.99 0.004 75);max-height:34rem}
.codewrap pre{margin:0;border:none;border-radius:0;background:transparent}
.codewrap pre.ln{padding:.6rem .5rem .6rem .7rem;color:oklch(0.72 0.01 285);text-align:right;
                 font-family:var(--mono);font-size:.76rem;line-height:1.6;user-select:none;
                 border-right:1px solid var(--line);flex:none}
.codewrap pre.code{padding:.6rem .8rem;flex:1;max-height:none;overflow:visible}
footer{margin-top:3.5rem;color:var(--mut);font-size:.82rem;border-top:1px solid var(--line);padding-top:1.25rem}
</style></head><body>
<h1>Documentation-drift study — results</h1>
<p class="sub">Old-version docs → code frozen → re-executed against the new library version.
Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} · ${targets.length} targets</p>

<div class="cards">
  <div class="card"><div class="n">${pct(bPass, bTot)}% → <span class="${
        pct(ePass, eTot) < pct(bPass, bTot) ? "hot" : ""
    }">${pct(ePass, eTot)}%</span></div><div class="l">step pass rate</div></div>
  <div class="card"><div class="n hot">${regr}</div><div class="l">step regressions</div></div>
  <div class="card"><div class="n">${recC}/${recT}</div><div class="l">breaking changes <b>confirmed</b><br><span style="font-size:.72rem">(+${
        recD - recC
    } gap-only)</span></div></div>
  <div class="card"><div class="n">${
        targets.filter((t) => t.step.regressions.length > 0).length
    }/${targets.length}</div><div class="l">targets with drift</div></div>
  <div class="card"><div class="n">${impr}</div><div class="l">flaky flips (frozen code)</div></div>
</div>

<nav class="tabs" id="tabs">
  <button class="tab active" data-pane="overview">Overview</button>
  ${
        targets.map((t) =>
            `<button class="tab" data-pane="t-${esc(t.key)}">${esc(t.key)}${
                t.step.regressions.length > 0
                    ? `<span class="tbadge">${t.step.regressions.length}</span>`
                    : ""
            }</button>`
        ).join("")
    }
</nav>

<div class="pane" id="pane-overview">
<div class="scroll overview">
<table>
  <thead><tr><th>target</th><th>versions</th><th>goals</th><th>steps</th><th>step rate</th>
  <th>regr</th><th>confirmed</th><th>detected</th><th>used doc API</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
</div>
</div>

${targets.map(targetSection).join("")}

<footer>
  <b>Steps</b> are independent generated programs; the experiment re-runs the identical
  frozen program on the new version, so a step regression is attributable to the version
  change alone. <b>Goal</b> status is all-or-nothing and can hide drift when a goal is
  partially failing in both phases. <b>Flaky flips</b> are steps that improved despite
  frozen code — they quantify residual measurement noise. <b>Recall</b> counts a documented
  breaking change only when tied to a regression or a gap new in the experiment.
</footer>
<script>
// Progressive enhancement: panes are all visible until this runs, so the report
// still works with JS disabled (and when printed).
document.documentElement.classList.add('js');
const panes = [...document.querySelectorAll('.pane')];
const tabs = [...document.querySelectorAll('.tab')];
function show(id){
  panes.forEach(p => p.classList.toggle('show', p.id === 'pane-' + id));
  tabs.forEach(t => t.classList.toggle('active', t.dataset.pane === id));
  history.replaceState(null, '', id === 'overview' ? location.pathname : '#' + id);
}
tabs.forEach(t => t.addEventListener('click', () => { show(t.dataset.pane); scrollTo(0,0); }));
// Overview links jump straight to that target's tab.
document.querySelectorAll('.overview a[href^="#t-"]').forEach(a =>
  a.addEventListener('click', e => { e.preventDefault();
    show(a.getAttribute('href').slice(1)); scrollTo(0,0); }));
show(location.hash.startsWith('#t-') ? location.hash.slice(1) : 'overview');
</script>
</body></html>`;
}
