export interface FaithfulnessResult {
    checked: boolean;
    faithful: boolean;
    used: string[];
    missing: string[];
}

function stripCommentsAndStrings(code: string): string {
    let out = "";
    let i = 0;
    const n = code.length;
    while (i < n) {
        const ch = code[i];
        const next = code[i + 1];
        if (ch === "/" && next === "/") {
            i += 2;
            while (i < n && code[i] !== "\n") i++;
            continue;
        }
        if (ch === "/" && next === "*") {
            i += 2;
            while (i < n && !(code[i] === "*" && code[i + 1] === "/")) i++;
            i += 2;
            continue;
        }
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
            out += " ";
            continue;
        }
        out += ch;
        i++;
    }
    return out;
}

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
        const re = new RegExp(`(^|[^\\w$])${esc}(?![\\w$])`);
        if (re.test(scrubbed)) used.push(sym);
        else missing.push(sym);
    }
    return { checked: true, faithful: used.length > 0, used, missing };
}
