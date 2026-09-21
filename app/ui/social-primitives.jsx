"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Heart } from "./icons.jsx";
import GlobalHeader from "./global-header.jsx";
import { useSite } from "./site-provider.jsx";
import footerStyles from "./site-footer.module.css";
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
import { Avatar } from "./avatar.jsx";
export { Avatar } from "./avatar.jsx";
export function AuthorLink({ author }) {
  if (!author?.username) return null;
  return (
    <Link
      className="card-author author-link"
      href={"/u/" + author.username}
      title={author.name}
    >
      <Avatar person={author} size="tiny" />
      <span>@{author.username}</span>
    </Link>
  );
}
export function SocialHeader({ user }) {
  return <GlobalHeader user={user} />;
}
export function SocialFooter() {
  return (
    <footer className={footerStyles.footer}>
      <div className={footerStyles.inner}>
        <Link className={footerStyles.brand} href="/">
          ColaBike
        </Link>
        <span>Люди. Велосипеды. Истории.</span>
        <nav aria-label="Нижняя навигация">
          <Link href="/bikes">Велосипеды</Link>
          <Link href="/journal">Журнал</Link>
          <Link href="/articles">Статьи</Link>
          <Link href="/rides">Покатушки</Link>
          <Link href="/market">Рынок</Link>
          <Link href="/about">О проекте</Link>
          <a href="https://github.com/grayhex/cola">GitHub</a>
          <Versions link={false} />
        </nav>
      </div>
    </footer>
  );
}
export function FollowButton({ profile, user, onChange }) {
  const [busy, setBusy] = useState(false),
    [optimisticFollowing, setOptimisticFollowing] = useState(null),
    [error, setError] = useState("");
  const following = optimisticFollowing ?? profile.relationship?.following;
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
        className={"button small " + (following ? "secondary" : "")}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          const before = following;
          setOptimisticFollowing(!before);
          try {
            const result = await socialApi(
              "social/profiles/" + profile.username + "/follow",
              before ? "DELETE" : "PUT",
            );
            setOptimisticFollowing(result.relationship.following);
            await onChange(result.relationship);
          } catch (e) {
            setOptimisticFollowing(before);
            setError(e.message);
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
