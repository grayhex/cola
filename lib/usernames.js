// Readable usernames (#71). Pure and dependency-free: the registration form
// suggests the same handle the server allocates when a client sends none.
export const usernamePattern = /^[a-z0-9._-]{3,30}$/;
// db/009_social_core.sql enforces the same list with a CHECK constraint.
export const reservedUsernames = new Set([
  "admin",
  "api",
  "account",
  "login",
  "logout",
  "register",
  "settings",
  "b",
  "u",
  "me",
  "social",
  "profiles",
  "assets",
  "avatars",
  "health",
  "ready",
  "status",
  "support",
  "help",
  "about",
  "system",
  "colabike",
]);
// Default of users.username for accounts created without one.
const generated = /^rider-[0-9a-f]{24}$/;
// prettier-ignore
const letters = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh",
  щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  і: "i", ї: "yi", є: "ye", ґ: "g", ў: "u",
};
const edgeSeparators = /^[-._]+|[-._]+$/g;

export function isGeneratedUsername(username) {
  return generated.test(String(username || ""));
}
// "Иван Петров" → "ivan-petrov"; "" when too little is left for a username.
export function usernameFrom(value) {
  // Cyrillic first: NFKD would split "й" and "ё" into a base letter and a mark.
  const latin = Array.from(
    String(value ?? "")
      .normalize("NFC")
      .toLowerCase(),
    (c) => letters[c] ?? c,
  )
    .join("")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");
  const handle = latin
    .replace(/[^a-z0-9]+/g, "-")
    .replace(edgeSeparators, "")
    .slice(0, 30)
    .replace(edgeSeparators, "");
  return handle.length >= 3 ? handle : "";
}
// The display name first, then the address before "@" and any "+tag".
export function suggestUsername(name, email = "", fallback = "rider") {
  const local = String(email).split("@")[0].split("+")[0];
  return usernameFrom(name) || usernameFrom(local) || fallback;
}
// "base", "base-2", "base-3"… trimmed to 30 characters.
export function usernameCandidates(base, count = 50) {
  const list = [base];
  for (let n = 2; list.length < count; n++) {
    const suffix = "-" + n;
    const stem = base.slice(0, 30 - suffix.length).replace(edgeSeparators, "");
    list.push((stem || "rider") + suffix);
  }
  return [...new Set(list)].filter(
    (c) => usernamePattern.test(c) && !reservedUsernames.has(c),
  );
}
// First free candidate in one indexed query. The unique index still decides
// races, so a caller that inserts the result retries on a username conflict.
export async function allocateUsername(q, base) {
  const candidates = usernameCandidates(base);
  const { rows } = await q.query(
    "SELECT lower(username) AS username FROM users WHERE lower(username)=ANY($1::text[])",
    [candidates],
  );
  const taken = new Set(rows.map((r) => r.username));
  const free = candidates.find((c) => !taken.has(c));
  if (free) return free;
  const stem = base.slice(0, 23).replace(edgeSeparators, "") || "rider";
  return stem + "-" + String(Math.floor(Math.random() * 1e6)).padStart(6, "0");
}
// Cards show a person by name; the handle is secondary and never the
// meaningless default.
export function personName(person) {
  return person?.name || usernameLabel(person) || "Райдер";
}
export function usernameLabel(person) {
  const username = person?.username;
  return username && !isGeneratedUsername(username) ? "@" + username : "";
}
