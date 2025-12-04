export default async (ctx) => {
    ctx.url = ctx.bridgeUrl + "/api";
    // Add a sample user to the newly created context
    const response = await fetch(ctx.url, {
        method: "POST",
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 5,
            method: "context/addUserToContext",
            params: {
                contextId: ctx.$$contextCreate.contextId,
                userId: "alice",
                userPubKey: "64dGCs7myoFrZDnP5pgvmBNKF1za22b5iBQaEpeBcGWiTUCA3c",
            },
        }),
        headers: {
            "Content-type": "application/json",
            "Authorization": "Bearer " + ctx.$$auth.token,
        },
    });
    const result = await response.json();
    if (result.error) throw new Error(result.error);
    ctx.$$addUser = {};
    ctx.$$addUser.status = result.result;
    return { result, ctx };
};
