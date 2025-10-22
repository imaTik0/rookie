// deno-lint-ignore-file ban-types
export function IOCManualRegistration(constructor: Function) {
    constructor.prototype.manualRegistration = true;
}

export function isManualRegistrationSet(constructor: Function) {
    return !constructor.prototype.manualRegistration;
}
