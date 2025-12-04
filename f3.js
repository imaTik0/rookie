export default async (ctx) => {
    ctx.url = ctx.bridgeUrl + "/api";
    const name = "Demo Solution " + Date.now();
    const response = await fetch(ctx.url, {
        method: "POST",
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 3,
            method: "solution/createSolution",
            params: { name },
        }),
        headers: {
            "Content-type": "application/json",
            "Authorization": "Bearer " + ctx.$$auth.token,
        },
    });
    const result = await response.json();
    if (result.error) throw new Error(result.error);
    ctx.$$solutionCreate = {};
    ctx.$$solutionCreate.id = result.result.solutionId;
    ctx.$$solutionCreate.name = name;
    ctx.$$solutionCreate.raw = result.result;
    return { result, ctx };
};
