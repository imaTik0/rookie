export default async (ctx) => {
    ctx.url = ctx.bridgeUrl + "/api";
    // List inboxes in our context to demonstrate inbox API usage
    const response = await fetch(ctx.url, {
        method: "POST",
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 11,
            method: "inbox/listInboxes",
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
    ctx.$$listInboxes = {};
    ctx.$$listInboxes.count = result.result.count;
    ctx.$$listInboxes.list = result.result.list;
    return { result, ctx };
};
