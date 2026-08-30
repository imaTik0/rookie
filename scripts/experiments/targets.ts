/**
 * Experiment target configurations for the documentation-drift study.
 *
 * UNIT UNDER TEST = an npm library. DRIFT AXIS = the library VERSION: the
 * baseline installs `<pkg>@oldVersion` (matching the indexed OLD docs) and the
 * experiment re-runs the same goals with `<pkg>@newVersion`. Goals that pass on
 * the old version but fail on the new one mark documentation drift.
 *
 * The sample is the 2026 changelog-driven selection (see ./SELECTION.md): each
 * library's NEW version was released AFTER the model's Jan-2026 knowledge cutoff,
 * so its breaking changes cannot be memorised — the model MUST rely on the OLD
 * documentation, and code written from it genuinely breaks on the new version.
 * The documented breaking changes (curated per library in
 * `src/eval/changelogSeed.ts`, keyed by the SAME config name) both steer goal
 * generation and serve as the golden dataset for detection recall.
 *
 * Each target runs in one of three runtimes:
 *   • "pure" — the library needs no external service (CLI/parser/build tools).
 *              No container is started; the execution context is empty.
 *   • "http" — an HTTP client. A throwaway httpbin container provides an
 *              endpoint; `ctx.baseUrl` points the generated code at it.
 *   • "db"   — an ORM. A throwaway Postgres container provides the database;
 *              `ctx.connectionString` (and friends) point the code at it. The
 *              engine is a constant dependency, HELD FIXED across both phases —
 *              only the library version changes.
 *
 * Version pairs match `src/eval/changelogSeed.ts` exactly (they are consumed
 * together). `preflight.ts` re-checks the npm version pair, any container image
 * and docs ingestibility BEFORE an experiment run.
 */

// ─────────────────────────────────────────────────────────────────
//  Types (shared with experiment-runner.ts)
// ─────────────────────────────────────────────────────────────────
export interface ContainerConfig {
    name: string;
    port: number;
    hostPort: number;
    env: Record<string, string>;
    /** Optional command appended after the image. */
    cmd?: string[];
}

export interface HealthConfig {
    /** "http" — GET the URL until 2xx; "tcp" — open a socket to host:port. */
    mode: "http" | "tcp";
    /** For http: full URL. For tcp: "host:port" (both accept {hostPort}). */
    url: string;
    retries: number;
    intervalMs: number;
}

export interface DocsConfig {
    /** The OLD-version docs are fetched verbatim and uploaded as .md file(s):
     *  the README plus any in-repo docs at the OLD tag (the FULL version-pinned
     *  doc set). This is the only mode — every target uses version-pinned raw
     *  markdown so the docs are reproducible and match the installed old version. */
    mode: "raw-markdown";
    url: string;
    /** Additional in-repo doc files uploaded alongside `url`. */
    extraFiles?: string[];
    maxPages: number;
}

export interface PlannerConfig {
    maxGoals: number;
    initialContext: string;
}

/** The library under test — the sole independent variable (SELECTION.md §7). */
export interface LibraryConfig {
    /** npm package under test. */
    pkg: string;
    /** Version installed for the baseline (matches the indexed OLD docs). */
    oldVersion: string;
    /** Version installed for the experiment run (post-cutoff release). */
    newVersion: string;
    /** Peer packages the examples need (e.g. an ORM's DB driver), force-installed
     *  at `latest` in BOTH phases so only `pkg` version varies. */
    extraPackages?: string[];
    /**
     * Peers that must track `pkg`'s version instead of using `latest`. Required
     * for monorepo-versioned families (MikroORM, …) where mixing versions makes
     * npm abort on ERESOLVE and install nothing. An entry ending in `*` is a
     * prefix rule that pins the whole family without installing itself — it also
     * catches family packages the generated code imports unpredictably.
     */
    versionedExtras?: string[];
}

/** How the target's generated code is exercised (see file header). */
export type Runtime = "pure" | "http" | "db";

export interface ExperimentConfig {
    name: string;
    /** The library under test (the drift axis is its version). */
    library: LibraryConfig;
    /** Execution runtime — decides whether a container is started. */
    runtime: Runtime;
    docs: DocsConfig;
    planner: PlannerConfig;
    /** Container backing the runtime (httpbin/Postgres). Absent for "pure". */
    container?: ContainerConfig;
    health?: HealthConfig;
    /** Container image, held constant across both phases. Absent for "pure". */
    image?: string;
    /** Development pilot — excluded from the evaluation sample (SELECTION.md §2). */
    pilot?: boolean;
    /** Set when excluded after a technical preflight failure (SELECTION.md §11). */
    excluded?: string;
    /** Rank in the selection walk (SELECTION.md §5/§6), for reporting. */
    selectionRank?: number;
}

// ─────────────────────────────────────────────────────────────────
//  Runtime backends (containers + execution context)
// ─────────────────────────────────────────────────────────────────

