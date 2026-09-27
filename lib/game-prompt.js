import { CommunityError } from "./community-validation.js";
import { gameImagePromptInput } from "./game-prompt-validation.js";
import { audit } from "./site.js";

// Call inside a transaction. A role/block change cannot race a prompt write.
async function requireAdmin(q, actorId) {
  const result = await q.query(
    "SELECT id FROM users WHERE id=$1 AND role='admin' AND NOT blocked FOR SHARE",
    [actorId],
  );
  if (!result.rows.length) throw new CommunityError("Доступ только для администратора", 403);
}

export async function getGameImagePrompt(q, actorId) {
  await requireAdmin(q, actorId);
  const result = await q.query("SELECT value->>'imagePrompt' AS prompt FROM gamification_settings WHERE id=1");
  return { prompt: result.rows[0]?.prompt || "" };
}

export async function saveGameImagePrompt(q, actorId, input) {
  await requireAdmin(q, actorId);
  const { prompt } = gameImagePromptInput.parse(input);
  // Only this key changes. Public gameSettings() deliberately projects its
  // own allowlist; the text never enters /site, records or account exports.
  await q.query(
    "UPDATE gamification_settings SET value=jsonb_set(value,'{imagePrompt}',to_jsonb($1::text)) WHERE id=1",
    [prompt],
  );
  await audit(q, actorId, "gamification.image_prompt", "1");
  return { prompt };
}
