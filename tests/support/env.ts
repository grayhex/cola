/**
 * An environment for a function that takes `env = process.env`: the variables
 * the test is about and nothing from the machine the test runs on.
 */
export function processEnv(
  values: Record<string, string> = {},
): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...values };
}
