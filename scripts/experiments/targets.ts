/**
 * Experiment target configurations for the documentation-drift study.
 *
 * The 20-target sample and its ordering come from the pre-registered selection
 * protocol in ./SELECTION.md (awesome-selfhosted @ 334eaa0, descending-stars
 * screening, criteria E1–E8, ≤2 per category). Do not add/remove/replace
 * targets except via the protocol's replacement rule — log any change in
 * SELECTION.md §8. Reserve targets (R1–R5) are configured on demand only.
 *
 * Image tag pairs are adjacent stable versions chosen at protocol time; the
 * preflight script (`preflight.ts`) verifies tags, health, docs ingestibility
 * and credential provisioning BEFORE any experiment run.
 *
 * Docs-fidelity strategies (per target, annotated below):
 *  - "versioned-site":   docs URL pinned to the OLD version's docs tree
 *  - "tagged-repo":      docs file rendered from the repo at the OLD tag
 *  - "self-served":      OpenAPI JSON served by the running OLD container
 *  - "adjacent-current": unversioned site; mitigated by adjacent version pair
 */

// ─────────────────────────────────────────────────────────────────
//  Types (shared with experiment-runner.ts)
// ─────────────────────────────────────────────────────────────────
export interface ContainerConfig {
    name: string;
    port: number;
    hostPort: number;
    env: Record<string, string>;
    /** Optional command appended after the image (e.g. ["standalone"]). */
    cmd?: string[];
}

export interface HealthConfig {
    url: string;
    retries: number;
    intervalMs: number;
}

export interface DocsConfig {
    /** 'swagger-json' — fetch OpenAPI JSON, convert to Markdown, upload as file
     *  'url-crawl'    — pass URL directly to Rookie's built-in HTML crawler */
    mode: "swagger-json" | "url-crawl";
    url: string;
    maxPages: number;
}

export interface PlannerConfig {
    maxGoals: number;
    initialContext: string;
}

export interface ExperimentConfig {
    name: string;
    oldImage: string;
    newImage: string;
    container: ContainerConfig;
    health: HealthConfig;
    docs: DocsConfig;
    planner: PlannerConfig;
    /** Called once after the container is healthy. Returns extra template vars
     *  (e.g. `{ apiToken: "abc" }`) merged into the fill() context so
     *  placeholders like `{apiToken}` in initialContext are resolved. */
    setup?: (containerName: string) => Promise<Record<string, string>>;
    /** Development pilot — excluded from the evaluation sample (SELECTION.md §2). */
    pilot?: boolean;
    /** Rank in the selection walk (SELECTION.md §5), for reporting. */
    selectionRank?: number;
}

// ─────────────────────────────────────────────────────────────────
//  Setup-hook helpers
// ─────────────────────────────────────────────────────────────────
const HOST = "http://localhost";

async function dockerExec(containerName: string, args: string[]): Promise<string> {
    const { stdout, code, stderr } = await new Deno.Command("docker", {
        args: ["exec", containerName, ...args],
        stdout: "piped",
        stderr: "piped",
    }).output();
    if (code !== 0) {
        throw new Error(`docker exec failed: ${new TextDecoder().decode(stderr).trim()}`);
    }
    return new TextDecoder().decode(stdout).trim();
}

async function httpJson(
    method: string,
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown> | null; text: string }> {
    const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    let json: Record<string, unknown> | null = null;
    try {
        json = JSON.parse(text);
    } catch { /* non-JSON response */ }
    return { status: res.status, json, text };
}

function expectOk(step: string, status: number): void {
    if (status >= 400) throw new Error(`${step} failed with HTTP ${status}`);
}

// Shared, non-secret experiment credentials (throwaway containers only).
const CRED = {
    user: "rookie_admin",
    email: "rookie@example.com",
    password: "RookieAdmin123!",
};

