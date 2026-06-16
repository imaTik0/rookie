// deno-lint-ignore-file ban-types
import "reflect-metadata";

interface Scannable {
    __excludeFromScan?: boolean;
}

/**
 * Mark a class so the IoC auto-scanner skips it. Use on classes that are
 * registered manually in the Container (e.g. App, MigrationManager) or are not
 * IoC-managed at all (e.g. PromptService's internal collaborators), to avoid a
 * duplicate-registration error or a spurious registration.
 */
export function ExcludeFromScan(constructor: Function) {
    (constructor.prototype as Scannable).__excludeFromScan = true;
}

/** True when the auto-scanner should register this class (i.e. it is not excluded). */
export function shouldAutoRegister(constructor: Function): boolean {
    return !(constructor.prototype as Scannable)?.__excludeFromScan;
}

/**
 * Marks a class as IoC-injectable. Its only job is to be *a* class decorator:
 * with `emitDecoratorMetadata`, the presence of any decorator makes the compiler
 * emit `design:paramtypes` for the constructor, which the IoC reads to resolve
 * dependencies by type (no brittle source-text parsing). Controllers get this for
 * free from `@Controller`.
 */
export function Injectable(): (constructor: Function) => void {
    return () => {};
}

const PARAM_OVERRIDES = "ioc:paramOverrides";

/**
 * Override the IoC name resolved for a single constructor parameter. Needed when
 * the parameter's type does not uniquely identify the binding — e.g. two distinct
 * `OpenAI` instances registered as "openai" and "openaiEmbedding".
 */
export function InjectParam(name: string) {
    return (target: object, _propertyKey: string | symbol | undefined, parameterIndex: number) => {
        const existing =
            (Reflect.getOwnMetadata(PARAM_OVERRIDES, target) as Record<number, string>) ?? {};
        existing[parameterIndex] = name;
        Reflect.defineMetadata(PARAM_OVERRIDES, existing, target);
    };
}

/** Read the per-parameter name overrides declared via `@InjectParam`. */
export function getParamOverrides(constructor: Function): Record<number, string> {
    return (Reflect.getOwnMetadata(PARAM_OVERRIDES, constructor) as Record<number, string>) ?? {};
}
