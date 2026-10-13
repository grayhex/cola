import type { APIRequestContext, APIResponse } from "@playwright/test";
export function capturedVerificationToken(email: string): Promise<string>;
export function verifyCapturedEmail(email: string): Promise<void>;
export function registerVerified(
  request: APIRequestContext,
  options: Parameters<APIRequestContext["post"]>[1] & {
    data: { email: string; [key: string]: unknown };
  },
): Promise<APIResponse>;
export const verifiedFetch: typeof fetch;
