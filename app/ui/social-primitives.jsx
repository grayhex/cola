"use client";
import { useEffect, useState } from "react";
import { Heart } from "lucide-react";
import GlobalHeader from "./global-header.jsx";
import { useSite } from "./site-provider.jsx";
import Versions from "./versions.jsx";
export async function socialApi(path, method = "GET", data) {
  const response = await fetch("/api/" + path, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Не удалось выполнить запрос");
  return result;
}
export function Avatar({ person, size = "normal" }) {
  const src =
      person?.avatar ||
      (person?.avatar_id ? "/api/avatars/" + person.avatar_id : null),
    [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <span className={"social-avatar " + size}>
      {src && !failed ? (
        <img
          src={src}
          alt={"Аватар " + person.name}
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden="true">
          {(person?.name || "В").slice(0, 1).toUpperCase()}
        </span>
      )}
    </span>
  );
}
export function AuthorLink({ author }) {
  if (!author?.username) return null;
  return (
    <a
      className="card-author author-link"
      href={"/u/" + author.username}
      title={author.name}
    >
      <Avatar person={author} size="tiny" />
      <span>@{author.username}</span>
    </a>
  );
}
export function SocialHeader({ user }) {
  return <GlobalHeader user={user} />;
}
export function SocialFooter() {
  const { settings } = useSite();
  return (
    <footer className="footer">
      <span className="footer-logo">{settings.siteName}</span>
      <span>Люди. Велосипеды. Истории.</span>
      <Versions />
    </footer>
  );
}
export function FollowButton({ profile, user, onChange }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (profile.relationship?.isSelf)
    return (
      <a className="button secondary small" href="/account?tab=profile">
        Изменить профиль
      </a>
    );
  if (!user)
    return (
      <a className="button small" href="/account">
        Войти, чтобы подписаться
      </a>
    );
  return (
    <div className="follow-control">
      <button
        className={
          "button small " + (profile.relationship?.following ? "secondary" : "")
        }
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const result = await socialApi(
              "social/profiles/" + profile.username + "/follow",
              profile.relationship?.following ? "DELETE" : "PUT",
            );
            await onChange(result.relationship);
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy
          ? "Сохраняем…"
          : profile.relationship?.following
            ? "Отписаться"
            : "Подписаться"}
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
export function Pagination({ page, total, pageSize, onPage }) {
  return (
    total > pageSize && (
      <nav className="feed-pages" aria-label="Страницы">
        <button
          className="quiet"
          disabled={page === 1}
          onClick={() => onPage(page - 1)}
        >
          Назад
        </button>
        <span>
          {page} / {Math.ceil(total / pageSize)}
        </span>
        <button
          className="quiet"
          disabled={page * pageSize >= total}
          onClick={() => onPage(page + 1)}
        >
          Далее
        </button>
      </nav>
    )
  );
}
export function PeopleList({ username, kind, user, onChange }) {
  const [data, setData] = useState(null),
    [page, setPage] = useState(1),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    setData(null);
    setError("");
    socialApi("social/profiles/" + username + "/" + kind + "?page=" + page)
      .then((d) => {
        if (current) setData(d);
      })
      .catch((e) => {
        if (current) setError(e.message);
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
            <a className="person-identity" href={"/u/" + person.username}>
              <Avatar person={person} />
              <span>
                <strong>{person.name}</strong>
                <small>@{person.username}</small>
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
