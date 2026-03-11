import { type Logger as PinoLogger, pino } from "pino";

const baseLogger = pino({
    level: "info",
});

export class Logger {
    private readonly logger: PinoLogger;

    constructor(public name: string) {
        this.logger = baseLogger.child({ name: this.name });
    }

    private trimArgs<T extends unknown[]>(args: T): T {
        return args.map((arg) => {
            if (typeof arg === "string" && arg.length > 1000) {
                return arg.substring(0, 1000) + "... [TRUNCATED]";
            }
            return arg;
        }) as T;
    }

    log(...args: Parameters<PinoLogger["info"]>) {
        this.logger.info(...(this.trimArgs(args) as any));
    }

    warn(...args: Parameters<PinoLogger["warn"]>) {
        this.logger.warn(...(this.trimArgs(args) as any));
    }

    error(...args: Parameters<PinoLogger["error"]>) {
        this.logger.error(...(this.trimArgs(args) as any));
    }

    debug(...args: Parameters<PinoLogger["debug"]>) {
        this.logger.debug(...(this.trimArgs(args) as any));
    }
}
