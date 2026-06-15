// deno-lint-ignore-file ban-types

interface Scannable {
    __excludeFromScan?: boolean;
}

/**
 * Mark a class so the IoC auto-scanner skips it. Use on classes that are
 * registered manually in the Container (e.g. App, MigrationManager) to avoid a
 * duplicate-registration error.
 */
export function ExcludeFromScan(constructor: Function) {
    (constructor.prototype as Scannable).__excludeFromScan = true;
}

/** True when the auto-scanner should register this class (i.e. it is not excluded). */
export function shouldAutoRegister(constructor: Function): boolean {
    return !(constructor.prototype as Scannable)?.__excludeFromScan;
}
