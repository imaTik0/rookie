import { type Logger as PinoLogger, pino } from "pino";

const baseLogger = pino({
    level: "info",
});

type LoggerParams = Parameters<PinoLogger["info"]>;

export class Logger {
    private readonly logger: PinoLogger;

    constructor(public name: string) {
        this.logger = baseLogger.child({ name: this.name });
    }

    private trimArgs(args: LoggerParams): LoggerParams {
        return args.map((arg) => {
            if (typeof arg === "string" && arg.length > 1000) {
                return arg.substring(0, 1000) + "... [TRUNCATED]";
            }
            return arg;
        }) as LoggerParams;
    }

    log(...args: LoggerParams) {
        const trimmed = this.trimArgs(args);
        (this.logger.info as any)(...trimmed);
    }

    warn(...args: LoggerParams) {
        const trimmed = this.trimArgs(args);
        (this.logger.warn as any)(...trimmed);
    }

    error(...args: LoggerParams) {
        const trimmed = this.trimArgs(args);
        (this.logger.error as any)(...trimmed);
    }

    debug(...args: LoggerParams) {
        const trimmed = this.trimArgs(args);
        (this.logger.debug as any)(...trimmed);
    }
}