/** Throwaway credentials — ephemeral experiment containers only. */
const CRED = { password: "RookieAdmin123!", database: "rookie" };

/** From inside the sandbox the host-published container port is reachable here. */
const DH = "host.docker.internal";

/** Fixed images + host ports (runs are sequential, so one port each). */
const PG = { image: "postgres:16", port: 5432, hostPort: 15432 };
const HTTPBIN = { image: "mccutchen/go-httpbin:latest", port: 8080, hostPort: 18080 };

const tcpHealth = (): HealthConfig => ({
    mode: "tcp",
    url: "localhost:{hostPort}",
    retries: 40,
    intervalMs: 3000,
});

// ─────────────────────────────────────────────────────────────────
//  Docs helpers (version-pinned raw markdown)
// ─────────────────────────────────────────────────────────────────
const RAW = (url: string): DocsConfig => ({ mode: "raw-markdown", url, maxPages: 1 });

/** Multi-file raw markdown: primary doc + additional in-repo docs at the OLD tag. */
const RAWX = (url: string, extraFiles: string[]): DocsConfig => ({
    mode: "raw-markdown",
    url,
    extraFiles,
    maxPages: 1 + extraFiles.length,
});

/** Base for a repo's raw files at a fixed ref (keeps multi-file lists readable). */
const GH = (repo: string, ref: string) => (path: string) =>
    `https://raw.githubusercontent.com/${repo}/${ref}/${path}`;

// ─────────────────────────────────────────────────────────────────
//  Target builders (one per runtime)
// ─────────────────────────────────────────────────────────────────
interface TargetBase {
    name: string;
    selectionRank: number;
    library: LibraryConfig;
    docs: DocsConfig;
    maxGoals?: number;
    pilot?: boolean;
}

/** Pure library — no container, empty execution context. */
function pureTarget(cfg: TargetBase): ExperimentConfig {
    return {
        name: cfg.name,
        selectionRank: cfg.selectionRank,
        pilot: cfg.pilot,
        library: cfg.library,
        runtime: "pure",
        docs: cfg.docs,
        planner: { maxGoals: cfg.maxGoals ?? 8, initialContext: "{}" },
    };
}

/** HTTP client — a throwaway httpbin endpoint (ctx.baseUrl points code at it). */
function httpTarget(cfg: TargetBase): ExperimentConfig {
    return {
        name: cfg.name,
        selectionRank: cfg.selectionRank,
        pilot: cfg.pilot,
        library: cfg.library,
        runtime: "http",
        image: HTTPBIN.image,
        // Unique name + host port per target so multiple targets can run
        // CONCURRENTLY without container-name / port-bind collisions.
        container: {
            name: `rookie-exp-http-r${cfg.selectionRank}`,
            port: HTTPBIN.port,
            hostPort: HTTPBIN.hostPort + cfg.selectionRank,
            env: {},
        },
        health: tcpHealth(),
        docs: cfg.docs,
        planner: {
            maxGoals: cfg.maxGoals ?? 8,
            initialContext: JSON.stringify({
                baseUrl: `http://${DH}:{hostPort}`,
                note:
                    "An httpbin-compatible server (GET/POST /get,/post,/status/{code},/redirect/{n},/anything).",
            }),
        },
    };
}

/** ORM — a throwaway Postgres database (ctx.connectionString points code at it). */
function dbTarget(cfg: TargetBase): ExperimentConfig {
    return {
        name: cfg.name,
        selectionRank: cfg.selectionRank,
        pilot: cfg.pilot,
        library: cfg.library,
        runtime: "db",
        image: PG.image,
        // Unique name + host port per target so multiple targets can run
        // CONCURRENTLY without container-name / port-bind collisions.
        container: {
            name: `rookie-exp-db-r${cfg.selectionRank}`,
            port: PG.port,
            hostPort: PG.hostPort + cfg.selectionRank,
            env: { POSTGRES_PASSWORD: CRED.password, POSTGRES_DB: CRED.database },
        },
        health: tcpHealth(),
        docs: cfg.docs,
        planner: {
            maxGoals: cfg.maxGoals ?? 8,
            initialContext: JSON.stringify({
                connectionString:
                    `postgres://postgres:${CRED.password}@${DH}:{hostPort}/${CRED.database}`,
                host: DH,
                port: "{hostPort}",
                user: "postgres",
                password: CRED.password,
                database: CRED.database,
            }),
        },
    };
}

