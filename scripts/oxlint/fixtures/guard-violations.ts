// Every spelling of the host-boundary reach-in. Each line must fail lint.
declare const window: any

export const dotted = window.api.x
export const optional = globalThis?.api?.x
export const computed = window['api'].x
export const computedOptional = globalThis?.['api']
export const cast = (window as { api: unknown }).api
export const doubleCast = (window as unknown as { api: unknown }).api
export const castComputed = (globalThis as unknown as Record<string, unknown>)['api']
