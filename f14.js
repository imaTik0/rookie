export default async (ctx) => {
    ctx.url = ctx.bridgeUrl + "/api";
    // List all solutions available to the token to demonstrate solution listing
    const response = await fetch(ctx.url, {
        method: "POST",
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 14,
            method: "solution/listSolutions",
            params: {},
        }),
        headers: {
            "Content-type": "application/json",
            "Authorization": "Bearer " + ctx.$$auth.token,
        },
    });
    const result = await response.json();
    if (result.error) throw new Error(result.error);
    ctx.$$listSolutions = {};
    ctx.$$listSolutions.list = result.result.list;
    return { result, ctx };
};
