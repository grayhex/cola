import { z } from "zod";

// Client-safe limits shared by the editor and its private API.
export const gameImagePromptLimit = 8000;
export const gameImagePromptInput = z
  .object({
    prompt: z
      .string()
      .max(gameImagePromptLimit)
      // C0/DEL rejection is intentional; preserve the legacy pattern and browser support.
      .regex(
        new RegExp(
          String.raw`^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$`,
        ),
        "Недопустимые управляющие символы",
      ),
  })
  .strict();
