import type { ManagedUserInput as ManagedUserInputType } from "./admin-validation.ts";
import type { Queryable } from "./db.ts";
import type { SiteSettings, SiteCatalog, SiteDefinition } from "./contracts.ts";
import { db } from "./db.ts";
import { defaultSettings, defaultCatalog } from "./site-defaults.ts";
import { migrateHeroGraphics } from "./hero-graphics.ts";
export async function getSite(query: Queryable = db): Promise<SiteDefinition> {
  const settings = await query.query<{
    value: Partial<SiteSettings>;
    version: number;
  }>("SELECT value,version FROM site_settings WHERE id=1");
  const catalog = await query.query<{
    value: Partial<SiteCatalog>;
    version: number;
  }>("SELECT value,version FROM site_catalog WHERE id=1");
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
      ...migrateHeroGraphics(stored),
      ...Object.fromEntries(
        Object.entries(stored).filter(
          ([key]) =>
            Object.hasOwn(defaultSettings, key) || key === "navigation",
        ),
      ),
      map,
    },
    catalog: {
      ...defaultCatalog,
      ...catalog.rows[0]?.value,
      categories: {
        ...defaultCatalog.categories,
        ...catalog.rows[0]?.value?.categories,
      },
    },
    settingsVersion: settings.rows[0]?.version || 1,
    catalogVersion: catalog.rows[0]?.version || 1,
  };
}
export async function audit(
  query: Queryable,
  actor: unknown,
  action: unknown,
  target: unknown,
) {
  await query.query(
    "INSERT INTO admin_audit(actor_id,action,target) VALUES($1,$2,$3)",
    [actor, action, target],
  );
}

export async function updateManagedUser(
  query: Queryable,
  actor: string,
  id: string,
  input: ManagedUserInputType,
) {
  // Serialize role changes to preserve at least one active administrator.
  await query.query<{ id: string }>(
    "SELECT id FROM users WHERE role='admin' ORDER BY id FOR UPDATE",
  );
  const { rows } = await query.query<{
    id: string;
    role: string;
    blocked: boolean;
  }>("SELECT id,role,blocked FROM users WHERE id=$1 FOR UPDATE", [id]);
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
    const admins = await query.query<{ id: string }>(
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
