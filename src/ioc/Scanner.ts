import * as path from "@std/path";
import { IOC } from "./IOC.ts";
import { shouldAutoRegister } from "./decorator.ts";

export interface Registry {
    register(type: unknown): void;
}

export class Scanner {
    static DEBUG = false;

    static registerToIoc(ioc: IOC, dirPath: string, filter?: RegExp) {
        return Scanner.scan(ioc, dirPath, filter);
    }

    static findTypes(dirPath: string, filter?: RegExp) {
        const list: unknown[] = [];
        Scanner.scan({ register: (type) => list.push(type) }, dirPath, filter);
        return list;
    }

    static async scan(registry: Registry, dirPath: string, filter?: RegExp) {
        const entries = Deno.readDirSync(dirPath);
        for (const entry of entries) {
            const entryPath = path.resolve(dirPath, entry.name);
            if (Deno.statSync(entryPath).isDirectory) {
                // Must await: controllers live in subdirectories, and callers
                // (Container.init) rely on registration being complete on return.
                await this.scan(registry, entryPath, filter);
            } else if (
                (entry.name.endsWith(".js") || entry.name.endsWith(".ts")) &&
                // Never import co-located test files: their top-level Deno.test()
                // calls would run at startup (and break when scanning under a test).
                !entry.name.endsWith(".test.ts") &&
                (!filter || filter.test(entry.name))
            ) {
                try {
                    const module = await import(entryPath);
                    for (const key in module) {
                        const exported = module[key];
                        if (
                            typeof exported == "function" &&
                            shouldAutoRegister(exported)
                        ) {
                            if (Scanner.DEBUG) {
                                console.log(
                                    `Register ${exported.name} from ${entryPath}`,
                                );
                            }
                            registry.register(exported);
                        }
                    }
                } catch (e) {
                    console.error(
                        `Error during registering module ${entryPath} in IOC`,
                        e,
                    );
                    throw e;
                }
            }
        }
    }
}
