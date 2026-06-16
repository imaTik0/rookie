// deno-lint-ignore-file ban-types no-prototype-builtins no-explicit-any
import "reflect-metadata";
import { getParamOverrides } from "./decorator.ts";

/** Lower-case the first character — class `FooBar` ⇒ binding name `fooBar`. */
function lowerFirst(name: string): string {
    return name ? name[0].toLowerCase() + name.slice(1) : name;
}

export type IOCFactory = (
    parent: unknown,
    parentName: string | null,
    name: string,
    props?: { [name: string]: unknown },
) => unknown;

export class ReflectUtils {
    static STRIP_COMMENTS = /((\/\/.*$)|(\/\*[\s\S]*?\*\/))/mg;
    static ARGUMENT_NAMES = /([^\s,]+)/g;

    static getClassConstructorParametersNamesCore(func: Function): string[] {
        const fnStr = func.toString().replace(ReflectUtils.STRIP_COMMENTS, "");
        const constructorIndex = fnStr.indexOf("constructor(");
        if (constructorIndex == -1) {
            const baseClass = fnStr.match(
                /class\s([a-zA-Z0-9]*)\sextends\s([a-zA-Z0-9]*)/,
            );
            return baseClass == null ? [] : ReflectUtils.getClassConstructorParametersNamesCore(
                Object.getPrototypeOf(func),
            );
        }
        const constructorPostIndex = constructorIndex + 12;
        const result = fnStr.slice(
            constructorPostIndex,
            fnStr.indexOf(")", constructorPostIndex),
        ).match(ReflectUtils.ARGUMENT_NAMES);
        return result === null ? [] : <string[]> result;
    }

    static getClassConstructorParametersNames(
        func: Function & { __constructorParametersNames?: string[] },
    ) {
        if (!func.hasOwnProperty("__constructorParametersNames")) {
            func.__constructorParametersNames = ReflectUtils
                .getClassConstructorParametersNamesCore(func);
        }
        return <string[]> func.__constructorParametersNames;
    }
}

export interface IOCEntry {
    value?: unknown;
    resolved: boolean;
    type?: { new (...args: any[]): unknown };
    factory?: IOCFactory;
}

export class IOC {
    protected map: { [name: string]: IOCEntry };
    /** Names currently mid-construction — used to detect circular dependencies. */
    private resolving = new Set<string>();

    constructor(private parent?: IOC) {
        this.map = {};
    }

    register(type: { new (...args: any[]): unknown }) {
        this.registerWithName(
            type.name[0].toLowerCase() + type.name.substr(1),
            type,
        );
    }

    registerWithName(name: string, type: { new (...args: any[]): unknown }) {
        if (name in this.map) {
            throw new Error(
                "Entry with name '" + name + "' already registered",
            );
        }
        this.map[name] = { value: null, resolved: false, type: type };
    }

    registerValue(name: string, value: unknown) {
        if (name in this.map) {
            throw new Error(
                "Entry with name '" + name + "' already registered",
            );
        }
        this.map[name] = { value: value, resolved: true };
    }

    registerFactory(name: string, factory: IOCFactory) {
        if (name in this.map) {
            throw new Error(
                "Entry with name '" + name + "' already registered",
            );
        }
        this.map[name] = { value: null, resolved: false, factory: factory };
    }

    resolve<T = unknown>(name: string): T {
        return this.resolveFor(name, null, null);
    }

    resolveFor<T = unknown>(
        name: string,
        parent: unknown,
        parentName: string | null,
    ): T {
        const entry = this.map[name];
        if (entry == null) {
            if (this.parent) {
                return this.parent.resolveFor(name, parent, parentName);
            }
            throw new Error("Entry with name '" + name + "' not registered");
        }
        if (entry.resolved) {
            return <T> entry.value;
        }
        if (entry.factory) {
            const result = entry.factory(parent, parentName, name);
            return <T> result;
        }
        if (entry.type) {
            if (this.resolving.has(name)) {
                throw new Error(
                    "Circular dependency detected: " + [...this.resolving, name].join(" -> "),
                );
            }
            this.resolving.add(name);
            try {
                const result = this.createCore(entry.type, name);
                entry.resolved = true;
                entry.value = result;
                return <T> result;
            } finally {
                this.resolving.delete(name);
            }
        }
        throw new Error("Invalid ioc entry");
    }

