export default async (ctx) => {
    ctx.url = ctx.bridgeUrl + "/api";
    // List stores in the created context to demonstrate store listing
    const response = await fetch(ctx.url, {
        method: "POST",
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 13,
            method: "store/listStores",
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
    ctx.$$listStores = {};
    ctx.$$listStores.count = result.result.count;
    ctx.$$listStores.list = result.result.list;
    return { result, ctx };
};