// ─────────────────────────────────────────────────────────────────
//  Pilot setup hooks
// ─────────────────────────────────────────────────────────────────
async function setupGiteaAdmin(containerName: string): Promise<Record<string, string>> {
    console.log("  ▸ creating Gitea admin user…");
    // Gitea refuses to run as root — must exec as the "git" user.
    // Idempotent: silently ignore "user already exists" on re-runs.
    await new Deno.Command("docker", {
        args: [
            "exec",
            "--user",
            "git",
            containerName,
            "gitea",
            "admin",
            "user",
            "create",
            "--username",
            "gitea_admin",
            "--password",
            "gitea_admin123!",
            "--email",
            "admin@gitea.local",
            "--admin",
            "--must-change-password=false",
        ],
        stdout: "null",
        stderr: "null",
    }).output().catch(() => {});

    console.log("  ▸ generating API token…");
    // dockerExec cannot pass --user (it must precede the container name):
    const { stdout, code, stderr } = await new Deno.Command("docker", {
        args: [
            "exec",
            "--user",
            "git",
            containerName,
            "gitea",
            "admin",
            "user",
            "generate-access-token",
            "--username",
            "gitea_admin",
            "--token-name",
            "experiment",
            "--raw",
        ],
        stdout: "piped",
        stderr: "piped",
    }).output();
    if (code !== 0) {
        throw new Error(
            `Gitea token generation failed: ${new TextDecoder().decode(stderr).trim()}`,
        );
    }
    const raw = new TextDecoder().decode(stdout).trim();
    console.log(`  ✓ token: ${raw.slice(0, 8)}…`);
    return { apiToken: raw };
}

// InfluxDB's 'setup' mode pins the admin token via env (no hook needed).
const INFLUX_ADMIN_TOKEN = "rookie-influx-admin-token";

// ─────────────────────────────────────────────────────────────────
//  Sample setup hooks (targets that need one)
// ─────────────────────────────────────────────────────────────────

/** Open WebUI: first signup becomes admin; returns a bearer token. */
async function setupOpenWebui(port: number): Promise<Record<string, string>> {
    const r = await httpJson("POST", `${HOST}:${port}/api/v1/auths/signup`, {
        name: CRED.user,
        email: CRED.email,
        password: CRED.password,
    });
    expectOk("Open WebUI signup", r.status);
    const token = (r.json?.token as string) ?? "";
    if (!token) throw new Error("Open WebUI signup returned no token");
    return { apiToken: token };
}

/** Home Assistant: scripted onboarding -> OAuth token (best effort). */
async function setupHomeAssistant(port: number): Promise<Record<string, string>> {
    const clientId = `${HOST}:${port}/`;
    const u = await httpJson("POST", `${HOST}:${port}/api/onboarding/users`, {
        client_id: clientId,
        name: CRED.user,
        username: CRED.user,
        password: CRED.password,
        language: "en",
    });
    expectOk("HA onboarding user", u.status);
    const authCode = u.json?.auth_code as string;
    const form = new URLSearchParams({
        grant_type: "authorization_code",
        code: authCode,
        client_id: clientId,
    });
    const res = await fetch(`${HOST}:${port}/auth/token`, { method: "POST", body: form });
    expectOk("HA token exchange", res.status);
    const tok = await res.json();
    // Finish onboarding steps so the API leaves setup mode.
    const bearer = { Authorization: `Bearer ${tok.access_token}` };
    for (const step of ["core_config", "analytics", "integration"]) {
        await httpJson(
            "POST",
            `${HOST}:${port}/api/onboarding/${step}`,
            { client_id: clientId },
            bearer,
        )
            .catch(() => {});
    }
    return { apiToken: tok.access_token as string };
}

/** Syncthing: read the generated API key from config.xml inside the container. */
async function setupSyncthing(containerName: string): Promise<Record<string, string>> {
    const xml = await dockerExec(containerName, [
        "cat",
        "/var/syncthing/config/config.xml",
    ]);
    const m = xml.match(/<apikey>([^<]+)<\/apikey>/);
    if (!m) throw new Error("Syncthing API key not found in config.xml");
    return { apiKey: m[1] };
}

/** Memos: first signup becomes HOST (admin). Credentials flow is documented.
 *  NB (verified on 0.22.5): the gRPC-gateway route reads QUERY params, not the
 *  JSON body, and usernames must be lowercase alphanumeric (no underscores). */
