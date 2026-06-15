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

const ENV_ERROR_SIGNATURES = [
    "ERR_MODULE_NOT_FOUND",
    "Cannot find module",
    "Cannot find package",
    "MODULE_NOT_FOUND",
    "ROOKIE_NPM_INSTALL_FAILED",
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
