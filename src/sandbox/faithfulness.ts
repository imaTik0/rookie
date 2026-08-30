/**
 * Docs-faithfulness check.
 *
 * A capable agent can "dodge" a documentation gap or a version break by
 * substituting an equivalent-but-different API for the one the docs describe —
 * e.g. writing `execa()` instead of the (removed) `execaCommand()`. The old-doc
 * code then never exercises the drifted construct, so it doesn't break on the
 * new version and the drift is masked. This module flags that substitution as a
 * distinct outcome: an exit-0 run that never touched the documented API is NOT a
 * clean pass.
 *
 * Pure and dependency-free — unit-tested in faithfulness.test.ts.
 */

export interface FaithfulnessResult {
    /** False when there were no expected symbols to check (not applicable). */
    checked: boolean;
    /** True when the code references at least one expected documented symbol. */
    faithful: boolean;
    /** Expected symbols found in the code. */
    used: string[];
    /** Expected symbols absent from the code. */
    missing: string[];
}

/**
 * Strip line/block comments and string/template literals so a symbol is only
 * matched when it is actually used as code — not merely mentioned in a comment
 * or embedded in a string (e.g. a shell command that contains the library name).
 * A best-effort scrubber, not a full JS parser; it errs toward removing text.
 */
function stripCommentsAndStrings(code: string): string {
    let out = "";
    let i = 0;
    const n = code.length;
    while (i < n) {
        const ch = code[i];
        const next = code[i + 1];
        // line comment
        if (ch === "/" && next === "/") {
            i += 2;
            while (i < n && code[i] !== "\n") i++;
            continue;
        }
        // block comment
        if (ch === "/" && next === "*") {
            i += 2;
            while (i < n && !(code[i] === "*" && code[i + 1] === "/")) i++;
            i += 2;
            continue;
        }
        // string / template literal
        if (ch === '"' || ch === "'" || ch === "`") {
            const quote = ch;
            i++;
            while (i < n) {
                if (code[i] === "\\") {
                    i += 2;
                    continue;
                }
                if (code[i] === quote) {
                    i++;
                    break;
                }
                i++;
            }
            out += " "; // collapse the literal to a separator
            continue;
        }
        out += ch;
        i++;
    }
    return out;
}

/**
 * Does `code` reference the documented API symbols it was expected to use?
 *
 * A symbol counts as used when it appears at an identifier boundary in the code
 * (outside comments and string literals). `faithful` is true when at least one
 * expected symbol is used — using none is the dodge signal. With no expected
 * symbols the check is not applicable and `faithful` defaults to true.
 */
export function checkFaithfulness(code: string, expectedApis: string[]): FaithfulnessResult {
    const symbols = [...new Set(expectedApis.map((s) => s.trim()).filter((s) => s.length > 0))];
    if (symbols.length === 0) {
        return { checked: false, faithful: true, used: [], missing: [] };
    }
    const scrubbed = stripCommentsAndStrings(code);
    const used: string[] = [];
    const missing: string[] = [];
    for (const sym of symbols) {
        const esc = sym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        // Identifier boundary: not preceded/followed by another identifier char.
        // Allows member access (`.getKysely`) by not requiring a leading boundary
        // for dotted symbols, but still avoids matching substrings of longer names.
        const re = new RegExp(`(^|[^\\w$])${esc}(?![\\w$])`);
        if (re.test(scrubbed)) used.push(sym);
        else missing.push(sym);
    }
    return { checked: true, faithful: used.length > 0, used, missing };
}
