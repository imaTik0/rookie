import { assert, assertEquals } from "@std/assert";
import { checkFaithfulness } from "./faithfulness.ts";

Deno.test("no expected symbols → not applicable, faithful by default", () => {
    const r = checkFaithfulness("import { execa } from 'execa'; execa('ls');", []);
    assertEquals(r.checked, false);
    assertEquals(r.faithful, true);
});

Deno.test("catches the dodge: expected execaCommand, code used execa()", () => {
    const code = `import { execa } from 'execa';
export default async () => { const r = await execa('git', ['status']); return { result: r }; };`;
    const r = checkFaithfulness(code, ["execaCommand", "parseCommandString"]);
    assertEquals(r.checked, true);
    assertEquals(r.faithful, false);
    assertEquals(r.used, []);
    assert(r.missing.includes("execaCommand"));
});

Deno.test("faithful when at least one documented symbol is used as code", () => {
    const code = `import { execaCommand } from 'execa';
export default async () => execaCommand('git status');`;
    const r = checkFaithfulness(code, ["execaCommand", "parseCommandString"]);
    assertEquals(r.faithful, true);
    assert(r.used.includes("execaCommand"));
});

Deno.test("a symbol only mentioned in a comment or string does not count", () => {
    const code = `// this used to use execaCommand
import { execa } from 'execa';
const note = "execaCommand was removed";
export default async () => execa('ls');`;
    const r = checkFaithfulness(code, ["execaCommand"]);
    assertEquals(r.faithful, false);
    assertEquals(r.used, []);
});

Deno.test("does not match a substring of a longer identifier", () => {
    const code = `const myExecaCommandHelper = 1; export default async () => myExecaCommandHelper;`;
    const r = checkFaithfulness(code, ["execaCommand"]);
    assertEquals(r.faithful, false);
});

Deno.test("member-access symbols match (em.getKysely)", () => {
    const code =
        `export default async (ctx) => { const k = ctx.em.getKysely(); return { result: !!k }; };`;
    const r = checkFaithfulness(code, ["getKysely"]);
    assertEquals(r.faithful, true);
});
