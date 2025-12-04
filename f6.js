export default async (ctx) => {
    ctx.url = ctx.bridgeUrl + "/api";
    // List users from the created context to verify addition
    const response = await fetch(ctx.url, {
        method: "POST",
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 6,
            method: "context/listUsersFromContext",
            params: {
                contextId: ctx.$$contextCreate.contextId,
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
    ctx.$$listUsers = {};
    ctx.$$listUsers.users = result.result.users;
    ctx.$$listUsers.count = result.result.count;
    return { result, ctx };
};
