export default async (ctx) => {
    ctx.url = ctx.bridgeUrl + "/api";
    // Get details of the context we created earlier
    const response = await fetch(ctx.url, {
        method: "POST",
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 8,
            method: "context/getContext",
            params: {
                contextId: ctx.$$contextCreate.contextId,
            },
        }),
        headers: {
            "Content-type": "application/json",
            "Authorization": "Bearer " + ctx.$$auth.token,
        },
    });
    const result = await response.json();
    if (result.error) throw new Error(result.error);
    ctx.$$getContext = {};
    ctx.$$getContext.context = result.result.context;
    return { result, ctx };
};
