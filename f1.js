export default async (ctx) => {
    ctx.url = ctx.bridgeUrl + "/api";
    const response = await fetch(ctx.url, {
        method: "POST",
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "manager/auth",
            params: {
                grantType: "api_key_credentials",
                apiKeyId: ctx.apiKeyId,
                apiKeySecret: ctx.apiKeySecret,
                scope: ["apiKey", "solution", "context", "thread", "store", "inbox"],
            },
        }),
        headers: { "Content-type": "application/json" },
    });
    const result = await response.json();
    if (result.error) throw new Error(result.error);
    ctx.$$auth = {};
    ctx.$$auth.token = result.result.accessToken;
    ctx.$$auth.refreshToken = result.result.refreshToken;
    ctx.$$auth.expires = result.result.accessTokenExpiry;
    ctx.$$auth.raw = result.result;
    return { result, ctx };
};
