/**
 * Tests for HTML -> Markdown extraction. Runs in-process (linkedom), no network.
 * Run with: deno test src/service/HtmlToMarkdown.test.ts
 */
import { assert, assertEquals } from "@std/assert";
import { htmlToMarkdown, type ParseOptions } from "./HtmlToMarkdown.ts";

function opts(over: Partial<ParseOptions> = {}): ParseOptions {
    return {
        pageUrl: "https://docs.example.com/guide",
        originFilter: "https://docs.example.com",
        pathPrefix: "",
        sameDomainOnly: true,
        spaMinTextChars: 200,
        readabilityMinChars: 250,
        ...over,
    };
}

Deno.test("detects an unrendered SPA shell (tiny body + app root) and skips it", () => {
    const html = `<html><body><div id="swagger-ui"></div><span>loading</span></body></html>`;
    const r = htmlToMarkdown(html, opts());
    assertEquals(r.isLikelySpa, true);
    assertEquals(r.markdown, "");
});

Deno.test("converts article content to Markdown with a title + Source header", () => {
    const para = "This guide explains how to authenticate against the API using a bearer token. "
        .repeat(8);
    const html = `<html><head><title>Auth Guide</title></head><body>
        <nav>home about contact</nav>
        <main><h1>Authentication</h1><p>${para}</p></main>
        <footer>copyright</footer>
    </body></html>`;
    const r = htmlToMarkdown(html, opts());
    assertEquals(r.isLikelySpa, false);
    assert(r.markdown.startsWith("# "));
    assert(r.markdown.includes("Source: https://docs.example.com/guide"));
    assert(r.markdown.includes("authenticate against the API"));
});

Deno.test("falls back to main/body extraction and converts a headerless table to GFM", () => {
    const html = `<html><head><title>Params</title></head><body><main>
        <h2>Parameters</h2>
        <table><tbody>
            <tr><td>id</td><td>string</td></tr>
            <tr><td>name</td><td>string</td></tr>
        </tbody></table>
    </main></body></html>`;
    // Force the fallback path so extraction is deterministic.
    const r = htmlToMarkdown(html, opts({ readabilityMinChars: 1_000_000 }));
    assert(r.markdown.includes("| id | string |"));
    assert(r.markdown.includes("| --- | --- |")); // synthesized separator row
});

Deno.test("extracts same-origin links and excludes assets/mailto/anchors/external", () => {
    const html = `<html><body>
        <div id="app"></div>
        <a href="/guide/next">next</a>
        <a href="https://other.com/x">external</a>
        <a href="mailto:a@b.com">mail</a>
        <a href="#section">anchor</a>
        <a href="/logo.png">image</a>
    </body></html>`;
    const r = htmlToMarkdown(html, opts());
    assertEquals(r.links, ["https://docs.example.com/guide/next"]);
});
