export default async (ctx) => {
    ctx.url = ctx.bridgeUrl + "/api";
    // Update context scope to public as an example update operation
    const response = await fetch(ctx.url, {
        method: "POST",
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 9,
            method: "context/updateContext",
            params: {
                contextId: ctx.$$contextCreate.contextId,
                scope: "public",
            },
        }),
        headers: {
            "Content-type": "application/json",
            "Authorization": "Bearer " + ctx.$$auth.token,
        },
    });
    const result = await response.json();
    if (result.error) throw new Error(result.error);
    ctx.$$updateContext = {};
    ctx.$$updateContext.status = result.result;
    return { result, ctx };
};
