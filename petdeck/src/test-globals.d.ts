// Minimal ambient types for the Node 24 built-in test runner/assert subset used
// by this repo's tests, so `tsc --noEmit` (which now covers test files) passes
// without adding @types/node. Keep in sync with actual imports from 'node:test'
// / 'node:assert/strict'.
declare module 'node:test' {
  export interface TestContext {
    after(fn: () => void): void
  }
  export function test(name: string, fn: (t: TestContext) => void | Promise<void>): void
}

declare module 'node:assert/strict' {
  interface AssertStrict {
    equal(actual: unknown, expected: unknown, message?: string): void
    deepEqual(actual: unknown, expected: unknown, message?: string): void
    ok(value: unknown, message?: string): asserts value
    rejects(promise: Promise<unknown>, expected?: RegExp | Error, message?: string): Promise<void>
  }
  const assert: AssertStrict
  export default assert
}

// server/tiers.mjs is plain JS outside the TS project root — declare the export
// this repo's parity test imports.
declare module '*/server/tiers.mjs' {
  export function handoffPackage(h?: { from?: string; context?: string; instruction?: string; artifacts?: string[] }): string
}
