export default async (ctx) => {
    ctx.url = ctx.bridgeUrl + "/api";
    // List all contexts (global) to demonstrate pagination/listing
    const response = await fetch(ctx.url, {
        method: "POST",
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 10,
            method: "context/listContexts",
            params: {
                skip: 0,
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
    ctx.$$listContexts = {};
    ctx.$$listContexts.count = result.result.count;
    ctx.$$listContexts.list = result.result.list;
    return { result, ctx };
};
