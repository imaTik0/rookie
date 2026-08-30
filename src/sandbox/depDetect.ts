/**
 * Static helpers for the execution sandbox:
 *  - parseImportedPackages: extract bare npm specifiers from generated code so
 *    they can be `npm install`-ed before execution (the sandbox previously had
 *    no install step, so any third-party import failed with MODULE_NOT_FOUND).
 *  - isEnvironmentError: recognise failures that are about the runtime/tooling
 *    rather than the documentation, so the classifier doesn't blame the docs.
 */

const NODE_BUILTINS = new Set([
    "assert",
    "buffer",
    "child_process",
    "cluster",
    "console",
    "crypto",
    "dgram",
    "dns",
    "events",
    "fs",
    "http",
    "http2",
    "https",
    "net",
    "os",
    "path",
    "perf_hooks",
    "process",
    "querystring",
    "readline",
    "stream",
    "string_decoder",
    "timers",
    "tls",
    "tty",
    "url",
    "util",
    "v8",
    "vm",
    "worker_threads",
    "zlib",
    "module",
    "async_hooks",
    "fs/promises",
    "stream/promises",
    "timers/promises",
    "dns/promises",
]);

/** Reduce a specifier like `@scope/pkg/sub` or `pkg/sub` to its installable name. */
function packageNameOf(specifier: string): string | null {
    if (!specifier) return null;
    // Relative / absolute / protocol imports are not npm packages.
    if (
        specifier.startsWith(".") || specifier.startsWith("/") ||
        specifier.startsWith("node:") || specifier.startsWith("file:") ||
        specifier.startsWith("http:") || specifier.startsWith("https:") ||
        specifier.startsWith("data:")
    ) {
        return null;
    }
    const parts = specifier.split("/");
    const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
    if (!name || NODE_BUILTINS.has(name) || NODE_BUILTINS.has(specifier)) return null;
    return name;
}

/** Extract installable package names from `import ... from '...'` and `require('...')`. */
export function parseImportedPackages(code: string): string[] {
    const found = new Set<string>();

    const patterns = [
        /import\s+[^;]*?from\s*["']([^"']+)["']/g, // import x from 'pkg'
        /import\s*["']([^"']+)["']/g, // import 'pkg'
        /import\s*\(\s*["']([^"']+)["']\s*\)/g, // dynamic import('pkg')
        /require\s*\(\s*["']([^"']+)["']\s*\)/g, // require('pkg')
    ];

    for (const re of patterns) {
        let m: RegExpExecArray | null;
        while ((m = re.exec(code)) !== null) {
            const name = packageNameOf(m[1]);
            if (name) found.add(name);
        }
    }
    return [...found];
}

/**
 * Merge npm install specifiers with an override map (name → version | "latest"):
 *  - a parsed package that has an override is pinned to `name@version`
 *    (a `"latest"` override is left bare — npm installs latest by default);
 *  - override entries not present in the parsed set are force-added, so an ORM's
 *    peer driver installs even if the generated code never imported it directly.
 *
 * Used by the documentation-drift experiment to install a specific
 * `<pkg>@<version>` per phase while keeping the rest of the imports intact.
 */
export function applyPackageOverrides(
    parsed: string[],
    overrides?: Record<string, string>,
): string[] {
    if (!overrides || Object.keys(overrides).length === 0) return parsed;

    // A key ending in `*` is a PREFIX rule: it pins every package in a family
    // without being installed itself. Monorepo-versioned families (MikroORM,
    // TypeORM plugins…) require all their packages at the SAME version — mixing
    // `@mikro-orm/core@6.6.16` with `@mikro-orm/postgresql@latest` makes npm
    // abort on ERESOLVE and install NOTHING, which surfaced as a misleading
    // "Cannot find package" at runtime. A prefix rule also covers packages the
    // generated code imports that no config could have predicted.
    const exact: Record<string, string> = {};
    const prefixes: Array<[string, string]> = [];
    for (const [key, version] of Object.entries(overrides)) {
        if (key.endsWith("*")) prefixes.push([key.slice(0, -1), version]);
        else exact[key] = version;
    }

    const versionFor = (name: string): string | undefined =>
        name in exact ? exact[name] : prefixes.find(([p]) => name.startsWith(p))?.[1];

    const spec = (name: string): string => {
        const v = versionFor(name);
        return v && v !== "latest" ? `${name}@${v}` : name;
    };

    const out = new Map<string, string>();
    for (const name of parsed) out.set(name, spec(name));
    // Force-install explicitly named overrides; prefix rules only pin.
    for (const name of Object.keys(exact)) out.set(name, spec(name));
    return [...out.values()];
}

const ENV_ERROR_SIGNATURES = [
    "ERR_MODULE_NOT_FOUND",
    "Cannot find module",
    "Cannot find package",
    "MODULE_NOT_FOUND",
    "ROOKIE_NPM_INSTALL_FAILED",
    // Agent/harness contract violations — the generated code misbehaved (no
    // default export, or an exit-0 run that never called the real API). These
    // are model failures, not documentation gaps: they fail the goal but must
    // not be attributed to the docs.
    "ROOKIE_NO_DEFAULT_EXPORT",
    "ROOKIE_UNGROUNDED_SUCCESS",
    // Sandbox ran out of wall-clock time. This is a property of the MACHINE
    // (slow registry, oversubscribed Docker VM, heavy parallelism) — never of the
    // documentation. Without this the LLM classifier happily labels it
    // MISSING/INCORRECT/AMBIGUOUS and it pollutes the gap taxonomy.
    "ROOKIE_SANDBOX_TIMEOUT",
    "Execution timed out",
    "npm ERR!",
    "ERR_DLOPEN_FAILED",
    "command not found",
    "Permission denied",
    "ENOSPC",
    "EACCES",
];

/** True when the failure looks like a tooling/environment issue, not a doc gap. */
export function isEnvironmentError(error: string): boolean {
    const haystack = (error || "").toString();
    return ENV_ERROR_SIGNATURES.some((sig) => haystack.includes(sig));
}
