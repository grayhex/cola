"use client";
import RideAccount from "./ride-account.jsx";
import { useSearchParams } from "next/navigation";
import BikeGrid from "./bike-grid.jsx";
import { BadgeShelf } from "./achievements.jsx";
import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  ExternalLink,
  LogOut,
  LayoutGrid,
  UserRound,
  Bike,
  Route,
  Users,
  Trophy,
  Palette,
  Settings2,
} from "./icons.jsx";
import AuthPage from "./auth-page.jsx";
import AccountSecurity from "./account-security.jsx";
import Garage from "./garage.jsx";
import BikeCard from "./bike-card.jsx";
import {
  Avatar,
  SocialHeader,
  SocialFooter,
  PeopleList,
  socialApi,
} from "./social-primitives.jsx";
import { useSite } from "./site-provider.jsx";
import { profilePath } from "../../lib/public-urls.js";
import { isGeneratedUsername } from "../../lib/usernames.js";
const tabIcons = {
  overview: LayoutGrid,
  profile: UserRound,
  bikes: Bike,
  rides: Route,
  social: Users,
  achievements: Trophy,
  appearance: Palette,
  account: Settings2,
};
const tabs = {
  overview: "Обзор",
  profile: "Мой профиль",
  bikes: "Мои велосипеды",
  rides: "Покатушки",
  social: "Социальное",
  achievements: "Достижения",
  appearance: "Оформление",
  account: "Аккаунт",
};
// Address status and a resend link; confirmation does not limit site features.
function EmailStatus({ email, verified }) {
  const [state, setState] = useState("idle"),
    [message, setMessage] = useState("");
  return (
    <>
      <span>{email}</span>{" "}
      <span className="help">
        {verified || state === "verified"
          ? "· подтверждён"
          : "· не подтверждён"}
      </span>
      {!verified && state !== "verified" && (
        <>
          <br />
          <button
            type="button"
            className="quiet"
            disabled={state === "busy" || state === "sent"}
            aria-busy={state === "busy"}
            onClick={async () => {
              setState("busy");
              setMessage("");
              try {
                const result = await socialApi(
                  "account/email-verification",
                  "POST",
                );
                setState(result.verified ? "verified" : "sent");
                setMessage(
                  result.verified
                    ? "Адрес уже подтверждён"
                    : "Письмо отправлено. Ссылка действует 24 часа.",
                );
              } catch (e) {
                setState("idle");
                setMessage(e.message);
              }
            }}
          >
            {state === "busy" ? "Отправляем…" : "Отправить письмо ещё раз"}
          </button>
        </>
      )}
      {message && (
        <span className="help" role="status">
          {" "}
          {message}
        </span>
      )}
    </>
  );
}
// One-time suggestion for accounts that still have the automatic username (#71).
function UsernamePrompt({ profile, onChoose }) {
  const key = "cola:username-prompt:" + profile.id;
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    try {
      setHidden(localStorage.getItem(key) === "dismissed");
    } catch {
      setHidden(false);
    }
  }, [key]);
  if (hidden || !isGeneratedUsername(profile.username)) return null;
  return (
    <aside className="username-prompt" aria-label="Имя пользователя">
      <p>
        <strong>Выберите имя пользователя.</strong> Сейчас у вас автоматическое
        имя @{profile.username}: оно видно в адресе профиля и в ссылках на ваши
        публикации.
      </p>
      <div>
        <button className="button small" onClick={onChoose}>
          Выбрать имя
        </button>
        <button
          className="quiet"
          onClick={() => {
            try {
              localStorage.setItem(key, "dismissed");
            } catch {}
            setHidden(true);
          }}
        >
          Не сейчас
        </button>
      </div>
    </aside>
  );
}
function ProfileEditor({ profile, onSaved }) {
  const [form, setForm] = useState({
      username: profile.username,
      name: profile.name,
      bio: profile.bio,
      location: profile.location,
    }),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await socialApi("social/me", "PATCH", form);
      await onSaved();
      setMessage("Профиль сохранён");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function avatar(file) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (file && file.size > 2 * 1024 * 1024)
        throw new Error("Размер файла — не больше 2 МБ");
      const response = await fetch("/api/social/me/avatar", {
        method: file ? "PUT" : "DELETE",
        headers: file ? { "Content-Type": file.type } : {},
        body: file || undefined,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      await onSaved();
      setMessage(file ? "Аватар обновлён" : "Аватар удалён");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="profile-editor">
      <div className="avatar-editor">
        <Avatar person={profile} size="large" />
        <div>
          <label
            className={"button secondary small" + (busy ? " disabled" : "")}
          >
            Загрузить аватар
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) avatar(file);
              }}
            />
          </label>
          {profile.avatar && (
            <button
              className="quiet"
              disabled={busy}
              onClick={() => avatar(null)}
            >
              Удалить аватар
            </button>
          )}
          <p className="help">
            JPEG, PNG или WebP до 2 МБ. Фото обрезается до квадрата.
          </p>
        </div>
      </div>
      <form onSubmit={save}>
        <p className="help">
          Эти данные видны всем. Email и настройки оформления остаются
          приватными.
        </p>
        <label className="field">
          <span>Username</span>
          <input
            required
            aria-label="Username"
            minLength={3}
            maxLength={30}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            pattern="[a-zA-Z0-9._\-]{3,30}"
            value={form.username}
            onChange={(e) => set("username", e.target.value)}
          />
          <small>
            3–30 символов: латиница, цифры, точка, дефис и подчёркивание. Ссылка
            изменится вместе с username.
          </small>
        </label>
        <label className="field">
          <span>Отображаемое имя</span>
          <input
            required
            maxLength={60}
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </label>
        <label className="field">
          <span>О себе</span>
          <textarea
            aria-label="О себе"
            rows={3}
            maxLength={500}
            placeholder="Как и где катаетесь, ваш уровень, любимые маршруты и предпочтения"
            value={form.bio}
            onChange={(e) => set("bio", e.target.value)}
          />
          <small>Публичная заметка в профиле · {form.bio.length}/500</small>
        </label>
        <label className="field">
          <span>Местоположение</span>
          <input
            maxLength={100}
            placeholder="Город или регион — необязательно"
            value={form.location}
            onChange={(e) => set("location", e.target.value)}
          />
        </label>
        <button className="button" disabled={busy}>
          {busy ? "Сохраняем…" : "Сохранить профиль"}
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
function Appearance({ initial, onSaved }) {
  const [prefs, setPrefs] = useState(initial || {}),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const { setPreferences, themePreference, setThemePreference } = useSite();
  const set = (key, value) =>
    setPrefs((p) => {
      const next = { ...p };
      if (value === "") delete next[key];
      else next[key] = value;
      return next;
    });
  return (
    <form
      className="account-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        setMessage("");
        try {
          await socialApi("social/preferences", "PATCH", {
            preferences: prefs,
          });
          setPreferences(prefs);
          await onSaved();
          setMessage("Оформление сохранено");
        } catch (e) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="help">
        Личные настройки применяются только для вас. Цветовая тема сохраняется
        на этом устройстве сразу.
      </p>
      <label className="field">
        <span>Тема</span>
        <select
          value={themePreference}
          onChange={(e) => setThemePreference(e.target.value)}
        >
          <option value="system">Как на устройстве</option>
          <option value="light">Светлая</option>
          <option value="dark">Тёмная</option>
        </select>
      </label>
      {[
        [
          "bikeLayout",
          "Карточка велосипеда",
          [
            ["dense", "Компактная"],
            ["balanced", "Сбалансированная"],
            ["spacious", "Подробная"],
          ],
        ],
        [
          "rideListMode",
          "Покатушки на странице велосипеда",
          [
            ["auto", "Авто: больше 5 — раскрываемый список"],
            ["cards", "Карточки"],
            ["list", "Раскрываемый список"],
          ],
        ],
        [
          "rideMapView",
          "Карта покатушки",
          [
            ["map", "Карта с подложкой"],
            ["route", "Только линия маршрута"],
            ["hidden", "Не показывать карту"],
          ],
        ],
      ].map(([key, label, options]) => (
        <label className="field" key={key}>
          <span>{label}</span>
          <select
            value={prefs[key] || ""}
            onChange={(e) => set(key, e.target.value)}
          >
            <option value="">Как на сайте</option>
            {options.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
      ))}
      <label className="field">
        <span>Группы комплектующих</span>
        <select
          value={String(prefs.componentsExpanded ?? "")}
          onChange={(e) =>
            set(
              "componentsExpanded",
              e.target.value === "" ? "" : e.target.value === "true",
            )
          }
        >
          <option value="">Раскрыты на компьютере, свёрнуты на телефоне</option>
          <option value="true">Всегда раскрыты</option>
          <option value="false">Всегда свёрнуты</option>
        </select>
      </label>
      <label className="setting-row">
        <span>Показывать пробег</span>
        <input
          type="checkbox"
          checked={prefs.showMileage || false}
          onChange={(e) => set("showMileage", e.target.checked)}
        />
      </label>
      <label className="setting-row">
        Масштабировать интерактивную карту колесом
        <input
          type="checkbox"
          checked={prefs.mapScrollZoom || false}
          onChange={(e) => set("mapScrollZoom", e.target.checked)}
        />
      </label>
      <div className="form-actions">
        <button type="button" className="quiet" onClick={() => setPrefs({})}>
          Сбросить оформление
        </button>
        <button className="button" disabled={busy}>
          Сохранить оформление
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
    </form>
  );
}
export default function Account() {
  const params = useSearchParams();
  const [data, setData] = useState(null),
    [bikes, setBikes] = useState([]),
    [tab, setTab] = useState("overview"),
    [kind, setKind] = useState("following"),
    [error, setError] = useState(""),
    [create, setCreate] = useState(false),
    [selected, setSelected] = useState(null);
  const { viewer: user, refreshViewer } = useSite();
  // The reader comes from the server layout (#74). A profile change reloads
  // it too, so the header shows the new name at once.
  async function refresh(reloadViewer = false) {
    const current = reloadViewer ? await refreshViewer() : user;
    if (current) {
      const [d, b] = await Promise.all([
        socialApi("social/account"),
        socialApi("bikes"),
      ]);
      setData(d);
      setBikes(b.bikes);
    }
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);
  // Next navigation within /account does not remount Account. Observe the URL,
  // including a repeated add request after closing a previous wizard.
  useEffect(() => {
    const requested = params.get("tab");
    setTab(tabs[requested] ? requested : "overview");
    setSelected(requested === "bikes" ? params.get("bike") : null);
    setCreate(requested === "bikes" && params.get("action") === "add");
  }, [params]);
  const createOpened = useCallback(() => {
    setCreate(false);
    const next = new URL(window.location.href);
    next.searchParams.delete("action");
    next.searchParams.set("tab", "bikes");
    window.history.replaceState(null, "", next.pathname + next.search);
  }, []);
  function navigate(next) {
    setCreate(false);
    setSelected(null);
    setTab(next);
    window.history.replaceState(
      null,
      "",
      "/account" + (next === "overview" ? "" : "?tab=" + next),
    );
    if (next !== "bikes") refresh().catch((e) => setError(e.message));
  }
  if (user === null)
    return <AuthPage onAuthenticated={() => window.location.reload()} />;
  const profile = data?.profile;
  return (
    <>
      <SocialHeader user={user} />
      <main className="page account-page">
        <div className="account-heading">
          <h1>Личный кабинет</h1>
          {profile && (
            <a href={profilePath(profile.username)} className="quiet">
              <ExternalLink size={15} />
              Мой публичный профиль
            </a>
          )}
        </div>
        <nav
          className="account-tabs ui-tabs"
          aria-label="Разделы личного кабинета"
        >
          {Object.entries(tabs).map(([key, label]) => (
            <button
              key={key}
              aria-current={tab === key ? "page" : undefined}
              onClick={() => navigate(key)}
            >
              {(() => {
                const Icon = tabIcons[key];
                return <Icon size={17} aria-hidden="true" />;
              })()}
              {label}
            </button>
          ))}
        </nav>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {!data ? (
          <p role="status">Загружаем кабинет…</p>
        ) : (
          <div className="account-content">
            {tab === "overview" && (
              <>
                <UsernamePrompt
                  profile={profile}
                  onChoose={() => navigate("profile")}
                />
                <section className="account-overview">
                  <Avatar person={profile} size="large" />
                  <div>
                    <h2>{profile.name}</h2>
                    <span className="username">@{profile.username}</span>
                    <p>
                      <a href={profilePath(profile.username)}>
                        Посмотреть мой публичный профиль
                      </a>
                    </p>
                  </div>
                  <button
                    className="button small"
                    onClick={() => {
                      window.history.replaceState(
                        null,
                        "",
                        "/account?tab=bikes&action=add",
                      );
                    }}
                  >
                    <Plus size={16} />
                    Добавить велосипед
                  </button>
                </section>
                <div className="account-metrics">
                  {[
                    ["Всего байков", data.stats.bikes, "bikes"],
                    ["Публичные", data.stats.public, "bikes"],
                    ["Приватные", data.stats.private, "bikes"],
                    ["Подписчики", profile.counts.followers, "followers"],
                    ["Подписки", profile.counts.following, "following"],
                    ["Друзья", profile.counts.friends, "friends"],
                    ["Лайки", data.stats.likes, null],
                  ].map(([label, count, target]) => (
                    <button
                      key={label}
                      disabled={!target}
                      onClick={() => {
                        if (target === "bikes") navigate("bikes");
                        else {
                          setKind(target);
                          navigate("social");
                        }
                      }}
                    >
                      <strong>{count}</strong>
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
                <section className="recent-bikes">
                  <div className="section-heading">
                    <h2>Последние велосипеды</h2>
                    <button className="quiet" onClick={() => navigate("bikes")}>
                      Все велосипеды
                    </button>
                  </div>
                  <BikeGrid bikes={bikes.slice(0, 3)}>
                    {bikes.slice(0, 3).map((b) => (
                      <BikeCard
                        key={b.id}
                        bike={b}
                        ownerView
                        onOpen={() => {
                          setSelected(b.id);
                          setTab("bikes");
                        }}
                      />
                    ))}
                  </BikeGrid>
                  {!bikes.length && (
                    <p className="help">
                      Добавьте первый велосипед и начните свою коллекцию.
                    </p>
                  )}
                </section>
              </>
            )}
            {tab === "rides" && <RideAccount bikes={bikes} />}
            {tab === "achievements" && (
              <BadgeShelf endpoint="game/me" account />
            )}
            {tab === "profile" && (
              <section className="social-panel">
                <h2>Мой профиль</h2>
                <ProfileEditor
                  profile={profile}
                  onSaved={() => refresh(true)}
                />
              </section>
            )}
            {tab === "bikes" && (
              <Garage
                account
                embedded
                startCreate={create}
                onCreateOpened={createOpened}
                initialBikeId={selected}
              />
            )}
            {tab === "social" && (
              <section className="social-panel">
                <h2>Социальное</h2>
                <div
                  className="social-switch ui-tabs"
                  role="group"
                  aria-label="Связи"
                >
                  {[
                    ["following", "Подписки"],
                    ["followers", "Подписчики"],
                    ["friends", "Друзья"],
                  ].map(([key, label]) => (
                    <button
                      className="quiet"
                      aria-pressed={kind === key}
                      key={key}
                      onClick={() => setKind(key)}
                    >
                      {label} · {profile.counts[key]}
                    </button>
                  ))}
                </div>
                <PeopleList
                  key={kind}
                  username={profile.username}
                  kind={kind}
                  user={user}
                  onChange={() => refresh()}
                />
              </section>
            )}
            {tab === "appearance" && (
              <section className="social-panel">
                <h2>Оформление</h2>
                <Appearance
                  initial={data.preferences}
                  onSaved={() => refresh()}
                />
              </section>
            )}
            {tab === "account" && (
              <section className="social-panel account-private">
                <div className="section-heading">
                  <h2>Аккаунт</h2>
                  <button
                    className="button secondary small"
                    onClick={async () => {
                      try {
                        await socialApi("auth/logout", "POST");
                        window.location.assign("/");
                      } catch (e) {
                        setError(e.message);
                      }
                    }}
                  >
                    <LogOut size={16} />
                    Выйти
                  </button>
                </div>
                <p className="help">
                  Эта информация доступна только вам. С нами с{" "}
                  {new Date(profile.createdAt).toLocaleDateString("ru-RU")}.
                </p>
                <AccountSecurity
                  emailStatus={
                    <EmailStatus
                      email={data.email}
                      verified={!!user?.email_verified_at}
                    />
                  }
                />
              </section>
            )}
          </div>
        )}
      </main>
      <SocialFooter />
    </>
  );
}
