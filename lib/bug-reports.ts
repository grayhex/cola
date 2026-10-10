import { z } from "zod";

export const bugReportInput = z
  .object({
    description: z.string().trim().min(1).max(4000),
    reproduction: z.string().trim().max(2000).default(""),
    contact: z.union([z.email().max(254), z.literal("")]).default(""),
    diagnostics: z
      .object({
        path: z
          .string()
          .max(500)
          .regex(/^\/(?!\/)[^?#\r\n]*$/),
        theme: z.enum(["light", "dark"]),
        width: z.number().int().min(1).max(20000),
        height: z.number().int().min(1).max(20000),
        browser: z
          .string()
          .max(80)
          .regex(/^[\w ./-]*$/),
      })
      .strict(),
  })
  .strict();
export type BugReportInput = z.infer<typeof bugReportInput>;

export async function allowBugReport(
  ipKey: string | null,
  userId: string | null,
  limit: (key: string, maximum: number) => Promise<boolean>,
) {
  if (ipKey && !(await limit("bug-reports:ip:" + ipKey, 5))) return false;
  if (userId && !(await limit("bug-reports:user:" + userId, 5))) return false;
  return limit("bug-reports:global", 100);
}
