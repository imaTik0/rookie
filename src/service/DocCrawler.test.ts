/**
 * Tests for DocCrawler path-prefix scoping — ensures a crawl started at a
 * versioned docs subtree does not bleed into sibling versions (e.g. /influxdb/v2
 * must not pull in /influxdb/v3). Reaches the private helper via `as any`.
 * Run with: deno test src/service/DocCrawler.test.ts
 */
import { assertEquals } from "@std/assert";
import { DocCrawler } from "./DocCrawler.ts";
import type { ConfigService } from "./ConfigService.ts";
import { fakeLogger } from "../testing/fakes.ts";

// deno-lint-ignore no-explicit-any
function prefix(url: string): string {
    const crawler = new DocCrawler(fakeLogger(), {} as unknown as ConfigService);
    // deno-lint-ignore no-explicit-any
    return (crawler as any).getPathPrefix(url);
}

Deno.test("directory URL scopes the crawl to its full subtree (excludes sibling versions)", () => {
    assertEquals(prefix("https://docs.influxdata.com/influxdb/v2/"), "/influxdb/v2");
    assertEquals(
        prefix("https://docs.influxdata.com/influxdb/v2/api-guide/"),
        "/influxdb/v2/api-guide",
    );
    assertEquals(prefix("https://docs.gitea.com/api/1.23/"), "/api/1.23");
});

Deno.test("file-like URL scopes to its parent directory", () => {
    assertEquals(prefix("https://example.com/docs/guide/page.html"), "/docs/guide");
});

Deno.test("a bare single segment stays unconstrained", () => {
    assertEquals(prefix("https://example.com/docs"), "");
});

Deno.test("the origin root stays unconstrained", () => {
    assertEquals(prefix("https://example.com/"), "");
});
