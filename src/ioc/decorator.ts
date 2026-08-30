// deno-lint-ignore-file ban-types
import "reflect-metadata";

interface Scannable {
    __excludeFromScan?: boolean;
}

export function ExcludeFromScan(constructor: Function) {
    (constructor.prototype as Scannable).__excludeFromScan = true;
}

export function shouldAutoRegister(constructor: Function): boolean {
    return !(constructor.prototype as Scannable)?.__excludeFromScan;
}

export function Injectable(): (constructor: Function) => void {
    return () => {};
}

const PARAM_OVERRIDES = "ioc:paramOverrides";

export function InjectParam(name: string) {
    return (target: object, _propertyKey: string | symbol | undefined, parameterIndex: number) => {
        const existing =
            (Reflect.getOwnMetadata(PARAM_OVERRIDES, target) as Record<number, string>) ?? {};
        existing[parameterIndex] = name;
        Reflect.defineMetadata(PARAM_OVERRIDES, existing, target);
    };
}

export function getParamOverrides(constructor: Function): Record<number, string> {
    return (Reflect.getOwnMetadata(PARAM_OVERRIDES, constructor) as Record<number, string>) ?? {};
}
