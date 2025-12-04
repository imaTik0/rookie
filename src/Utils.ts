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

    static async sha256(message: string): Promise<string> {
        const msgUint8 = new TextEncoder().encode(message);
        const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");

        return hashHex;
    }
}
