export default async (ctx) => {
    ctx.url = ctx.bridgeUrl + "/api";
    // List contexts for an existing solution (using provided firstSolutionId)
    const response = await fetch(ctx.url, {
        method: "POST",
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 7,
            method: "context/listContextsOfSolution",
            params: {
                solutionId: ctx.firstSolutionId,
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
    ctx.$$listContextsOfSolution = {};
    ctx.$$listContextsOfSolution.count = result.result.count;
    ctx.$$listContextsOfSolution.list = result.result.list;
    return { result, ctx };
};
