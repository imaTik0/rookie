export default async (ctx) => {
    ctx.url = ctx.bridgeUrl + "/api";
    // List threads in the created context to demonstrate thread listing
    const response = await fetch(ctx.url, {
        method: "POST",
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 12,
            method: "thread/listThreads",
            params: {
                contextId: ctx.$$contextCreate.contextId,
                from: null,
                limit: 10,
                sortOrder: "asc",
            },
        }),
        headers: {
            "Content-type": "application/json",
            "Authorization": "Bearer " + ctx.$$auth.token,
        },
    });
    const result = await response.json();
    if (result.error) throw new Error(result.error);
    ctx.$$listThreads = {};
    ctx.$$listThreads.count = result.result.count;
    ctx.$$listThreads.list = result.result.list;
    return { result, ctx };
};
