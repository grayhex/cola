import { z } from "zod";

// Client-safe limits shared by the editor and its private API.
export const gameImagePromptLimit = 8000;
export const gameImagePromptInput = z
  .object({
    prompt: z
      .string()
      .max(gameImagePromptLimit)
      .regex(
        /^(?:[^\p{Cc}]|[\t\n\r]|[\p{Cc}&&[^\p{ASCII}]])*$/v,
        "Недопустимые управляющие символы",
      ),
  })
  .strict();
