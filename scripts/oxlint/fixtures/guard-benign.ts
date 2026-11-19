// Look-alikes that must NOT trip the host-boundary guard.
interface Client { api: string }
declare const someService: object
declare const other: { window: { api: string } }
declare const window: { document: unknown; location: unknown }

export const a = (someService as unknown as { api: Client }).api
export const b = other.window.api
export const c = window.document
export const d = (window as unknown as { document: unknown }).document
export const e = { api: 1 }.api
