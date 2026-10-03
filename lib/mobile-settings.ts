import { createHash } from "node:crypto";
import { z } from "zod";
import type { AppConfig } from "./api-v1/schemas.ts";
import { chatConfig } from "./chat-config.ts";
import type { Queryable } from "./db.ts";
import { assetFormat } from "./hero-graphics.ts";
import {
  changedBlocks,
  confirmationsNeeded,
  defaultLinks,
  mobileAssetIds,
  mobileFeatures,
  mobileLinkHref,
  mobileSettingsProblems,
  mobileSettingsSchema,
  storedMobileSettings,
} from "./mobile-config.ts";
import type {
  MobileConfirmation,
  MobileGate,
  MobileLinkKey,
  MobileProblem,
} from "./mobile-config.ts";
import { nativeAuthReturnUrl } from "./native-auth.ts";
import { publicOrigin } from "./public-urls.ts";
import { yandexIdConfig } from "./yandex-id.ts";

// Storage and the public form of the native app settings (#338). The admin
// edits one versioned row; GET /api/v1/app-config answers an allowlisted DTO
// built from it, so nothing an admin stores reaches an app by accident.

export class MobileSettingsError extends Error {
  declare status: number;
  declare code: string;
  declare problems?: MobileProblem[];
  declare confirm?: MobileConfirmation[];
  constructor(
    status: number,
    code: string,
    message: string,
    extra: { problems?: MobileProblem[]; confirm?: MobileConfirmation[] } = {},
  ) {
    super(message);
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
}

interface MobileRow {
  value: unknown;
  version: number;
  onboarding_revision: number;
  notice_revision: number;
  updated_at: Date;
}
const columns = "value,version,onboarding_revision,notice_revision,updated_at";

async function readRow(q: Queryable): Promise<MobileRow> {
  const { rows } = await q.query<MobileRow>(
    `SELECT ${columns} FROM mobile_settings WHERE id=1`,
  );
  // The migration creates the row; without it the app gets the defaults.
  return (
    rows[0] || {
      value: {},
      version: 1,
      onboarding_revision: 1,
      notice_revision: 1,
      updated_at: new Date(0),
    }
  );
}

/** Whether the server itself can serve the features that need configuration. */
export function mobileReadiness(
  env = process.env,
): Record<MobileGate, boolean> {
  return {
    chat: !!chatConfig(env),
    yandex: !!yandexIdConfig(env) && !!nativeAuthReturnUrl(env),
  };
}

const assetPath = (id: string | null) => (id ? "/api/assets/" + id : null);

/** The public DTO: only allowlisted fields, links absolute, gates applied. */
export function appConfigOf(row: MobileRow, env = process.env): AppConfig {
  const settings = storedMobileSettings(row.value);
  const origin = publicOrigin(env);
  // Links are checked again on every read: after a change of the site address
  // a stored link falls back to its default instead of leading somewhere
  // nobody approved.
  const href = (value: string | null) =>
    value === null
      ? null
      : mobileLinkHref(value, origin, settings.externalHosts);
  const link = (key: MobileLinkKey) => href(settings.links[key]);
  const site = (path: string) => new URL(path, origin).href;
  const readiness = mobileReadiness(env);
  const available = (key: string) => {
    const gate = mobileFeatures.find((feature) => feature.key === key)?.gate;
    return gate ? readiness[gate] : true;
  };
  const { launch, onboarding, notice, compatibility } = settings;
  const launchOn = launch.enabled && !!launch.assetId;
  const onboardingOn = onboarding.enabled && onboarding.items.length > 0;
  const actionUrl = href(notice.actionUrl);
  const updateUrl = href(compatibility.updateUrl);
  const minimum = compatibility.minimumSupportedVersionCode;
  // Without its update address or minimum the hard mode degrades to the soft
  // one rather than locking people in an app with no way out.
  const hard =
    compatibility.updateMode === "hard" && !!updateUrl && minimum !== null;
  return {
    revision: row.version,
    updatedAt: new Date(row.updated_at).toISOString(),
    launch: {
      enabled: launchOn,
      imageUrl: launchOn ? assetPath(launch.assetId) : null,
      contentMode: launch.contentMode,
      title: launchOn ? launch.title : null,
    },
    onboarding: {
      enabled: onboardingOn,
      revision: row.onboarding_revision,
      items: onboardingOn
        ? onboarding.items.map((item) => ({
            title: item.title,
            body: item.body,
            imageUrl: assetPath(item.assetId),
          }))
        : [],
    },
    notice:
      notice.enabled && notice.title
        ? {
            revision: row.notice_revision,
            kind: notice.kind,
            title: notice.title,
            body: notice.body,
            imageUrl: assetPath(notice.assetId),
            action:
              notice.actionLabel && actionUrl
                ? { label: notice.actionLabel, url: actionUrl }
                : null,
          }
        : null,
    links: {
      help: link("help") ?? site(defaultLinks.help),
      privacy: link("privacy") ?? site(defaultLinks.privacy),
      terms: link("terms") ?? site(defaultLinks.terms),
      about: link("about") ?? site(defaultLinks.about),
      support: link("support"),
    },
    features: Object.fromEntries(
      Object.entries(settings.features).map(([key, on]): [string, boolean] => [
        key,
        on && available(key),
      ]),
    ),
    compatibility: {
      minimumSupportedVersionCode: minimum,
      latestVersionCode: compatibility.latestVersionCode,
      updateMode: hard ? "hard" : "soft",
      updateUrl,
      updateMessage: compatibility.updateMessage,
    },
  };
}

/** GET /api/v1/app-config reads this. */
export async function appConfig(q: Queryable, env = process.env) {
  return appConfigOf(await readRow(q), env);
}

/** A strong validator of the exact answer, server configuration included. */
export const appConfigEtag = (config: AppConfig) =>
  `"app-config-${createHash("sha256")
    .update(JSON.stringify(config))
    .digest("base64url")
    .slice(0, 32)}"`;

function adminView(row: MobileRow, env: NodeJS.ProcessEnv) {
  return {
    value: storedMobileSettings(row.value),
    version: row.version,
    updatedAt: new Date(row.updated_at),
    revisions: {
      onboarding: row.onboarding_revision,
      notice: row.notice_revision,
    },
    readiness: mobileReadiness(env),
    origin: publicOrigin(env),
    // Exactly what apps receive now: the editor shows it next to the draft.
    published: appConfigOf(row, env),
  };
}

/** The editor's data: the stored value, its version and what apps get now. */
export async function adminMobileSettings(q: Queryable, env = process.env) {
  return adminView(await readRow(q), env);
}

const saveInput = z.strictObject({
  value: mobileSettingsSchema,
  version: z.int().positive(),
  confirm: z
    .strictObject({
      hardUpdate: z.boolean().optional(),
      maintenance: z.boolean().optional(),
    })
    .prefault({}),
  // A small fix may keep the revision, so people who saw the block are not
  // shown it again.
  keepRevision: z
    .strictObject({
      onboarding: z.boolean().optional(),
      notice: z.boolean().optional(),
    })
    .prefault({}),
});

type Audit = (
  q: Queryable,
  actor: string,
  action: string,
  target: string,
) => Promise<unknown>;

/**
 * Saves the settings with optimistic concurrency. Runs inside a transaction:
 * the row is locked first, then every named asset in sorted order (FOR SHARE,
 * the order cleanup takes FOR UPDATE), so an asset cannot be deleted between
 * this check and the commit.
 */
export async function saveMobileSettings(
  q: Queryable,
  actor: string,
  input: unknown,
  audit: Audit,
  env = process.env,
) {
  const body = saveInput.parse(input);
  const problems = mobileSettingsProblems(body.value, publicOrigin(env));
  if (problems.length)
    throw new MobileSettingsError(
      400,
      "invalid_settings",
      "Проверьте поля: " + problems.map((p) => p.message).join("; "),
      { problems },
    );
  const { rows } = await q.query<MobileRow>(
    `SELECT ${columns} FROM mobile_settings WHERE id=1 FOR UPDATE`,
  );
  const row = rows[0];
  if (!row) throw new Error("mobile_settings row is missing");
  if (row.version !== body.version)
    throw new MobileSettingsError(
      409,
      "version_conflict",
      "Настройки приложения уже изменил другой администратор. Обновите данные и повторите изменения.",
    );
  const before = storedMobileSettings(row.value);
  const missing = confirmationsNeeded(before, body.value).filter(
    (key) => body.confirm[key] !== true,
  );
  if (missing.length)
    throw new MobileSettingsError(
      428,
      "confirmation_required",
      missing.includes("hardUpdate")
        ? "Подтвердите обязательное обновление: старые версии приложения перестанут открываться."
        : "Подтвердите публикацию сообщения о технических работах.",
      { confirm: missing },
    );
  for (const id of mobileAssetIds(body.value)) {
    const asset = await q.query<{ filename: string }>(
      "SELECT filename FROM site_assets WHERE id=$1 FOR SHARE",
      [id],
    );
    if (!asset.rows[0])
      throw new MobileSettingsError(
        409,
        "asset_missing",
        "Выбранное изображение удалено из медиатеки. Выберите другое.",
      );
    if (assetFormat(asset.rows[0].filename) !== "image")
      throw new MobileSettingsError(
        400,
        "asset_format",
        "Для приложения выберите PNG, JPEG или WebP: SVG и Rive не поддерживаются.",
      );
  }
  const version = row.version + 1;
  const changed = changedBlocks(before, body.value);
  const revision = (block: "onboarding" | "notice", current: number) =>
    changed[block] && !body.keepRevision[block] ? version : current;
  const updated = await q.query<MobileRow>(
    `UPDATE mobile_settings SET value=$1,version=$2,onboarding_revision=$3,notice_revision=$4,updated_at=now() WHERE id=1 AND version=$5 RETURNING ${columns}`,
    [
      JSON.stringify(body.value),
      version,
      revision("onboarding", row.onboarding_revision),
      revision("notice", row.notice_revision),
      row.version,
    ],
  );
  await audit(q, actor, "mobile.update", String(version));
  return adminView(updated.rows[0], env);
}

/** Whether the app settings name this asset (deletion is refused then). */
export async function mobileAssetInUse(q: Queryable, id: string) {
  const { rows } = await q.query<{ value: unknown }>(
    "SELECT value FROM mobile_settings WHERE id=1",
  );
  return mobileAssetIds(rows[0]?.value).includes(id.toLowerCase());
}
