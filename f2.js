export default async (ctx) => {
    ctx.url = ctx.bridgeUrl + "/api";
    const response = await fetch(ctx.url, {
        method: "POST",
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "manager/bindAccessToken",
            params: {
                accessToken: ctx.$$auth.token,
            },
        }),
        headers: {
            "Content-type": "application/json",
            "Authorization": "Bearer " + ctx.$$auth.token,
        },
    });
    const result = await response.json();
    if (result.error) throw new Error(result.error);
    ctx.$$bind = {};
    ctx.$$bind.status = result.result;
    return { result, ctx };
};
