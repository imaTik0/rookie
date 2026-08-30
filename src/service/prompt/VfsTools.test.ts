import { assert, assertEquals } from "@std/assert";
import { VfsTools } from "./VfsTools.ts";
import { ConfigService } from "../ConfigService.ts";
import type { DocFile } from "../../types/file.ts";
import { fakeLogger } from "../../testing/fakes.ts";

function docFile(filename: string, content: string): DocFile {
    return {
        metadata: { filename },
        buffer: new TextEncoder().encode(content),
    } as unknown as DocFile;
}

function vfs(config?: ConfigService) {
    const files = [
        docFile("guide.md", "# Title\nintro line\n## Auth\nuse a token\nmore auth detail"),
        docFile(
            "api.json",
            JSON.stringify({
                openapi: "3.0.0",
                paths: { "/users": { get: { summary: "List users" } } },
            }),
        ),
    ];
    const tools = new VfsTools(config ?? new ConfigService(fakeLogger()));
    return { handlers: tools.createHandlers(files), files };
}

Deno.test("list_files lists filenames", async () => {
    const { handlers } = vfs();
    assertEquals(await handlers.list_files(), "guide.md\napi.json");
});

Deno.test("read_file returns content or a not-found message", async () => {
    const { handlers } = vfs();
    assert((await handlers.read_file("id", { filename: "guide.md" })).includes("intro line"));
    assertEquals(
        await handlers.read_file("id", { filename: "nope.md" }),
        "File not found: nope.md",
    );
});

Deno.test("read_file truncates files above the configured cap", async () => {
    const config = { values: { limits: { maxFileReadChars: 20 } } } as unknown as ConfigService;
    const { handlers } = vfs(config);
    const out = await handlers.read_file("id", { filename: "guide.md" });
    assert(out.includes("truncated"));
    assert(out.includes("outline_file"));
});

Deno.test("grep_file returns matching lines with line numbers", async () => {
    const { handlers } = vfs();
    const out = await handlers.grep_file("id", { filename: "guide.md", pattern: "auth" });
    assert(out.includes("[Line 3]"));
});

Deno.test("grep_corpus searches across files with filename:line tags", async () => {
    const { handlers } = vfs();
    const out = await handlers.grep_corpus("id", { pattern: "token", context_lines: 0 });
    assert(out.includes("[guide.md:4]"));
});

Deno.test("outline_file lists markdown headings and OpenAPI endpoints", async () => {
    const { handlers } = vfs();
    const md = await handlers.outline_file("id", { filename: "guide.md" });
    assert(md.includes("Title"));
    assert(md.includes("Auth"));
    const api = await handlers.outline_file("id", { filename: "api.json" });
    assert(api.includes("GET /users"));
});

Deno.test("read_section returns a heading's body up to the next same-level heading", async () => {
    const { handlers } = vfs();
    const out = await handlers.read_section("id", { filename: "guide.md", heading: "Auth" });
    assert(out.includes("use a token"));
    assert(!out.includes("# Title"));
});

Deno.test("get_endpoint looks up an OpenAPI endpoint by path", async () => {
    const { handlers } = vfs();
    const out = await handlers.get_endpoint("id", { path: "/users", method: "GET" });
    assert(out.includes("GET /users"));
    assert(out.includes("List users"));
});

Deno.test("get_endpoint reports a miss when nothing matches", async () => {
    const { handlers } = vfs();
    const out = await handlers.get_endpoint("id", { path: "/nonexistent" });
    assert(out.includes("No endpoint matching"));
});
