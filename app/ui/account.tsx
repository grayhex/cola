"use client";
import type {
  AccountOverviewDto,
  AccountBikeDto,
  PublicProfile,
  UserPreferences,
  EmailVerificationResponse,
  ApiError,
} from "../../lib/contracts.ts";
import type { ReadonlyURLSearchParams } from "next/navigation";
type Tab = keyof typeof tabs;
import type * as React from "react";
import { errorMessage } from "../../lib/errors.ts";
import BikeWeekStory from "./bike-week-story.tsx";
import RideAccount from "./ride-account.tsx";
import AccountIntegrations from "./account-integrations.tsx";
import TogetherActions from "./together-actions.tsx";
import { CompactDialog } from "./compact-ui.tsx";
import { useSearchParams } from "next/navigation";
import BikeGrid from "./bike-grid.tsx";
import { BadgeShelf } from "./achievements.tsx";
import { useRef, useCallback, useEffect, useState } from "react";
import {
  ExternalLink,
  LogOut,
  LayoutGrid,
  UserRound,
  Bike,
  Route,
  Cable,
  Users,
  Trophy,
  Palette,
  Settings2,
  ChevronDown,
} from "./icons.tsx";
import AuthPage from "./auth-page.tsx";
import AccountSecurity from "./account-security.tsx";
import AccountNotifications from "./account-notifications.tsx";
import Garage from "./garage.tsx";
import BikeCard from "./bike-card.tsx";
import {
  Avatar,
  SocialHeader,
  SocialFooter,
  PeopleList,
  socialApi,
} from "./social-primitives.tsx";
import { useSite } from "./site-provider.tsx";
import { profilePath } from "../../lib/public-urls.ts";
import { isGeneratedUsername } from "../../lib/usernames.ts";
import { userTimeZone, timeZoneChoices } from "../../lib/user-time-zone.ts";
import { validTimeZone } from "../../lib/ride-intent-time.ts";
const tabIcons = {
  overview: LayoutGrid,
  profile: UserRound,
  bikes: Bike,
  rides: Route,
  integrations: Cable,
  social: Users,
  achievements: Trophy,
  spotlight: Trophy,
  appearance: Palette,
  account: Settings2,
};
const tabs = {
  overview: "Обзор",
  profile: "Мой профиль",
  bikes: "Мои велосипеды",
  rides: "Мои покатушки",
  integrations: "Интеграции и импорт",
  social: "Социальное",
  achievements: "Достижения",
  spotlight: "Велосипед недели",
  appearance: "Оформление",
  account: "Аккаунт",
};
// Address status and resend: public contributions require a verified email.
function EmailStatus({
  email,
  verified,
}: {
  email: string;
  verified: boolean;
}) {
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
                const result = await socialApi<EmailVerificationResponse>(
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
                setMessage(errorMessage(e));
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
function UsernamePrompt({
  profile,
  onChoose,
}: {
  profile: PublicProfile;
  onChoose: () => void;
}) {
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
            } catch {
              // Dismissing the prompt still works without local storage.
            }
            setHidden(true);
          }}
        >
          Не сейчас
        </button>
      </div>
    </aside>
  );
}
function ProfileEditor({
  profile,
  preferences = {},
  onSaved,
}: {
  profile: PublicProfile;
  preferences?: UserPreferences;
  onSaved: () => Promise<void>;
}) {
  const { setPreferences } = useSite();
  const [form, setForm] = useState({
      username: profile.username,
      name: profile.name,
      bio: profile.bio,
      location: profile.location,
    }),
    // #253: new intents and plans read this zone; unset follows the browser.
    [timeZone, setTimeZone] = useState(() => userTimeZone(preferences)),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const set = (key: keyof typeof form, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (!validTimeZone(timeZone))
        throw new Error("Выберите часовой пояс из списка");
      await socialApi("social/me", "PATCH", form);
      if (timeZone !== preferences.timeZone) {
        const next = { ...preferences, timeZone };
        await socialApi("social/preferences", "PATCH", { preferences: next });
        setPreferences(next);
      }
      await onSaved();
      setMessage("Профиль сохранён");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function avatar(file: File | null) {
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
      const data: Partial<ApiError> = await response.json();
      if (!response.ok) throw new Error(data.error);
      await onSaved();
      setMessage(file ? "Аватар обновлён" : "Аватар удалён");
    } catch (e) {
      setError(errorMessage(e));
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
          <span>Часовой пояс</span>
          <input
            required
            list="profile-time-zones"
            autoComplete="off"
            spellCheck={false}
            value={timeZone}
            onChange={(e) => setTimeZone(e.target.value.trim())}
          />
          <datalist id="profile-time-zones">
            {timeZoneChoices().map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
          <small>
            Время новых намерений и покатушек. Уже созданные серии сохраняют
            свой пояс.
          </small>
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
function Appearance({
  initial,
  onSaved,
}: {
  initial?: UserPreferences;
  onSaved: () => Promise<void>;
}) {
  const [prefs, setPrefs] = useState(initial || {}),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const { setPreferences, themePreference, setThemePreference } = useSite();
  const set = <K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K] | "",
  ) =>
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
          setError(errorMessage(e));
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
      {(
        [
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
        ] as const
      ).map(([key, label, options]) => (
        <label className="field" key={key}>
          <span>{label}</span>
          <select
            value={prefs[key] || ""}
            onChange={(e) =>
              set(
                key,
                e.target.value as NonNullable<UserPreferences[typeof key]>,
              )
            }
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
          <option value="">Как на сайте</option>
          <option value="true">Всегда раскрыты</option>
          <option value="false">Всегда свёрнуты</option>
        </select>
        <small>На сайте раскрыты на компьютере и свёрнуты на телефоне</small>
      </label>
      <label className="field">
        <span>Открывать меню при наведении</span>
        <select
          value={String(prefs.menuOpenOnHover ?? "")}
          onChange={(e) =>
            set(
              "menuOpenOnHover",
              e.target.value === "" ? "" : e.target.value === "true",
            )
          }
        >
          <option value="">Как на сайте</option>
          <option value="true">Включено</option>
          <option value="false">Выключено</option>
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
        <button
          type="button"
          className="quiet"
          // The profile's time zone is not a look; a reset keeps it.
          onClick={() =>
            setPrefs((p) => (p.timeZone ? { timeZone: p.timeZone } : {}))
          }
        >
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
// Old links opened imports inside «Покатушки»; they live under «Интеграции и
// импорт» now (#245). The intent (which importer, the OAuth result) is kept.
function forwardedTab(params: ReadonlyURLSearchParams) {
  const tab = params.get("tab");
  if (
    tab === "rides" &&
    (["add", "import"].includes(params.get("action") || "") ||
      params.has("activity_sync"))
  )
    return "integrations";
  return tab && Object.hasOwn(tabs, tab) ? (tab as Tab) : "overview";
}
const sectionHref = (key: string) =>
  "/account" + (key === "overview" ? "" : "?tab=" + key);
export default function Account() {
  const params = useSearchParams()!;
  const [data, setData] = useState<AccountOverviewDto | null>(null),
    [bikes, setBikes] = useState<AccountBikeDto[]>([]),
    [tab, setTab] = useState<Tab>("overview"),
    [kind, setKind] = useState("following"),
    [error, setError] = useState(""),
    [create, setCreate] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [menu, setMenu] = useState(false);
  const { viewer: user, refreshViewer } = useSite();
  // The reader comes from the server layout (#74). A profile change reloads
  // it too, so the header shows the new name at once.
  const userId = user?.id;
  const requests = useRef({ revision: 0 });
  const refresh = useCallback(
    async (reloadViewer = false) => {
      const revision = ++requests.current.revision;
      const current = reloadViewer ? await refreshViewer() : userId;
      if (current) {
        const [d, b] = await Promise.all([
          socialApi<AccountOverviewDto>("social/account"),
          socialApi<{ bikes: AccountBikeDto[] }>("bikes"),
        ]);
        if (revision !== requests.current.revision) return;
        if (!d.profile)
          throw new Error("Профиль недоступен. Обновите страницу.");
        setData(d);
        setBikes(b.bikes);
      }
    },
    [userId, refreshViewer],
  );
  // Stable: ActivitySync reloads when this identity changes, and a reload
  // would reset the bike the rider has just chosen.
  const reload = useCallback(() => {
    refresh().catch(() => {});
  }, [refresh]);
  useEffect(() => {
    const pending = requests.current;
    let active = true;
    refresh().catch((e) => {
      if (active) setError(errorMessage(e));
    });
    return () => {
      active = false;
      pending.revision++;
    };
  }, [refresh]);
  // Next navigation within /account does not remount Account. Observe the URL,
  // including a repeated add request after closing a previous wizard.
  useEffect(() => {
    const requested = forwardedTab(params);
    if (
      requested !== (params.get("tab") || "overview") &&
      requested !== "overview"
    ) {
      const next = new URL(window.location.href);
      next.searchParams.set("tab", requested);
      window.history.replaceState(null, "", next.pathname + next.search);
    }
    setTab(requested);
    setSelected(requested === "bikes" ? params.get("bike") : null);
    setCreate(requested === "bikes" && params.get("action") === "add");
  }, [params]);
  // A guest's «Организовать покатушку» came with `?auth=register` (#378); once
  // the rider is in, the mark has done its work and goes from the address.
  useEffect(() => {
    if (!user) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("auth")) return;
    url.searchParams.delete("auth");
    window.history.replaceState(null, "", url.pathname + url.search);
  }, [user]);
  const createOpened = useCallback(() => {
    setCreate(false);
    const next = new URL(window.location.href);
    next.searchParams.delete("action");
    next.searchParams.set("tab", "bikes");
    window.history.replaceState(null, "", next.pathname + next.search);
  }, []);
  function navigate(next: Tab, push = false) {
    setCreate(false);
    setSelected(null);
    setTab(next);
    setMenu(false);
    window.history[push ? "pushState" : "replaceState"](
      null,
      "",
      sectionHref(next),
    );
    if (next !== "bikes") refresh().catch((e) => setError(errorMessage(e)));
  }
  if (user === null)
    return <AuthPage onAuthenticated={() => window.location.reload()} />;
  const profile = data?.profile;
  // One list of sections: a column on wide screens, a sheet on phones.
  const sections = (
    <ul className="account-nav-list">
      {(Object.entries(tabs) as [Tab, string][]).map(([key, label]) => {
        const Icon = tabIcons[key];
        return (
          <li key={key}>
            <a
              href={sectionHref(key)}
              aria-current={tab === key ? "page" : undefined}
              onClick={(e) => {
                // A new tab or window keeps the browser's own behaviour.
                if (
                  e.button ||
                  e.metaKey ||
                  e.ctrlKey ||
                  e.shiftKey ||
                  e.altKey
                )
                  return;
                e.preventDefault();
                navigate(key, true);
              }}
            >
              <Icon size={17} aria-hidden="true" />
              {label}
            </a>
          </li>
        );
      })}
    </ul>
  );
  const CurrentIcon = tabIcons[tab];
  return (
    <>
      <SocialHeader user={user} />
      <main className="page account-page">
        <div className="account-layout">
          <aside className="account-sidebar">
            <h1>Личный кабинет</h1>
            <div className="account-identity">
              <Avatar person={profile || user} />
              <div>
                <strong>{profile?.name || user?.name}</strong>
                {(profile?.username || user?.username) && (
                  <span className="username">
                    @{profile?.username || user?.username}
                  </span>
                )}
              </div>
            </div>
            {profile && (
              <a href={profilePath(profile.username)} className="quiet">
                <ExternalLink size={15} />
                Мой публичный профиль
              </a>
            )}
            <nav className="account-nav" aria-label="Разделы личного кабинета">
              {sections}
            </nav>
            <button
              type="button"
              className="account-nav-toggle"
              aria-haspopup="dialog"
              aria-expanded={menu}
              onClick={() => setMenu(true)}
            >
              <CurrentIcon size={17} aria-hidden="true" />
              <span>
                <small>Раздел:</small> {tabs[tab]}
              </span>
              <ChevronDown size={16} aria-hidden="true" />
            </button>
          </aside>
          <div className="account-main">
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            {!data || !profile ? (
              <p role="status">Загружаем кабинет…</p>
            ) : (
              <div className="account-content">
                {tab === "overview" && (
                  <>
                    <UsernamePrompt
                      profile={profile}
                      onChoose={() => navigate("profile")}
                    />
                    <section
                      className="account-overview"
                      aria-labelledby="overview-heading"
                    >
                      <div>
                        <h2 id="overview-heading">Обзор</h2>
                        <p className="help">
                          Отметьте, когда хочется ехать, или соберите выезд
                          сами.
                        </p>
                      </div>
                      <TogetherActions
                        key={user?.id}
                        signedIn
                        onSaved={reload}
                      />
                    </section>
                    <div className="account-metrics">
                      {(
                        [
                          ["Всего байков", data.stats.bikes, "bikes"],
                          ["Публичные", data.stats.public, "bikes"],
                          ["Приватные", data.stats.private, "bikes"],
                          ["Подписчики", profile.counts.followers, "followers"],
                          ["Подписки", profile.counts.following, "following"],
                          ["Друзья", profile.counts.friends, "friends"],
                          ["Лайки", data.stats.likes, null],
                        ] as const
                      ).map(([label, count, target]) => (
                        <button
                          key={label}
                          disabled={!target}
                          onClick={() => {
                            if (target === "bikes") navigate("bikes", true);
                            else {
                              setKind(target!);
                              navigate("social", true);
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
                        <button
                          className="quiet"
                          onClick={() => navigate("bikes", true)}
                        >
                          Все велосипеды
                        </button>
                      </div>
                      <BikeGrid>
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
                          Велосипеды появятся здесь после добавления в разделе
                          «Мои велосипеды».
                        </p>
                      )}
                    </section>
                  </>
                )}
                {tab === "rides" && <RideAccount bikes={bikes} />}
                {tab === "spotlight" && <BikeWeekStory />}
                {tab === "integrations" && (
                  <AccountIntegrations bikes={bikes} onImported={reload} />
                )}
                {tab === "achievements" && (
                  <BadgeShelf endpoint="game/me" account />
                )}
                {tab === "profile" && (
                  <section className="social-panel">
                    <h2>Мой профиль</h2>
                    <ProfileEditor
                      profile={profile}
                      preferences={data.preferences || {}}
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
                      {(
                        [
                          ["following", "Подписки"],
                          ["followers", "Подписчики"],
                          ["friends", "Друзья"],
                        ] as const
                      ).map(([key, label]) => (
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
                            // New session: reload the server viewer and discard private client state.
                            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                            window.location.assign("/");
                          } catch (e) {
                            setError(errorMessage(e));
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
                    <AccountNotifications />
                  </section>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
      <CompactDialog
        open={menu}
        onClose={() => setMenu(false)}
        title="Разделы кабинета"
        className="account-nav-sheet"
      >
        <nav className="account-nav" aria-label="Разделы личного кабинета">
          {sections}
        </nav>
      </CompactDialog>
      <SocialFooter />
    </>
  );
}
