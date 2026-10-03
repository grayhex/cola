// Negative tests hand a service what its type forbids: a guest where an id is
// asked for, a malformed body, a column that does not exist. They say so here,
// in one greppable place, instead of casting through `unknown` or `any` at
// every call; the production signature stays as strict as it is.

/**
 * A value of the wrong kind, on purpose, typed as the parameter it is passed
 * as. Use it only where the test is about what the code does with that value
 * at runtime, e.g. `intentDetail(db, invalid<string>(null), id)` for a guest.
 */
export function invalid<Expected>(value: unknown): Expected {
  return value as Expected;
}
