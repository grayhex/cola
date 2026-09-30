export function errorCode(error: unknown): string | undefined {
  return error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}
export function errorStatus(error: unknown): number | undefined {
  return error !== null &&
    typeof error === "object" &&
    "status" in error &&
    typeof error.status === "number"
    ? error.status
    : undefined;
}
export function errorMessage(error: unknown): string {
  return error !== null &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
    ? error.message
    : "";
}
export function errorConstraint(error: unknown): string | undefined {
  return error !== null &&
    typeof error === "object" &&
    "constraint" in error &&
    typeof error.constraint === "string"
    ? error.constraint
    : undefined;
}
