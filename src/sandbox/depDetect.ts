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

function packageNameOf(specifier: string): string | null {
    if (!specifier) return null;
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

export function parseImportedPackages(code: string): string[] {
    const found = new Set<string>();

    const patterns = [
        /import\s+[^;]*?from\s*["']([^"']+)["']/g,
        /import\s*["']([^"']+)["']/g,
        /import\s*\(\s*["']([^"']+)["']\s*\)/g,
        /require\s*\(\s*["']([^"']+)["']\s*\)/g,
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

export function applyPackageOverrides(
    parsed: string[],
    overrides?: Record<string, string>,
): string[] {
    if (!overrides || Object.keys(overrides).length === 0) return parsed;

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
    for (const name of Object.keys(exact)) out.set(name, spec(name));
    return [...out.values()];
}

const ENV_ERROR_SIGNATURES = [
    "ERR_MODULE_NOT_FOUND",
    "Cannot find module",
    "Cannot find package",
    "MODULE_NOT_FOUND",
    "ROOKIE_NPM_INSTALL_FAILED",
    "ROOKIE_NO_DEFAULT_EXPORT",
    "ROOKIE_UNGROUNDED_SUCCESS",
    "ROOKIE_SANDBOX_TIMEOUT",
    "Execution timed out",
    "npm ERR!",
    "ERR_DLOPEN_FAILED",
    "command not found",
    "Permission denied",
    "ENOSPC",
    "EACCES",
];

export function isEnvironmentError(error: string): boolean {
    const haystack = (error || "").toString();
    return ENV_ERROR_SIGNATURES.some((sig) => haystack.includes(sig));
}
