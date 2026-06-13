import type {
    CreateTestSuite,
    FileMeta,
    GapFeedback,
    GapVerdict,
    Job,
    JobKind,
    JobStatus,
    ListReportItem,
    Paginated,
    PaginatedFiles,
    PaginatedProjects,
    PlannerEvent,
    Project,
    Report,
    ReportStatus,
    ReportType,
    TestSuite,
} from "./types";

export const API_BASE: string = (import.meta as { env?: Record<string, string> }).env
    ?.VITE_API_URL ?? "/api";

export class ApiError extends Error {
    constructor(public status: number, message: string) {
        super(message);
        this.name = "ApiError";
    }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
        headers: init?.body instanceof FormData
            ? init?.headers
            : { "Content-Type": "application/json", ...init?.headers },
        ...init,
    });
    if (!res.ok) {
        let message = `${res.status} ${res.statusText}`;
        try {
            const body = await res.json();
            if (body?.message) message = body.message;
        } catch {
            // keep default message
        }
        throw new ApiError(res.status, message);
    }
    if (res.status === 204) return undefined as T;
    return await res.json() as T;
}

function qs(params: Record<string, string | number | undefined>): string {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== "") sp.set(k, String(v));
    }
    const s = sp.toString();
    return s ? `?${s}` : "";
}

// ---------- Reports ----------

export interface ReportListParams {
    page?: number;
    limit?: number;
    projectId?: string;
    testSuiteId?: string;
    status?: ReportStatus | "";
    type?: ReportType | "";
}

export const reportsApi = {
    list: (p: ReportListParams = {}) =>
        request<Paginated<ListReportItem>>(`/reports${qs(p as Record<string, string>)}`),
    get: (id: string) => request<Report>(`/reports/${id}`),
    remove: (id: string) => request<void>(`/reports/${id}`, { method: "DELETE" }),
    docsPatchUrl: (id: string, format: "markdown" | "diff" = "markdown") =>
        `${API_BASE}/reports/${id}/docs-patch?format=${format}`,
    addFeedback: (
        id: string,
        body: { stepIndex?: number; verdict: GapVerdict; comment?: string; editedFix?: string },
    ) =>
        request<GapFeedback>(`/reports/${id}/feedback`, {
            method: "POST",
            body: JSON.stringify(body),
        }),
};

// ---------- Projects ----------

export const projectsApi = {
    list: (page = 1, limit = 50) => request<PaginatedProjects>(`/projects${qs({ page, limit })}`),
    get: (id: string) => request<Project>(`/projects/${id}`),
    create: (body: { projectName: string; fileIds?: string[] }) =>
        request<Project>(`/projects`, { method: "POST", body: JSON.stringify(body) }),
    createFromUrl: (body: { projectName: string; url: string; maxPages?: number }) =>
        request<Job>(`/projects/from-url`, { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, body: { projectName?: string; fileIds?: string[] }) =>
        request<Project>(`/projects/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    remove: (id: string) =>
        request<{ id: string; message: string }>(`/projects/${id}`, { method: "DELETE" }),
    addFiles: (id: string, fileIds: string[]) =>
        request<Project>(`/projects/${id}/files`, {
            method: "POST",
            body: JSON.stringify({ fileIds }),
        }),
    removeFiles: (id: string, fileIds: string[]) =>
        request<Project>(`/projects/${id}/files`, {
            method: "DELETE",
            body: JSON.stringify({ fileIds }),
        }),
};

// ---------- Test suites ----------

export const testSuitesApi = {
    list: (p: { page?: number; limit?: number; projectId?: string } = {}) =>
        request<Paginated<TestSuite>>(`/testsuites${qs(p as Record<string, string>)}`),
    get: (id: string) => request<TestSuite>(`/testsuites/${id}`),
    create: (body: CreateTestSuite) =>
        request<TestSuite>(`/testsuites`, { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, body: Partial<CreateTestSuite>) =>
        request<TestSuite>(`/testsuites/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    remove: (id: string) => request<void>(`/testsuites/${id}`, { method: "DELETE" }),
    execute: (id: string) => request<Job>(`/testsuites/${id}/execute`, { method: "POST" }),
};

// ---------- Jobs ----------

export const jobsApi = {
    list: (p: { page?: number; limit?: number; kind?: JobKind | ""; status?: JobStatus | "" } = {}) =>
        request<Paginated<Job>>(`/jobs${qs(p as Record<string, string>)}`),
    get: (id: string) => request<Job>(`/jobs/${id}`),
    cancel: (id: string) => request<Job>(`/jobs/${id}`, { method: "DELETE" }),
};

// ---------- Files ----------

export const filesApi = {
    list: (page = 1, limit = 20) => request<PaginatedFiles>(`/files${qs({ page, limit })}`),
    upload: (file: File) => {
        const form = new FormData();
        form.append("file", file);
        return request<FileMeta>(`/files/upload`, { method: "POST", body: form });
    },
    uploadMany: (files: File[]) => {
        const form = new FormData();
        for (const f of files) form.append("files", f);
        return request<FileMeta[]>(`/files/upload-many`, { method: "POST", body: form });
    },
    remove: (id: string) =>
        request<{ id: string; message: string }>(`/files/${id}`, { method: "DELETE" }),
    downloadUrl: (id: string) => `${API_BASE}/files/${id}/download`,
};

// ---------- Planner (NDJSON stream) ----------

export async function runMasterPlan(
    body: { projectId: string; maxGoals?: number; initialContext?: string },
    onEvent: (event: PlannerEvent) => void,
    signal?: AbortSignal,
): Promise<void> {
    const res = await fetch(`${API_BASE}/planner/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
    });
    if (!res.ok || !res.body) {
        let message = `${res.status} ${res.statusText}`;
        try {
            const json = await res.json();
            if (json?.message) message = json.message;
        } catch { /* ignore */ }
        throw new ApiError(res.status, message);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                onEvent(JSON.parse(trimmed));
            } catch {
                onEvent({ type: "RAW", message: trimmed });
            }
        }
    }
    const rest = buffer.trim();
    if (rest) {
        try {
            onEvent(JSON.parse(rest));
        } catch {
            onEvent({ type: "RAW", message: rest });
        }
    }
}
