export class Utils {
    static async tryPromise<T>(func: () => Promise<T>) {
        try {
            const result = await func();
            return {
                result,
                success: true,
            };
        } catch (e) {
            return {
                error: e,
                success: false,
            };
        }
    }
}