const MEMOS_USER = "rookieadmin";
async function setupMemos(port: number): Promise<Record<string, string>> {
    const qs = new URLSearchParams({ username: MEMOS_USER, password: CRED.password });
    const r = await httpJson("POST", `${HOST}:${port}/api/v1/auth/signup?${qs}`);
    expectOk("Memos signup", r.status);
    const role = r.json?.role as string;
    if (role !== "HOST") throw new Error(`Memos signup did not yield HOST role (got ${role})`);
    return {};
}

/** Ghost: run the owner setup wizard; session auth with these creds is documented. */
async function setupGhost(port: number): Promise<Record<string, string>> {
    const r = await httpJson("POST", `${HOST}:${port}/ghost/api/admin/authentication/setup/`, {
        setup: [{
            name: CRED.user,
            email: CRED.email,
            password: CRED.password,
            blogTitle: "Rookie Experiment",
        }],
    });
    expectOk("Ghost setup", r.status);
    return {};
}

/** Jellyfin: complete the startup wizard; AuthenticateByName is documented. */
async function setupJellyfin(port: number): Promise<Record<string, string>> {
    const base = `${HOST}:${port}`;
    await httpJson("POST", `${base}/Startup/Configuration`, {
        UICulture: "en-US",
        MetadataCountryCode: "US",
        PreferredMetadataLanguage: "en",
    });
    await httpJson("GET", `${base}/Startup/User`);
    const u = await httpJson("POST", `${base}/Startup/User`, {
        Name: CRED.user,
        Password: CRED.password,
    });
    expectOk("Jellyfin startup user", u.status);
    const done = await httpJson("POST", `${base}/Startup/Complete`, {});
    expectOk("Jellyfin startup complete", done.status);
    return {};
}

/** Metabase: initial setup via setup-token; POST /api/session is documented. */
async function setupMetabase(port: number): Promise<Record<string, string>> {
    const props = await httpJson("GET", `${HOST}:${port}/api/session/properties`);
    const token = props.json?.["setup-token"] as string;
    if (!token) throw new Error("Metabase setup-token unavailable");
    const r = await httpJson("POST", `${HOST}:${port}/api/setup`, {
        token,
        user: {
            email: CRED.email,
            password: CRED.password,
            first_name: "Rookie",
            last_name: "Admin",
        },
        prefs: { site_name: "Rookie Experiment", allow_tracking: false },
    });
    expectOk("Metabase setup", r.status);
    return {};
}

/** Airflow standalone: admin password is written to a file inside the container. */
async function setupAirflow(containerName: string): Promise<Record<string, string>> {
    const pass = await dockerExec(containerName, [
        "cat",
        "/opt/airflow/standalone_admin_password.txt",
    ]);
    return { adminPassword: pass };
}

/** Halo: initialize the system; console API auth with these creds afterwards. */
async function setupHalo(port: number): Promise<Record<string, string>> {
    const r = await httpJson(
        "POST",
        `${HOST}:${port}/apis/api.console.halo.run/v1alpha1/system/initialize`,
        {
            siteTitle: "Rookie Experiment",
            username: CRED.user,
            password: CRED.password,
            email: CRED.email,
        },
    );
    expectOk("Halo initialize", r.status);
    return {};
}

/** TriliumNext: create a new document and set the password (ETAPI flag: best effort). */
async function setupTrilium(port: number): Promise<Record<string, string>> {
    const r = await httpJson("POST", `${HOST}:${port}/api/setup/new-document`, {});
    expectOk("Trilium new-document", r.status);
    const p = await httpJson("POST", `${HOST}:${port}/api/setup/password`, {
        password: CRED.password,
    });
    if (p.status >= 400) {
        throw new Error(
            `Trilium password setup failed (HTTP ${p.status}) — E6 flag from SELECTION.md; ` +
                `if unresolvable in preflight, apply replacement rule (R1).`,
        );
    }
    const login = await httpJson("POST", `${HOST}:${port}/etapi/auth/login`, {
        password: CRED.password,
    });
    expectOk("Trilium ETAPI login", login.status);
    return { apiToken: (login.json?.authToken as string) ?? "" };
}