// ─────────────────────────────────────────────────────────────────
//  Targets — 2026 changelog-driven evaluation sample (n = 10)
//  (versions MUST match src/eval/changelogSeed.ts)
// ─────────────────────────────────────────────────────────────────
export const EXPERIMENTS: Record<string, ExperimentConfig> = {
    // ── pure libraries (no container) ────────────────────────────
    commander: pureTarget({
        name: "Commander.js",
        selectionRank: 1,
        library: { pkg: "commander", oldVersion: "14.0.3", newVersion: "15.0.0" },
        docs: RAW("https://raw.githubusercontent.com/tj/commander.js/v14.0.3/Readme.md"),
    }),

    execa: pureTarget({
        name: "execa",
        selectionRank: 2,
        library: { pkg: "execa", oldVersion: "9.6.1", newVersion: "10.0.0" },
        docs: (() => {
            const gh = GH("sindresorhus/execa", "v9.6.1");
            return RAWX(gh("readme.md"), [
                gh("docs/execution.md"),
                gh("docs/scripts.md"),
                gh("docs/api.md"),
                gh("docs/ipc.md"),
            ]);
        })(),
    }),

    eslint: pureTarget({
        name: "ESLint",
        selectionRank: 5,
        library: { pkg: "eslint", oldVersion: "9.39.5", newVersion: "10.8.0" },
        docs: (() => {
            const gh = GH("eslint/eslint", "v9.39.5");
            return RAWX(gh("docs/src/extend/custom-rules.md"), [
                gh("docs/src/integrate/nodejs-api.md"),
                gh("docs/src/use/configure/configuration-files.md"),
            ]);
        })(),
    }),

    vite: pureTarget({
        name: "Vite",
        selectionRank: 6,
        library: { pkg: "vite", oldVersion: "7.3.6", newVersion: "8.1.5" },
        docs: (() => {
            const gh = GH("vitejs/vite", "v7.3.6");
            return RAWX(gh("docs/guide/api-javascript.md"), [
                gh("docs/config/shared-options.md"),
                gh("docs/config/build-options.md"),
            ]);
        })(),
    }),

    marked: pureTarget({
        name: "marked",
        selectionRank: 10,
        library: { pkg: "marked", oldVersion: "17.0.6", newVersion: "18.0.7" },
        docs: (() => {
            const gh = GH("markedjs/marked", "v17.0.6");
            return RAWX(gh("docs/USING_ADVANCED.md"), [gh("docs/USING_PRO.md")]);
        })(),
    }),

    // ── HTTP clients (throwaway httpbin endpoint) ────────────────
    got: httpTarget({
        name: "got",
        selectionRank: 3,
        library: { pkg: "got", oldVersion: "14.6.6", newVersion: "15.1.0" },
        docs: (() => {
            const gh = GH("sindresorhus/got", "v14.6.6");
            return RAWX(gh("readme.md"), [
                gh("documentation/1-promise.md"),
                gh("documentation/2-options.md"),
                gh("documentation/3-streams.md"),
                gh("documentation/8-errors.md"),
            ]);
        })(),
    }),

    ky: httpTarget({
        name: "ky",
        selectionRank: 4,
        library: { pkg: "ky", oldVersion: "1.14.3", newVersion: "2.0.2" },
        docs: RAW("https://raw.githubusercontent.com/sindresorhus/ky/v1.14.3/readme.md"),
    }),

    undici: httpTarget({
        name: "undici",
        selectionRank: 9,
        library: { pkg: "undici", oldVersion: "7.29.0", newVersion: "8.9.0" },
        docs: (() => {
            const gh = GH("nodejs/undici", "v7.29.0");
            return RAWX(gh("README.md"), [
                gh("docs/docs/api/Dispatcher.md"),
                gh("docs/docs/api/Client.md"),
            ]);
        })(),
    }),

    // ── ORMs (throwaway Postgres) ────────────────────────────────
    typeorm: dbTarget({
        name: "TypeORM",
        selectionRank: 7,
        library: {
            pkg: "typeorm",
            oldVersion: "0.3.31",
            newVersion: "1.1.0",
            extraPackages: ["pg", "reflect-metadata"],
        },
        docs: (() => {
            const gh = GH("typeorm/typeorm", "0.3.31");
            const doc = (f: string) => gh(`docs/docs/${f}.md`);
            return RAWX(doc("getting-started"), [
                doc("data-source/1-data-source"),
                doc("data-source/4-data-source-api"),
                doc("entity/1-entities"),
                doc("query-builder/1-select-query-builder"),
            ]);
        })(),
    }),

    mikroorm: dbTarget({
        name: "MikroORM",
        selectionRank: 8,
        library: {
            pkg: "@mikro-orm/core",
            oldVersion: "6.6.16",
            newVersion: "7.1.7",
            extraPackages: ["reflect-metadata"],
            // MikroORM versions its packages as one family: the driver MUST match
            // core, and the trailing `@mikro-orm/*` rule pins any other family
            // package the generated code imports (e.g. the docs' sqlite driver).
            versionedExtras: ["@mikro-orm/postgresql", "@mikro-orm/*"],
        },
        docs: (() => {
            const gh = GH("mikro-orm/mikro-orm", "v6.6.16");
            const doc = (f: string) => gh(`docs/docs/${f}.md`);
            return RAWX(doc("quick-start"), [
                doc("defining-entities"),
                doc("entity-manager"),
                doc("query-builder"),
            ]);
        })(),
    }),
};
