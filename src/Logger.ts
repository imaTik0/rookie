import { pino, type Logger as PinoLogger } from "pino";

const baseLogger = pino({
  level: "info",
});

export class Logger {
  private readonly logger: PinoLogger;

  constructor(public name: string) {
    this.logger = baseLogger.child({ name: this.name });
  }

  log(...args: Parameters<PinoLogger["info"]>) {
    this.logger.info(...args);
  }

  warn(...args: Parameters<PinoLogger["warn"]>) {
    this.logger.warn(...args);
  }

  error(...args: Parameters<PinoLogger["error"]>) {
    this.logger.error(...args);
  }

  debug(...args: Parameters<PinoLogger["debug"]>) {
    this.logger.debug(...args);
  }

}
