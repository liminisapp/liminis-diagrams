// A promise-returning function in another module, so the probe can show that a
// floating promise is caught across an import as well as locally.
export async function fetchThing(): Promise<number> {
  return 1
}
