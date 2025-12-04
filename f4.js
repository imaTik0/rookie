export default async (ctx) => {
    ctx.url = ctx.bridgeUrl + "/api";
    // create a context under the newly created solution
    const response = await fetch(ctx.url, {
        method: "POST",
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 4,
            method: "context/createContext",
            params: {
                solution: ctx.$$solutionCreate.id,
                name: "demo-context-" + Date.now(),
                description: "Context created for API flows",
                scope: "private",
            },
        }),
        headers: {
            "Content-type": "application/json",
            "Authorization": "Bearer " + ctx.$$auth.token,
        },
    });
    const result = await response.json();
    if (result.error) throw new Error(result.error);
    ctx.$$contextCreate = {};
    ctx.$$contextCreate.contextId = result.result.contextId;
    ctx.$$contextCreate.raw = result.result;
    return { result, ctx };
};
