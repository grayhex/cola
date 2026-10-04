"use client";
import { errorMessage } from "../../lib/errors.ts";
import type {
  ApiError,
  CurrentUser,
  ViewerDto,
  PublicAuthor,
  Relationship,
  FollowPageDto,
} from "../../lib/contracts.ts";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Heart } from "./icons.tsx";
import GlobalHeader from "./global-header.tsx";
import { useSite } from "./site-provider.tsx";
import footerStyles from "./site-footer.module.css";
import Versions from "./versions.tsx";
import { footerSlots, footerLinkHref } from "../../lib/design-graphics.ts";
import { profilePath } from "../../lib/public-urls.ts";
import { personName, usernameLabel } from "../../lib/usernames.ts";
// `keepalive` lets a small mutation finish when the reader leaves the page
// right after a click; its total body size is limited, so it is opt-in.
export async function socialApi<T = unknown>(
  path: string,
  method = "GET",
  data?: unknown,
  { keepalive }: { keepalive?: boolean } = {},
): Promise<T> {
  const response = await fetch("/api/" + path, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    cache: "no-store",
    ...(keepalive ? { keepalive: true } : {}),
  });
  const result: T & Partial<ApiError> = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(result.error || "Не удалось выполнить запрос"),
      { status: response.status, code: result.code },
    );
  return result;
}
// Returned by a handler that has just started a full navigation: whoever awaits
// the handler (the sign-in form rereading its documents) waits while the page is
// replaced. A request started then is only cancelled, and WebKit dropped the
// navigation together with it.
export function leavingPage(): Promise<never> {
  return new Promise<never>(() => {});
}
import { Avatar } from "./avatar.tsx";
export { Avatar } from "./avatar.tsx";
// Links to /@username are not prefetched: Next 16 guesses the route of a
// second profile from the first one, keys its metadata with the raw "@" while
// the server answers for "%40", and then refetches that metadata in a tight
// loop. Navigation on click is unaffected.
export function AuthorLink({ author }: { author?: PublicAuthor | null }) {
  if (!author?.username) return null;
  return (
    <Link
      prefetch={false}
      className="card-author author-link"
      href={profilePath(author.username)}
      title={usernameLabel(author) || undefined}
    >
      <Avatar person={author} size="tiny" />
      <span>{personName(author)}</span>
    </Link>
  );
}
export function SocialHeader({
  user,
}: {
  user?: ViewerDto | CurrentUser | null;
}) {
  return <GlobalHeader user={user} />;
}
// A footer logo's accessible name: where the link goes.
function logoLinkName(href: string) {
  if (!/^https?:/i.test(href)) return "Страница " + href;
  let host = href;
  try {
    host = new URL(href).hostname.replace(/^www\./, "");
  } catch {
    // Keep the supplied address as the accessible label if URL parsing fails.
  }
  return "Сайт " + host + " (откроется в новой вкладке)";
}
// One line (#124): up to four logos, ColaBike in the middle of the page,
// app and parser versions. Section links live in the header only.
export function SocialFooter() {
  const { settings, t } = useSite();
  const creditsHref = footerLinkHref(settings.graphicsCreditsUrl);
  const logos = footerSlots
    .map((slot) => ({
      id: settings[slot.key],
      href: footerLinkHref(settings[slot.linkKey]),
    }))
    .filter((logo) => logo.id);
  return (
    <footer className={footerStyles.footer}>
      <div className={footerStyles.inner}>
        <div className={footerStyles.logos} data-footer-images>
          {logos.map(({ id, href }, i) => {
            // Logos from Админка → Дизайн → Графика → «Подвал» (#107).
            const image = (
              <img
                src={"/api/assets/" + id}
                alt=""
                width={200}
                height={100}
                loading="lazy"
                decoding="async"
              />
            );
            if (!href)
              return (
                <span key={i} className={footerStyles.logo}>
                  {image}
                </span>
              );
            const external = /^https?:/i.test(href);
            return (
              <a
                key={i}
                className={footerStyles.logo}
                href={href}
                aria-label={logoLinkName(href)}
                {...(external
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
              >
                {image}
              </a>
            );
          })}
        </div>
        <p className={footerStyles.brandLine}>
          <Link className={footerStyles.brand} href="/">
            ColaBike
          </Link>
          <span>{t("Люди. Велосипеды. Истории.")}</span>
        </p>
        <div className={footerStyles.versions}>
          <Versions link={false} />
          {creditsHref && (
            <a href={creditsHref}>{settings.graphicsCreditsLabel}</a>
          )}
          <details className={footerStyles.credits}>
            <summary>
              {creditsHref ? "Лицензии графики" : settings.graphicsCreditsLabel}
            </summary>
            <p>
              <a href="https://rive.app/marketplace/2008-3976-riding-bike/">
                Riding Bike — rahiqueo
              </a>
              ;{" "}
              <a href="https://rive.app/marketplace/9084-17312-transparent-bike-animation/">
                Transparent Bike Animation — lorins
              </a>
              , на основе{" "}
              <a href="https://rive.app/marketplace/3256-6872-bike-icon/">
                Bike Icon — JcToon
              </a>
              .{" "}
              <a href="https://creativecommons.org/licenses/by/4.0/">
                CC BY 4.0
              </a>
              . Палитра адаптирована для ColaBike, фон второй анимации убран.
            </p>
          </details>
        </div>
      </div>
    </footer>
  );
}
export function FollowButton({
  profile,
  user,
  onChange,
}: {
  profile: PublicAuthor & { relationship: Relationship };
  user?: ViewerDto | null;
  onChange: (relationship: Relationship) => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [optimisticFollowing, setOptimisticFollowing] = useState<boolean | null>(
      null,
    ),
    [error, setError] = useState("");
  const following = optimisticFollowing ?? profile.relationship?.following;
  if (profile.relationship?.isSelf)
    return (
      <Link className="button secondary small" href="/account?tab=profile">
        Изменить профиль
      </Link>
    );
  if (!user)
    return (
      <Link className="button small" href="/account">
        Войти, чтобы подписаться
      </Link>
    );
  return (
    <div className="follow-control">
      <button
        className={"button small " + (following ? "secondary" : "")}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          const before = following;
          setOptimisticFollowing(!before);
          try {
            const result = await socialApi<{ relationship: Relationship }>(
              "social/profiles/" + profile.username + "/follow",
              before ? "DELETE" : "PUT",
              undefined,
              { keepalive: true },
            );
            setOptimisticFollowing(result.relationship.following);
            await onChange(result.relationship);
          } catch (e) {
            setOptimisticFollowing(before);
            setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {following ? "Отписаться" : "Подписаться"}
      </button>
      {profile.relationship?.friends && (
        <span className="friend-status">
          <Heart size={13} />
          Друзья
        </span>
      )}
      {profile.relationship?.followedBy && !profile.relationship?.friends && (
        <span className="friend-status">Подписан на вас</span>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
export function Pagination({
  page,
  total,
  pageSize,
  onPage,
}: {
  page: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
}) {
  return (
    total > pageSize && (
      <nav className="pager" aria-label="Страницы">
        <button
          className="button secondary small"
          disabled={page === 1}
          onClick={() => onPage(page - 1)}
        >
          Назад
        </button>
        <span>
          {page} / {Math.ceil(total / pageSize)}
        </span>
        <button
          className="button secondary small"
          disabled={page * pageSize >= total}
          onClick={() => onPage(page + 1)}
        >
          Далее
        </button>
      </nav>
    )
  );
}
export function PeopleList({
  username,
  kind,
  user,
  onChange,
}: {
  username: string;
  kind: string;
  user?: ViewerDto | null;
  onChange?: () => void | Promise<void>;
}) {
  const [data, setData] = useState<FollowPageDto | null>(null),
    [page, setPage] = useState(1),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    setData(null);
    setError("");
    socialApi<FollowPageDto>(
      "social/profiles/" + username + "/" + kind + "?page=" + page,
    )
      .then((d) => {
        if (current) setData(d);
      })
      .catch((e) => {
        if (current) setError(errorMessage(e));
      });
    return () => {
      current = false;
    };
  }, [username, kind, page, revision]);
  if (error)
    return (
      <p role="alert" className="error">
        {error}
      </p>
    );
  if (!data) return <p role="status">Загружаем список…</p>;
  return (
    <>
      <ul className="people-list">
        {data.users.map((person) => (
          <li key={person.id}>
            <a className="person-identity" href={profilePath(person.username)}>
              <Avatar person={person} />
              <span>
                <strong>{personName(person)}</strong>
                {usernameLabel(person) && (
                  <small>{usernameLabel(person)}</small>
                )}
              </span>
            </a>
            <FollowButton
              profile={person}
              user={user}
              onChange={async () => {
                setRevision((r) => r + 1);
                await onChange?.();
              }}
            />
          </li>
        ))}
      </ul>
      {!data.users.length && (
        <p className="help">
          Здесь пока никого нет. Знакомства начинаются с интересного велосипеда.
        </p>
      )}
      <Pagination {...data} onPage={setPage} />
    </>
  );
}
