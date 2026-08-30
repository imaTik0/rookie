import "reflect-metadata";
import { assert, assertEquals, assertThrows } from "@std/assert";
import { IOC, ReflectUtils } from "./IOC.ts";
import { Injectable, InjectParam } from "./decorator.ts";

Deno.test("getClassConstructorParametersNames reads constructor params", () => {
    class A {
        constructor(public foo: unknown, public bar: unknown) {}
    }
    assertEquals(ReflectUtils.getClassConstructorParametersNames(A), ["foo", "bar"]);
});

Deno.test("getClassConstructorParametersNames returns [] for a no-arg class", () => {
    class A {}
    assertEquals(ReflectUtils.getClassConstructorParametersNames(A), []);
});

Deno.test("getClassConstructorParametersNames caches on the constructor", () => {
    class A {
        constructor(public x: unknown) {}
    }
    const first = ReflectUtils.getClassConstructorParametersNames(A);
    const second = ReflectUtils.getClassConstructorParametersNames(A);
    assertEquals(first, second);
    assert("__constructorParametersNames" in A);
});

Deno.test("register lowercases the first letter of the class name", () => {
    const ioc = new IOC();
    class FooService {}
    ioc.register(FooService);
    assert(ioc.resolve("fooService") instanceof FooService);
});

Deno.test("resolve wires constructor dependencies by parameter name", () => {
    const ioc = new IOC();
    class Repo {
        value = 42;
    }
    class Service {
        constructor(public repo: Repo) {}
    }
    ioc.register(Repo);
    ioc.register(Service);
    const svc = ioc.resolve<Service>("service");
    assert(svc.repo instanceof Repo);
    assertEquals(svc.repo.value, 42);
});

Deno.test("type registrations resolve as singletons", () => {
    const ioc = new IOC();
    class Service {}
    ioc.register(Service);
    assertEquals(ioc.resolve("service"), ioc.resolve("service"));
});

Deno.test("registerValue returns the exact instance", () => {
    const ioc = new IOC();
    const value = { hello: "world" };
    ioc.registerValue("thing", value);
    assertEquals(ioc.resolve("thing"), value);
});

Deno.test("registerFactory invokes the factory with parent context", () => {
    const ioc = new IOC();
    class Consumer {
        constructor(public logger: unknown) {}
    }
    ioc.registerFactory("logger", (_parent, _parentName, name) => ({ name }));
    ioc.register(Consumer);
    const c = ioc.resolve<Consumer>("consumer");
    assertEquals(c.logger, { name: "logger" });
});

Deno.test("duplicate registration throws", () => {
    const ioc = new IOC();
    ioc.registerValue("dup", 1);
    assertThrows(() => ioc.registerValue("dup", 2), Error, "already registered");
});

Deno.test("resolving an unregistered name throws", () => {
    const ioc = new IOC();
    assertThrows(() => ioc.resolve("missing"), Error, "not registered");
});

Deno.test("create(name, props) overrides a named dependency", () => {
    const ioc = new IOC();
    class Repo {
        value = 1;
    }
    class Service {
        constructor(public repo: Repo) {}
    }
    ioc.register(Repo);
    ioc.register(Service);
    const overridden = ioc.create<Service>("service", { repo: { value: 99 } });
    assertEquals((overridden.repo as { value: number }).value, 99);
});

Deno.test("resolves @Injectable constructor deps by TYPE metadata, not param name", () => {
    const ioc = new IOC();
    @Injectable()
    class MetaDep {
        v = 7;
    }
    @Injectable()
    class MetaSvc {
        constructor(public anything: MetaDep) {}
    }
    ioc.register(MetaDep);
    ioc.register(MetaSvc);
    const svc = ioc.resolve<MetaSvc>("metaSvc");
    assert(svc.anything instanceof MetaDep);
    assertEquals(svc.anything.v, 7);
});

Deno.test("@InjectParam overrides the resolved binding name for a parameter", () => {
    const ioc = new IOC();
    @Injectable()
    class Unused {}
    @Injectable()
    class WithOverride {
        constructor(@InjectParam("customDep") public dep: Unused) {}
    }
    ioc.registerValue("customDep", { marker: true });
    ioc.register(WithOverride);
    const o = ioc.resolve<WithOverride>("withOverride");
    assertEquals((o.dep as { marker: boolean }).marker, true);
});

Deno.test("resolve throws on a circular dependency (with the chain)", () => {
    const ioc = new IOC();
    class CycA {
        constructor(public cycB: unknown) {}
    }
    class CycB {
        constructor(public cycA: unknown) {}
    }
    ioc.register(CycA);
    ioc.register(CycB);
    assertThrows(() => ioc.resolve("cycA"), Error, "Circular dependency");
});
