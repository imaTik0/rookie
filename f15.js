export default async (ctx) => {
    ctx.url = ctx.bridgeUrl + "/api";
    // List API keys to demonstrate manager API usage
    const response = await fetch(ctx.url, {
        method: "POST",
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 15,
            method: "manager/listApiKeys",
            params: {},
        }),
        headers: {
            "Content-type": "application/json",
            "Authorization": "Bearer " + ctx.$$auth.token,
        },
    });
    const result = await response.json();
    if (result.error) throw new Error(result.error);
    ctx.$$listApiKeys = {};
    ctx.$$listApiKeys.list = result.result.list;
    return { result, ctx };
};
