export function formatDate(iso: string | Date | undefined): string {
    if (!iso) return "—";
    const d = typeof iso === "string" ? new Date(iso) : iso;
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

export function timeAgo(iso: string | undefined): string {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return formatDate(iso);
}

export function formatDuration(ms: number | undefined): string {
    if (ms === undefined || ms === null || Number.isNaN(ms)) return "—";
    if (ms < 1000) return `${Math.round(ms)}ms`;
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(1)}s`;
    const m = Math.floor(s / 60);
    const rs = Math.round(s % 60);
    return `${m}m ${rs}s`;
}

export function formatBytes(bytes: number | undefined): string {
    if (bytes === undefined || Number.isNaN(bytes)) return "—";
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    return `${(kb / 1024).toFixed(2)} MB`;
}

export function shortId(id: string | undefined, length = 10): string {
    if (!id) return "—";
    return id.length > length ? `${id.slice(0, length)}…` : id;
}

export function tryPrettyJson(value: unknown): string {
    if (value === undefined || value === null) return "";
    if (typeof value === "string") {
        try {
            return JSON.stringify(JSON.parse(value), null, 2);
        } catch {
            return value;
        }
    }
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}