    /**
     * Constructor dependency binding-names. Prefers `design:paramtypes` reflection
     * metadata (emitted for any decorated class) — mapping each parameter type to
     * its binding name, with `@InjectParam` overrides for ambiguous types. Falls
     * back to source-text parsing for classes that carry no metadata.
     */
    private getConstructorDependencyNames(clazz: Function): string[] {
        const paramTypes = Reflect.getMetadata("design:paramtypes", clazz) as
            | Array<{ name?: string }>
            | undefined;
        if (!paramTypes) {
            return ReflectUtils.getClassConstructorParametersNames(clazz);
        }
        const overrides = getParamOverrides(clazz);
        return paramTypes.map((t, i) => overrides[i] ?? lowerFirst(t?.name ?? ""));
    }

    createCore<T = unknown>(
        clazz: { new (...args: unknown[]): T; postInjection?: boolean },
        clazzName: string,
        props?: { [name: string]: unknown },
    ): T {
        const parameters = this.getConstructorDependencyNames(clazz);
        const params: unknown[] = [];
        for (const param of parameters) {
            params.push(
                props && param in props ? props[param] : this.resolveFor(param, clazz, clazzName),
            );
        }
        if (
            Array.isArray(
                (<WithInjectInfo> clazz.prototype).__propertiesToInject,
            )
        ) {
            const injectMap: { [name: string]: unknown } = {};
            for (
                const propertyToInject of (<WithInjectInfo> clazz.prototype)
                    .__propertiesToInject
            ) {
                injectMap[propertyToInject.propertyKey] =
                    props && propertyToInject.dependencyName in props
                        ? props[propertyToInject.dependencyName]
                        : this.resolveFor(
                            propertyToInject.dependencyName,
                            clazz,
                            clazzName,
                        );
            }
            const result = createInjectable(clazz, params, injectMap);
            if (
                !(result instanceof Injectable) && clazz.postInjection !== false
            ) {
                // Post constructor injection
                for (const key in injectMap) {
                    (<any> result)[key] = injectMap[key];
                }
            }
            return result;
        }
        return new clazz(...params);
    }

    create<T = unknown>(name: string, props?: { [name: string]: unknown }): T {
        const entry = this.map[name];
        if (entry == null) {
            if (this.parent) {
                return this.parent.create(name, props);
            }
            throw new Error("Entry with name '" + name + "' not registered");
        }
        if (entry.factory) {
            const result = entry.factory(null, null, name, props);
            return <T> result;
        }
        if (entry.type) {
            return <T> this.createCore(entry.type, name, props);
        }
        throw new Error("Invalid ioc entry");
    }

    createEx<T>(
        clazz: { new (...args: any[]): T },
        props?: { [name: string]: unknown },
    ): T {
        return this.createCore(clazz, clazz.name, props);
    }

    getType(name: string): Function | null {
        const entry = this.map[name];
        if (entry == null) {
            if (this.parent) {
                return this.parent.getType(name);
            }
            throw new Error("Entry with name '" + name + "' not registered");
        }
        if (entry.type) {
            return entry.type;
        }
        return entry.value ? (<{ constructor: Function }> entry.value).constructor : null;
    }
}

export class Injectable {
    constructor() {
        injectVariables(this);
    }
}

export const InjecHelper: {
    TO_INJECT?: { [name: string]: unknown };
} = {};

export function injectVariables(obj: any) {
    if (InjecHelper.TO_INJECT) {
        for (const key in InjecHelper.TO_INJECT) {
            (<any> obj)[key] = InjecHelper.TO_INJECT[key];
        }
        delete InjecHelper.TO_INJECT;
    }
}

export function createInjectable<T>(
    clazz: { new (...args: unknown[]): T },
    params: unknown[],
    toInject: { [name: string]: unknown },
): T {
    try {
        InjecHelper.TO_INJECT = toInject;
        return new clazz(...params);
    } finally {
        delete InjecHelper.TO_INJECT;
    }
}

export interface PropertyToInject {
    propertyKey: string;
    dependencyName: string;
}

export interface WithInjectInfo {
    __propertiesToInject: (PropertyToInject[]) & { __for?: WithInjectInfo };
    __dependencies: string[];
}

export function InjectCore(t: unknown, property: PropertyToInject) {
    const target = <WithInjectInfo> t;
    if (!target.__propertiesToInject) {
        target.__propertiesToInject = [];
        target.__propertiesToInject.__for = target;
    } else {
        if (target.__propertiesToInject.__for !== target) {
            target.__propertiesToInject = target.__propertiesToInject.concat(
                [],
            );
            target.__propertiesToInject.__for = target;
        }
    }
    target.__propertiesToInject.push(property);
}

export function Inject(t: unknown, propertyKey: string) {
    InjectCore(t, { propertyKey: propertyKey, dependencyName: propertyKey });
}

export function InjectNamed(dependencyName: string) {
    return (t: unknown, propertyKey: string) => {
        InjectCore(t, {
            propertyKey: propertyKey,
            dependencyName: dependencyName,
        });
    };
}
