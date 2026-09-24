import { db } from "./db.js";
import { defaultSettings, defaultCatalog } from "./site-defaults.js";
export async function getSite(query = db) {
  const settings = await query.query(
    "SELECT value,version FROM site_settings WHERE id=1",
  );
  const catalog = await query.query(
    "SELECT value,version FROM site_catalog WHERE id=1",
  );
  const stored = settings.rows[0]?.value || {};
  const map = { ...defaultSettings.map, ...stored.map };
  if (!stored.map && process.env.MAP_STYLE_URL)
    Object.assign(map, {
      provider: "style",
      styleUrl: process.env.MAP_STYLE_URL,
    });
  return {
    settings: {
      ...defaultSettings,
      ...Object.fromEntries(
        Object.entries(stored).filter(
          ([key]) =>
            Object.hasOwn(defaultSettings, key) || key === "navigation",
        ),
      ),
      map,
    },
    catalog: { ...defaultCatalog, ...catalog.rows[0]?.value, categories: { ...defaultCatalog.categories, ...catalog.rows[0]?.value?.categories } },
    settingsVersion: settings.rows[0]?.version || 1,
    catalogVersion: catalog.rows[0]?.version || 1,
  };
}
export async function audit(query, actor, action, target) {
  await query.query(
    "INSERT INTO admin_audit(actor_id,action,target) VALUES($1,$2,$3)",
    [actor, action, target],
  );
}
/** @param {import("./admin-validation.js").ManagedUserInput} input */
export async function updateManagedUser(query, actor, id, input) {
  // Serialize role changes to preserve at least one active administrator.
  await query.query(
    "SELECT id FROM users WHERE role='admin' ORDER BY id FOR UPDATE",
  );
  const { rows } = await query.query(
    "SELECT id,role,blocked FROM users WHERE id=$1 FOR UPDATE",
    [id],
  );
  if (!rows[0]) return { error: "Пользователь не найден", status: 404 };
  if (id === actor && (input.blocked || input.role !== "admin"))
    return {
      error: "Нельзя заблокировать себя или снять собственные права",
      status: 409,
    };
  if (
    rows[0].role === "admin" &&
    !rows[0].blocked &&
    (input.blocked || input.role !== "admin")
  ) {
    const admins = await query.query(
      "SELECT id FROM users WHERE role='admin' AND blocked=false",
    );
    if (admins.rows.length <= 1)
      return {
        error: "Нужен хотя бы один активный администратор",
        status: 409,
      };
  }
  await query.query(
    "UPDATE users SET name=$1,email=$2,role=$3,blocked=$4 WHERE id=$5",
    [input.name, input.email, input.role, input.blocked, id],
  );
  // Revocation also covers role changes, so existing sessions cannot retain authority.
  await query.query("DELETE FROM sessions WHERE user_id=$1", [id]);
  await audit(query, actor, "user.update", id);
  return { ok: true };
}