// ─────────────────────────────────────────────────────────────────
//  EXPERIMENT CONFIGS
//  Pilots first, then the 20-target sample in selection-rank order.
// ─────────────────────────────────────────────────────────────────
export const EXPERIMENTS: Record<string, ExperimentConfig> = {
    // ── pilots (excluded from the evaluation sample) ────────────────
    gitea: {
        name: "Gitea",
        pilot: true,
        oldImage: "gitea/gitea:1.22.6",
        newImage: "gitea/gitea:1.23.8",
        container: {
            name: "rookie-exp-target",
            port: 3000,
            hostPort: 14000,
            env: {
                GITEA__security__INSTALL_LOCK: "true",
                GITEA__server__HTTP_PORT: "3000",
                GITEA__database__DB_TYPE: "sqlite3",
                GITEA__log__LEVEL: "Warn",
            },
        },
        health: { url: "http://localhost:{hostPort}/api/healthz", retries: 20, intervalMs: 3000 },
        // Versioned-site fidelity: docs.gitea.com hosts per-minor API docs.
        docs: { mode: "url-crawl", url: "https://docs.gitea.com/api/{docsVersion}/", maxPages: 1 },
        planner: {
            maxGoals: 10,
            initialContext: JSON.stringify({
                baseUrl: "http://host.docker.internal:{hostPort}",
                apiBase: "http://host.docker.internal:{hostPort}/api/v1",
                username: "gitea_admin",
                password: "gitea_admin123!",
                token: "{apiToken}",
            }),
        },
        setup: (c) => setupGiteaAdmin(c),
    },

    influxdb: {
        name: "InfluxDB",
        pilot: true,
        oldImage: "influxdb:2.6",
        newImage: "influxdb:2.7",
        container: {
            name: "rookie-exp-target",
            port: 8086,
            hostPort: 14002,
            env: {
                DOCKER_INFLUXDB_INIT_MODE: "setup",
                DOCKER_INFLUXDB_INIT_USERNAME: "rookie_admin",
                DOCKER_INFLUXDB_INIT_PASSWORD: "rookie_admin123!",
                DOCKER_INFLUXDB_INIT_ORG: "rookie",
                DOCKER_INFLUXDB_INIT_BUCKET: "demo",
                DOCKER_INFLUXDB_INIT_ADMIN_TOKEN: INFLUX_ADMIN_TOKEN,
                DOCKER_INFLUXDB_INIT_RETENTION: "0",
            },
        },
        health: { url: "http://localhost:{hostPort}/health", retries: 25, intervalMs: 3000 },
        // Crawl confined to the v2 subtree (crawler path-prefix scoping).
        docs: { mode: "url-crawl", url: "https://docs.influxdata.com/influxdb/v2/", maxPages: 30 },
        planner: {
            maxGoals: 8,
            initialContext: JSON.stringify({
                baseUrl: "http://host.docker.internal:{hostPort}",
                apiBase: "http://host.docker.internal:{hostPort}/api/v2",
                org: "rookie",
                bucket: "demo",
                token: INFLUX_ADMIN_TOKEN,
            }),
        },
    },

    // ── sample S1–S20 (SELECTION.md §5) ─────────────────────────────

    ollama: {
        name: "Ollama",
        selectionRank: 1,
        oldImage: "ollama/ollama:0.3.14",
        newImage: "ollama/ollama:0.5.7",
        container: { name: "rookie-exp-target", port: 11434, hostPort: 14101, env: {} },
        health: { url: "http://localhost:{hostPort}/", retries: 20, intervalMs: 3000 },
        // Tagged-repo fidelity: API reference rendered from the repo at the OLD tag.
        docs: {
            mode: "url-crawl",
            url: "https://github.com/ollama/ollama/blob/v{oldTag}/docs/api.md",
            maxPages: 1,
        },
        planner: {
            maxGoals: 8,
            initialContext: JSON.stringify({
                apiBase: "http://host.docker.internal:{hostPort}",
            }),
        },
    },

    openwebui: {
        name: "Open WebUI",
        selectionRank: 2,
        oldImage: "ghcr.io/open-webui/open-webui:v0.5.20",
        newImage: "ghcr.io/open-webui/open-webui:v0.6.5",
        container: { name: "rookie-exp-target", port: 8080, hostPort: 14102, env: {} },
        health: { url: "http://localhost:{hostPort}/health", retries: 30, intervalMs: 3000 },
        // Adjacent-current fidelity: docs site unversioned.
        docs: {
            mode: "url-crawl",
            url: "https://docs.openwebui.com/getting-started/api-endpoints",
            maxPages: 3,
        },
        planner: {
            maxGoals: 8,
            initialContext: JSON.stringify({
                apiBase: "http://host.docker.internal:{hostPort}",
                token: "{apiToken}",
            }),
        },
        setup: () => setupOpenWebui(14102),
    },

    homeassistant: {
        name: "Home Assistant",
        selectionRank: 4,
        oldImage: "ghcr.io/home-assistant/home-assistant:2024.6",
        newImage: "ghcr.io/home-assistant/home-assistant:2024.12",
        container: { name: "rookie-exp-target", port: 8123, hostPort: 14103, env: {} },
        health: { url: "http://localhost:{hostPort}/", retries: 40, intervalMs: 3000 },
        // Adjacent-current fidelity: developer docs unversioned (REST API stable).
        docs: {
            mode: "url-crawl",
            url: "https://developers.home-assistant.io/docs/api/rest/",
            maxPages: 2,
        },
        planner: {
            maxGoals: 8,
            initialContext: JSON.stringify({
                apiBase: "http://host.docker.internal:{hostPort}/api",
                token: "{apiToken}",
            }),
        },
        setup: () => setupHomeAssistant(14103),
    },

    stirlingpdf: {
        name: "Stirling-PDF",
        selectionRank: 5,
        oldImage: "stirlingtools/stirling-pdf:0.35.1",
        newImage: "stirlingtools/stirling-pdf:0.45.0",
        container: { name: "rookie-exp-target", port: 8080, hostPort: 14104, env: {} },
        health: { url: "http://localhost:{hostPort}/", retries: 20, intervalMs: 3000 },
        // Self-served fidelity: OpenAPI from the running OLD container.
        docs: {
            mode: "swagger-json",
            url: "http://localhost:{hostPort}/v3/api-docs",
            maxPages: 1,
        },
        planner: {
            maxGoals: 8,
            initialContext: JSON.stringify({
                apiBase: "http://host.docker.internal:{hostPort}",
            }),
        },
    },

    syncthing: {
        name: "Syncthing",
        selectionRank: 6,
        oldImage: "syncthing/syncthing:1.27.12",
        newImage: "syncthing/syncthing:1.29.2",
        container: { name: "rookie-exp-target", port: 8384, hostPort: 14105, env: {} },
        health: {
            url: "http://localhost:{hostPort}/rest/noauth/health",
            retries: 20,
            intervalMs: 3000,
        },
        // Adjacent-current fidelity: REST docs unversioned (API very stable).
        docs: { mode: "url-crawl", url: "https://docs.syncthing.net/rest/", maxPages: 40 },
        planner: {
            maxGoals: 8,
            initialContext: JSON.stringify({
                apiBase: "http://host.docker.internal:{hostPort}/rest",
                apiKey: "{apiKey}",
            }),
        },
        setup: (c) => setupSyncthing(c),
    },

    caddy: {
        name: "Caddy",
        selectionRank: 9,
        oldImage: "caddy:2.7.6",
        newImage: "caddy:2.8.4",
        container: {
            name: "rookie-exp-target",
            port: 2019,
            hostPort: 14106,
            env: {},
            cmd: [
                "sh",
                "-c",
                "printf '{\\n\\tadmin 0.0.0.0:2019\\n}\\n' > /tmp/Caddyfile && " +
                "caddy run --config /tmp/Caddyfile --adapter caddyfile",
            ],
        },
        health: { url: "http://localhost:{hostPort}/config/", retries: 20, intervalMs: 2000 },
        // Adjacent-current fidelity: admin API docs unversioned.
        docs: { mode: "url-crawl", url: "https://caddyserver.com/docs/api", maxPages: 4 },
        planner: {
            maxGoals: 8,
            initialContext: JSON.stringify({
                apiBase: "http://host.docker.internal:{hostPort}",
            }),
        },
    },

    traefik: {
        name: "Traefik",
        selectionRank: 15,
        oldImage: "traefik:v2.11",
        newImage: "traefik:v3.1",
        container: {
            name: "rookie-exp-target",
            port: 8080,
            hostPort: 14107,
            env: {},
            cmd: ["--api.insecure=true", "--ping=true"],
        },
        health: { url: "http://localhost:{hostPort}/ping", retries: 15, intervalMs: 2000 },
        // Versioned-site fidelity: docs tree pinned to v2.11 (the OLD version).
        docs: { mode: "url-crawl", url: "https://doc.traefik.io/traefik/v2.11/", maxPages: 40 },
        planner: {
            maxGoals: 8,
            initialContext: JSON.stringify({
                apiBase: "http://host.docker.internal:{hostPort}/api",
            }),
        },
    },

    memos: {
        name: "Memos",
        selectionRank: 18,
        oldImage: "neosmemo/memos:0.22.5",
        newImage: "neosmemo/memos:0.24.0",
        container: { name: "rookie-exp-target", port: 5230, hostPort: 14108, env: {} },
        health: { url: "http://localhost:{hostPort}/", retries: 20, intervalMs: 2000 },
        // Adjacent-current fidelity: docs site unversioned.
        docs: { mode: "url-crawl", url: "https://www.usememos.com/docs", maxPages: 25 },
        planner: {
            maxGoals: 8,
            initialContext: JSON.stringify({
                apiBase: "http://host.docker.internal:{hostPort}/api/v1",
                username: MEMOS_USER,
                password: CRED.password,
            }),
        },
        setup: () => setupMemos(14108),
    },

    pihole: {
        name: "Pi-hole",
        selectionRank: 19,
        oldImage: "pihole/pihole:2025.02.1",
        newImage: "pihole/pihole:2025.06.2",
        container: {
            name: "rookie-exp-target",
            port: 80,
            hostPort: 14109,
            env: {
                TZ: "Europe/Warsaw",
                FTLCONF_webserver_api_password: CRED.password,
            },
        },
        health: { url: "http://localhost:{hostPort}/admin/", retries: 25, intervalMs: 3000 },
        // Adjacent-current fidelity: v6 REST docs unversioned; adjacent v6 tags.
        docs: { mode: "url-crawl", url: "https://docs.pi-hole.net/api/", maxPages: 8 },
        planner: {
            maxGoals: 8,
            initialContext: JSON.stringify({
                apiBase: "http://host.docker.internal:{hostPort}/api",
                password: CRED.password,
            }),
        },
    },

    meilisearch: {
        name: "MeiliSearch",
        selectionRank: 21,
        oldImage: "getmeili/meilisearch:v1.8",
        newImage: "getmeili/meilisearch:v1.12",
        container: {
            name: "rookie-exp-target",
            port: 7700,
            hostPort: 14110,
            env: { MEILI_MASTER_KEY: "rookie-master-key", MEILI_ENV: "development" },
        },
        health: { url: "http://localhost:{hostPort}/health", retries: 15, intervalMs: 2000 },
        // Adjacent-current fidelity: API reference unversioned.
        docs: {
            mode: "url-crawl",
            url: "https://www.meilisearch.com/docs/reference/api/overview",
            maxPages: 40,
        },
        planner: {
            maxGoals: 8,
            initialContext: JSON.stringify({
                apiBase: "http://host.docker.internal:{hostPort}",
                apiKey: "rookie-master-key",
            }),
        },
    },

    ghost: {
        name: "Ghost",
        selectionRank: 26,
        oldImage: "ghost:5.87.0",
        newImage: "ghost:5.109.0",
        container: {
            name: "rookie-exp-target",
            port: 2368,
            hostPort: 14111,
            env: {
                database__client: "sqlite3",
                database__connection__filename: "/var/lib/ghost/content/data/ghost.db",
                url: "http://localhost:14111",
                NODE_ENV: "development",
            },
        },
        health: {
            url: "http://localhost:{hostPort}/ghost/api/admin/site/",
            retries: 25,
            intervalMs: 3000,
        },
        // Adjacent-current fidelity: Admin API docs unversioned.
        docs: { mode: "url-crawl", url: "https://ghost.org/docs/admin-api/", maxPages: 5 },
        planner: {
            maxGoals: 8,
            initialContext: JSON.stringify({
                apiBase: "http://host.docker.internal:{hostPort}/ghost/api/admin",
                email: CRED.email,
                password: CRED.password,
            }),
        },
        setup: () => setupGhost(14111),
    },

    jellyfin: {
        name: "Jellyfin",
        selectionRank: 27,
        oldImage: "jellyfin/jellyfin:10.8.13",
        newImage: "jellyfin/jellyfin:10.9.11",
        container: { name: "rookie-exp-target", port: 8096, hostPort: 14112, env: {} },
        health: { url: "http://localhost:{hostPort}/health", retries: 25, intervalMs: 3000 },
        // Self-served fidelity: OpenAPI from the running OLD container.
        docs: {
            mode: "swagger-json",
            url: "http://localhost:{hostPort}/api-docs/openapi.json",
            maxPages: 1,
        },
        planner: {
            maxGoals: 8,
            initialContext: JSON.stringify({
                apiBase: "http://host.docker.internal:{hostPort}",
                username: CRED.user,
                password: CRED.password,
            }),
        },
        setup: () => setupJellyfin(14112),
    },

    metabase: {
        name: "Metabase",
        selectionRank: 33,
        oldImage: "metabase/metabase:v0.49.14",
        newImage: "metabase/metabase:v0.50.26",
        container: { name: "rookie-exp-target", port: 3000, hostPort: 14113, env: {} },
        health: { url: "http://localhost:{hostPort}/api/health", retries: 40, intervalMs: 3000 },
        // Adjacent-current fidelity: API docs under /docs/latest.
        docs: {
            mode: "url-crawl",
            url: "https://www.metabase.com/docs/latest/api",
            maxPages: 30,
        },
        planner: {
            maxGoals: 8,
            initialContext: JSON.stringify({
                apiBase: "http://host.docker.internal:{hostPort}/api",
                email: CRED.email,
                password: CRED.password,
            }),
        },
        setup: () => setupMetabase(14113),
    },

    airflow: {
        name: "Apache Airflow",
        selectionRank: 38,
        oldImage: "apache/airflow:2.9.3",
        newImage: "apache/airflow:2.10.4",
        container: {
            name: "rookie-exp-target",
            port: 8080,
            hostPort: 14114,
            env: {},
            cmd: ["standalone"],
        },
        health: { url: "http://localhost:{hostPort}/health", retries: 40, intervalMs: 4000 },
        // Versioned-site fidelity: REST reference pinned to the OLD version.
        docs: {
            mode: "url-crawl",
            url: "https://airflow.apache.org/docs/apache-airflow/{oldTag}/stable-rest-api-ref.html",
            maxPages: 2,
        },
        planner: {
            maxGoals: 8,
            initialContext: JSON.stringify({
                apiBase: "http://host.docker.internal:{hostPort}/api/v1",
                username: "admin",
                password: "{adminPassword}",
            }),
        },
        setup: (c) => setupAirflow(c),
    },

    rsshub: {
        name: "RSSHub",
        selectionRank: 41,
        oldImage: "diygod/rsshub:2024-06-15",
        newImage: "diygod/rsshub:2024-12-02",
        container: { name: "rookie-exp-target", port: 1200, hostPort: 14115, env: {} },
        health: { url: "http://localhost:{hostPort}/healthz", retries: 20, intervalMs: 3000 },
        // Adjacent-current fidelity: usage/API docs unversioned.
        docs: { mode: "url-crawl", url: "https://docs.rsshub.app/guide/", maxPages: 20 },
        planner: {
            maxGoals: 8,
            initialContext: JSON.stringify({
                apiBase: "http://host.docker.internal:{hostPort}",
            }),
        },
    },

    siyuan: {
        name: "SiYuan",
        selectionRank: 42,
        oldImage: "b3log/siyuan:v3.0.17",
        newImage: "b3log/siyuan:v3.1.18",
        container: {
            name: "rookie-exp-target",
            port: 6806,
            hostPort: 14116,
            env: {},
            cmd: ["--workspace=/siyuan/workspace/", "--accessAuthCode=rookie-code"],
        },
        health: { url: "http://localhost:{hostPort}/", retries: 20, intervalMs: 3000 },
        // Tagged-repo fidelity: kernel API reference at the OLD tag.
        docs: {
            mode: "url-crawl",
            url: "https://github.com/siyuan-note/siyuan/blob/{oldTag}/API.md",
            maxPages: 1,
        },
        planner: {
            maxGoals: 8,
            initialContext: JSON.stringify({
                apiBase: "http://host.docker.internal:{hostPort}",
                token: "rookie-code",
            }),
        },
    },

    kong: {
        name: "Kong",
        selectionRank: 43,
        oldImage: "kong:3.6",
        newImage: "kong:3.9",
        container: {
            name: "rookie-exp-target",
            port: 8001,
            hostPort: 14117,
            env: {
                KONG_DATABASE: "off",
                KONG_ADMIN_LISTEN: "0.0.0.0:8001",
                KONG_PROXY_LISTEN: "0.0.0.0:8000",
            },
        },
        health: { url: "http://localhost:{hostPort}/status", retries: 20, intervalMs: 3000 },
        // Versioned-site fidelity intent; exact admin-API reference path verified in preflight.
        docs: {
            mode: "url-crawl",
            url: "https://docs.konghq.com/gateway/api/admin-oss/latest/",
            maxPages: 3,
        },
        planner: {
            maxGoals: 8,
            initialContext: JSON.stringify({
                apiBase: "http://host.docker.internal:{hostPort}",
            }),
        },
    },

    halo: {
        name: "Halo",
        selectionRank: 53,
        oldImage: "halohub/halo:2.16",
        newImage: "halohub/halo:2.20",
        container: { name: "rookie-exp-target", port: 8090, hostPort: 14118, env: {} },
        health: {
            url: "http://localhost:{hostPort}/actuator/health",
            retries: 30,
            intervalMs: 3000,
        },
        // Self-served fidelity: springdoc OpenAPI from the running OLD container.
        docs: {
            mode: "swagger-json",
            url: "http://localhost:{hostPort}/v3/api-docs",
            maxPages: 1,
        },
        planner: {
            maxGoals: 8,
            initialContext: JSON.stringify({
                apiBase: "http://host.docker.internal:{hostPort}",
                username: CRED.user,
                password: CRED.password,
            }),
        },
        setup: () => setupHalo(14118),
    },

    trilium: {
        name: "TriliumNext Notes",
        selectionRank: 58,
        oldImage: "triliumnext/notes:v0.90.4",
        newImage: "triliumnext/notes:v0.92.7",
        container: { name: "rookie-exp-target", port: 8080, hostPort: 14119, env: {} },
        health: { url: "http://localhost:{hostPort}/", retries: 20, intervalMs: 3000 },
        // Adjacent-current fidelity: ETAPI documentation.
        docs: {
            mode: "url-crawl",
            url: "https://triliumnext.github.io/Docs/Wiki/etapi.html",
            maxPages: 3,
        },
        planner: {
            maxGoals: 8,
            initialContext: JSON.stringify({
                apiBase: "http://host.docker.internal:{hostPort}/etapi",
                token: "{apiToken}",
            }),
        },
        setup: () => setupTrilium(14119),
    },

    nextcloud: {
        name: "Nextcloud",
        selectionRank: 61,
        oldImage: "nextcloud:29-apache",
        newImage: "nextcloud:30-apache",
        container: {
            name: "rookie-exp-target",
            port: 80,
            hostPort: 14120,
            env: {
                SQLITE_DATABASE: "nextcloud",
                NEXTCLOUD_ADMIN_USER: CRED.user,
                NEXTCLOUD_ADMIN_PASSWORD: CRED.password,
                NEXTCLOUD_TRUSTED_DOMAINS: "localhost host.docker.internal",
            },
        },
        health: { url: "http://localhost:{hostPort}/status.php", retries: 30, intervalMs: 4000 },
        // Versioned-site fidelity: docs tree pinned to the OLD major.
        docs: {
            mode: "url-crawl",
            url: "https://docs.nextcloud.com/server/{docsMajor}/developer_manual/client_apis/",
            maxPages: 30,
        },
        planner: {
            maxGoals: 8,
            initialContext: JSON.stringify({
                baseUrl: "http://host.docker.internal:{hostPort}",
                apiBase: "http://host.docker.internal:{hostPort}/ocs/v2.php",
                username: CRED.user,
                password: CRED.password,
            }),
        },
    },
};
