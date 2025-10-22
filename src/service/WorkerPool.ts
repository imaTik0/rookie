export class Executor {
    async executeScript(path: string, ctx: any) {
        const module = await import(path);
        return await module.default(ctx);
    }
}
