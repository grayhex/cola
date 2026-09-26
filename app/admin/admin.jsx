"use client";
import Link from "next/link";
import { useCallback, useEffectEvent, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { NavigationSettings, AboutSettings } from "./navigation-settings.jsx";
import {
  ThemeSettings,
  HomepageSettings,
  WizardCopy,
} from "./design-settings.jsx";
import { Field, Select, Toggle } from "./design-controls.jsx";
import IconSettings from "./icon-settings.jsx";
import MediaLibrary from "./media-library.jsx";
import CatalogEditor from "./catalog-editor.jsx";
import MapSettings from "./map-settings.jsx";
import RideSettings from "./ride-settings.jsx";
import Gamification from "./gamification.jsx";
import Reports from "./reports.jsx";
import ScoringSettings from "./scoring-settings.jsx";
import { GroupSettings } from "./layout-settings.jsx";
import ResolverSettings from "./resolver-settings.jsx";
import { copyBlocks } from "../../lib/copy-blocks.js";
import GlobalHeader from "../ui/global-header.jsx";
import { useSite } from "../ui/site-provider.jsx";
import {
  Trophy,
  Check,
  Trash2,
  Settings2,
  Palette,
  Type,
  BookOpen,
  Users,
  Image,
  History,
  Save,
  Search,
  ShieldCheck,
  X,
  LoaderCircle,
  Menu,
  LayoutGrid,
} from "../ui/icons.jsx";
import "./design.module.css";
import ArticleTopicSettings from "./article-topics.jsx";
import LegalSettings from "./legal-settings.jsx";
import EmojiSettings from "./emoji-settings.jsx";
// The design system reference (#127) stays inside the admin, next to its
// menu (#131); loaded only when opened.
const UiKitSections = dynamic(() =>
  import("./ui-kit/ui-kit.jsx").then((m) => m.UiKitSections),
);

async function request(url, method = "GET", data) {
  const response = await fetch("/api/" + url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : undefined,
    body: data ? JSON.stringify(data) : undefined,
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Не удалось выполнить действие");
  return result;
}

const sections = [
  ["overview", "Обзор", Settings2],
  ["legal", "Документы", BookOpen],
  ["scoring", "Оценка велосипедов", Settings2],
  ["gamification", "Награды и рекорды", Trophy],
  ["rides", "Покатушки", Settings2],
  ["resolver", "Bike Resolver", Settings2],
  ["map", "Карта", Settings2],
  ["design", "Внешний вид", Palette],
  ["homepage", "Главная", Palette],
  ["navigation", "Меню", Menu],
  ["graphics", "Графика", Image],
  ["emojis", "Значки", Palette],
  ["articles", "Разделы статей", BookOpen],
  ["media", "Медиатека", Image],
  ["copy", "Тексты", Type],
  ["about", "О проекте", BookOpen],
  ["uikit", "Дизайн-система", LayoutGrid],
  ["groups", "Группы деталей", BookOpen],
  ["catalog", "Справочники", BookOpen],
  ["users", "Пользователи", Users],
  ["reports", "Жалобы", ShieldCheck],
  ["audit", "Журнал действий", History],
];
const adminGroups = [
  {
    id: "system",
    name: "Система",
    icon: Settings2,
    sections: ["overview", "legal", "resolver", "map", "rides", "audit"],
  },
  {
    id: "design",
    name: "Дизайн",
    icon: Palette,
    sections: [
      "design",
      "homepage",
      "navigation",
      "graphics",
      "emojis",
      "media",
      "copy",
      "about",
      "uikit",
    ],
  },
  {
    id: "people",
    name: "Пользователи",
    icon: Users,
    sections: ["users", "reports"],
  },
  {
    id: "mechanics",
    name: "Механики",
    icon: Trophy,
    sections: ["scoring", "gamification"],
  },
  {
    id: "catalog",
    name: "Каталог",
    icon: BookOpen,
    sections: ["catalog", "groups", "articles"],
  },
];
const settingsTabs = new Set([
  "overview",
  "scoring",
  "map",
  "articles",
  // The design system reference has nothing to save.
  ...adminGroups
    .find((g) => g.id === "design")
    .sections.filter((id) => id !== "uikit"),
]);
const catalogTabs = new Set(["catalog", "groups"]);

export default function Admin() {
  const { settings, catalog, setSite, viewer } = useSite();
  const [tab, setTab] = useState("overview"),
    [user, setUser] = useState(viewer);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [draft, setDraft] = useState(settings),
    [cat, setCat] = useState(catalog);
  const [sv, setSv] = useState(1),
    [cv, setCv] = useState(1);
  const [stats, setStats] = useState({}),
    [participation, setParticipation] = useState([]);
  const [assets, setAssets] = useState([]),
    [events, setEvents] = useState([]);
  const [textSearch, setTextSearch] = useState("");
  const [users, setUsers] = useState([]),
    [userSearch, setUserSearch] = useState("");
  const [page, setPage] = useState(1),
    [total, setTotal] = useState(0);
  const [editUser, setEditUser] = useState(null),
    [confirm, setConfirm] = useState(null);
  const [confirmEmail, setConfirmEmail] = useState("");
  const dialog = useRef(null);
  const dirtySettings = JSON.stringify(draft) !== JSON.stringify(settings);
  const dirtyCatalog = JSON.stringify(cat) !== JSON.stringify(catalog);
  const dirty = dirtySettings || dirtyCatalog;
  const locked = busy;
  const group = adminGroups.find((g) => g.sections.includes(tab));
  const isCatalog = catalogTabs.has(tab);
  const canSave = isCatalog || settingsTabs.has(tab);
  const currentDirty = isCatalog ? dirtyCatalog : dirtySettings;

  useEffect(() => {
    const warn = (event) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    if (editUser || confirm) dialog.current?.showModal();
    else dialog.current?.close();
  }, [editUser, confirm]);

  async function run(work) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      return await work();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function loadUsers(q = userSearch, p = page) {
    const result = await request(
      `admin/users?q=${encodeURIComponent(q)}&page=${p}`,
    );
    setUsers(result.users);
    setTotal(result.total);
  }
  const refreshAssets = useCallback(async () => {
    const result = await request("admin/assets/library");
    setAssets(result.assets);
  }, []);
  function mergeAssets(added) {
    setAssets((before) => [
      ...new Map([...before, ...added].map((a) => [a.id, a])).values(),
    ]);
  }
  const reload = useCallback(async () => {
    const result = await request("admin/overview");
    setUser(result.user);
    setStats(result.stats);
    setParticipation(result.participation || []);
    setDraft(result.settings);
    setCat(result.catalog);
    setSv(result.settingsVersion);
    setCv(result.catalogVersion);
    setSite(result);
    await refreshAssets();
  }, [setSite, refreshAssets]);
  useEffect(() => {
    // The server layout already knows the reader (#74).
    (viewer?.role === "admin" ? reload() : Promise.resolve())
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [viewer?.role, reload]);
  // Draft search text is read only on tab/page navigation or explicit submit.
  const loadTab = useEffectEvent(() => {
    if (user?.role !== "admin") return;
    if (tab === "users") run(() => loadUsers());
    if (tab === "media") run(refreshAssets);
    if (tab === "audit")
      run(async () => setEvents((await request("admin/audit")).events));
  });
  useEffect(() => {
    loadTab();
  }, [tab, page, user?.role]);

  // Map updates from individual uploads/imports compose without losing other slots.
  const update = (key, value) =>
    setDraft((before) => ({
      ...before,
      [key]: typeof value === "function" ? value(before[key]) : value,
    }));
  function navigate(next) {
    if (locked) return;
    setTab(next);
    setError("");
    setNotice("");
  }
  async function saveSettings() {
    await run(async () => {
      const result = await request("admin/settings", "PUT", {
        value: draft,
        version: sv,
      });
      setSv(result.version);
      setSite((before) => ({
        ...before,
        settings: draft,
        settingsVersion: result.version,
      }));
      try {
        await refreshAssets();
      } catch {
        setError(
          "Настройки сохранены, но медиатека не обновилась. Откройте её повторно.",
        );
      }
      setNotice("Настройки опубликованы на сайте");
    });
  }
  async function saveCatalog() {
    await run(async () => {
      const result = await request("admin/catalog", "PUT", {
        value: cat,
        version: cv,
      });
      setCv(result.version);
      setSite((before) => ({
        ...before,
        catalog: cat,
        catalogVersion: result.version,
      }));
      setNotice("Справочники обновлены");
    });
  }
  function ask(title, description, action, email) {
    setConfirm({ title, description, action, email });
    setConfirmEmail("");
  }
  async function uploadAsset(file) {
    if (file.size > 10 * 1024 * 1024)
      throw new Error("Максимальный размер 10 МБ");
    const response = await fetch(
      "/api/admin/assets?name=" + encodeURIComponent(file.name),
      {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      },
    );
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "Не удалось загрузить изображение");
    // Do not depend on a subsequent list request to make the new file selectable.
    mergeAssets([
      { ...result, usage: [], created_at: new Date().toISOString() },
    ]);
    setNotice("Изображение загружено.");
    return result;
  }
  async function uploadGraphic(file) {
    return run(async () => {
      const asset = await uploadAsset(file);
      if (!asset) throw new Error("Сервер не вернул загруженное изображение");
      setNotice(
        "Графика загружена и выбрана. Для публикации сохраните настройки.",
      );
      return asset;
    });
  }
  async function deleteAssets(ids) {
    if (!ids.length) {
      setNotice("Нет неиспользуемой графики для удаления.");
      return;
    }
    let deleted = 0,
      skipped = 0,
      cleanupWarning = false;
    try {
      // Only explicit IDs from the confirmation snapshot, never an unbounded delete-all.
      for (let offset = 0; offset < ids.length; offset += 200) {
        const result = await request("admin/assets/library", "DELETE", {
          ids: ids.slice(offset, offset + 200),
        });
        const removed = new Set(result.deletedIds);
        deleted += removed.size;
        skipped += result.skippedIds.length;
        cleanupWarning ||= result.cleanupWarning;
        setAssets((before) => before.filter((asset) => !removed.has(asset.id)));
      }
      await refreshAssets();
      setNotice(`Удалено изображений: ${deleted}. Пропущено: ${skipped}.`);
      if (cleanupWarning)
        setError(
          "Записи удалены, но часть файлов не удалось убрать с диска. Подробности в серверном журнале.",
        );
    } catch (e) {
      try {
        await refreshAssets();
      } catch {
        /* Keep the successfully removed IDs out of the local list. */
      }
      throw new Error(`Удалено изображений: ${deleted}. ${e.message}`, {
        cause: e,
      });
    }
  }

  if (loading)
    return (
      <>
        <GlobalHeader user={null} />
        <main className="loading">
          <LoaderCircle className="spin" />
          Открываем управление…
        </main>
      </>
    );
  if (user?.role !== "admin")
    return (
      <>
        <GlobalHeader user={user} />
        <main className="empty">
          <ShieldCheck size={40} />
          <h1>Вход для администратора</h1>
          <p>
            {user
              ? "У этого аккаунта нет прав администратора."
              : "Войдите в аккаунт администратора на главной странице."}
          </p>
          <Link className="button" href="/">
            Открыть ColaBike
          </Link>
          <p className="help">
            Первого администратора назначает владелец сервера через команду из
            README.
          </p>
          {error && <p role="alert">{error}</p>}
        </main>
      </>
    );

  return (
    <div className="admin-shell">
      <GlobalHeader user={user} />
      <div className="admin-layout admin-sidebar-layout">
        <aside className="admin-sidebar" aria-label="Управление сайтом">
          <div
            className="admin-group-list"
            role="tablist"
            aria-orientation="vertical"
            aria-label="Группы админки"
            onKeyDown={(e) => {
              if (
                !["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key) ||
                e.target.getAttribute("role") !== "tab"
              )
                return;
              const tabs = [
                  ...e.currentTarget.querySelectorAll('[role="tab"]'),
                ],
                i = tabs.indexOf(e.target);
              const next =
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? tabs.length - 1
                    : (i + (e.key === "ArrowDown" ? 1 : -1) + tabs.length) %
                      tabs.length;
              e.preventDefault();
              tabs[next]?.focus();
            }}
          >
            {adminGroups.map((g) => (
              <div key={g.id} className="admin-sidebar-group">
                <button
                  type="button"
                  role="tab"
                  id={"admin-group-" + g.id}
                  aria-selected={g.id === group.id}
                  aria-controls="admin-group-panel"
                  disabled={locked}
                  onClick={() => navigate(g.sections[0])}
                >
                  <g.icon size={18} />
                  {g.name}
                </button>
                {g.id === group.id && (
                  <nav className="admin-nav" aria-label="Разделы админки">
                    {g.sections.map((key) => {
                      const [id, label, Icon] = sections.find(
                        (s) => s[0] === key,
                      );
                      return (
                        <button
                          key={id}
                          type="button"
                          className={tab === id ? "active" : ""}
                          aria-current={tab === id ? "page" : undefined}
                          disabled={locked}
                          onClick={() => navigate(id)}
                        >
                          <Icon size={16} />
                          {label}
                          {((settingsTabs.has(id) && dirtySettings) ||
                            (catalogTabs.has(id) && dirtyCatalog)) && (
                            <span
                              className="unsaved-dot"
                              aria-label="Есть несохранённые изменения"
                            />
                          )}
                        </button>
                      );
                    })}
                  </nav>
                )}
              </div>
            ))}
          </div>
        </aside>
        <main
          className="admin-content"
          id="admin-group-panel"
          role="tabpanel"
          aria-labelledby={"admin-group-" + group.id}
        >
          <div className="admin-title">
            <div>
              <span className="eyebrow">COLABIKE / ADMIN</span>
              <h1>{sections.find((s) => s[0] === tab)[1]}</h1>
            </div>
            {locked && (
              <LoaderCircle
                className="spin"
                aria-label="Выполняется действие"
              />
            )}
          </div>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="admin-success" role="status">
              <Check size={18} />
              {notice}
            </div>
          )}
          <div hidden={tab !== "legal"}><LegalSettings active={tab === "legal"} /></div>
          {tab === "emojis" && (
            <EmojiSettings
              value={draft.emojis}
              onChange={(v) => update("emojis", v)}
            />
          )}
          {tab === "articles" && (
            <ArticleTopicSettings
              value={draft.articleTopics}
              onChange={(v) => update("articleTopics", v)}
            />
          )}
          {tab === "scoring" && (
            <ScoringSettings
              value={draft.scoring}
              catalog={catalog}
              onChange={(v) => update("scoring", v)}
            />
          )}
          {tab === "uikit" && (
            <>
              <p className="help">
                Утверждённые токены и компоненты в светлой и тёмной теме.{" "}
                <a href="/admin/ui-kit" target="_blank" rel="noreferrer">
                  Открыть на всю ширину
                </a>
              </p>
              <UiKitSections />
            </>
          )}
          {tab === "resolver" && <ResolverSettings />}
          {tab === "gamification" && <Gamification />}
          {tab === "rides" && <RideSettings />}
          {tab === "map" && <MapSettings settings={draft} onChange={update} />}
          {tab === "about" && (
            <AboutSettings settings={draft} onChange={update} />
          )}
          {tab === "reports" && (
            <Reports
              onManageUser={(username) => {
                setUserSearch(username);
                setPage(1);
                setTab("users");
              }}
            />
          )}
          {tab === "overview" && (
            <>
              <div className="admin-stats">
                {[
                  ["Пользователей", stats.users],
                  ["Велосипедов", stats.bikes],
                  ["Фотографий", stats.photos],
                ].map(([label, count]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{count ?? 0}</strong>
                  </div>
                ))}
              </div>
              <h3>Участие за 30 дней</h3>
              <p className="help">
                Дневные счётчики без текста, целей действий, IP и контактов.
                Возвращающиеся — участники с действием минимум в два разных дня.
                Это псевдонимный, не анонимный учёт; удаление аккаунта удаляет
                его события.
              </p>
              <table className="participation-table">
                <thead>
                  <tr>
                    <th>Событие</th>
                    <th>Действия</th>
                    <th>Участники</th>
                    <th>Вернулись</th>
                  </tr>
                </thead>
                <tbody>
                  {participation.map((r) => (
                    <tr key={r.event}>
                      <td>
                        {
                          {
                            publish: "Публикация",
                            follow: "Подписка",
                            save: "Сохранение",
                          }[r.event]
                        }
                      </td>
                      <td>{r.actions}</td>
                      <td>{r.participants}</td>
                      <td>{r.returning_participants}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <section className="admin-panel">
                <h2>Основные настройки</h2>
                <Field label="Название сайта">
                  <input
                    maxLength={150}
                    value={draft.siteName}
                    onChange={(e) => update("siteName", e.target.value)}
                  />
                </Field>
                <Field label="Заголовок витрины">
                  <input
                    maxLength={150}
                    value={draft.showcaseTitle || "Витрина"}
                    onChange={(e) => update("showcaseTitle", e.target.value)}
                  />
                </Field>
                <Field label="Описание сайта">
                  <textarea
                    maxLength={300}
                    rows={3}
                    value={draft.siteDescription}
                    onChange={(e) => update("siteDescription", e.target.value)}
                  />
                </Field>
                <Toggle
                  label="Разрешить регистрацию пользователей"
                  checked={draft.registrationOpen}
                  onChange={(v) => update("registrationOpen", v)}
                />
                <Toggle
                  label="Показывать демонстрационный велосипед гостям"
                  checked={draft.showDemo}
                  onChange={(v) => update("showDemo", v)}
                />
                <Field
                  label="Срок объявления на рынке, дней"
                  help="От 7 до 365. Срок начинается при публикации и продлении. За 3 дня до конца владелец получает уведомление и продлевает объявление одной кнопкой; истёкшее уходит из поиска, ленты и sitemap. Уже опубликованные объявления сохраняют свой срок."
                >
                  <input
                    type="number"
                    inputMode="numeric"
                    min={7}
                    max={365}
                    step={1}
                    required
                    value={draft.marketListingDays ?? 60}
                    onChange={(e) =>
                      update("marketListingDays", Number(e.target.value))
                    }
                  />
                </Field>
              </section>
              <p className="help">
                Адрес сервера, доступ к БД и secure-cookie задаются в окружении
                Docker. Секреты не передаются в браузер.
              </p>
            </>
          )}
          {tab === "design" && (
            <ThemeSettings settings={draft} onChange={update} />
          )}
          {tab === "homepage" && (
            <HomepageSettings
              settings={draft}
              onChange={update}
              assets={assets}
              busy={locked}
              onUpload={uploadGraphic}
            />
          )}
          {tab === "navigation" && (
            <NavigationSettings settings={draft} onChange={update} />
          )}
          {tab === "graphics" && (
            <IconSettings
              settings={draft}
              assets={assets}
              busy={locked}
              onChange={update}
              onUpload={uploadGraphic}
            />
          )}
          {tab === "media" && (
            <MediaLibrary
              assets={assets}
              draft={draft}
              saved={settings}
              busy={locked}
              onUpload={(file) => run(() => uploadAsset(file))}
              onDelete={deleteAssets}
              onConfirm={ask}
            />
          )}
          {tab === "groups" && (
            <GroupSettings catalog={cat} onChange={setCat} />
          )}
          {tab === "copy" && (
            <section className="admin-panel">
              <p>
                Заголовки, подписи, кнопки и подсказки сайта. Пользовательские
                названия велосипедов и деталей здесь не меняются.
              </p>
              <WizardCopy settings={draft} onChange={update} />
              <label className="search admin-search">
                <Search size={18} />
                <input
                  aria-label="Найти текст сайта"
                  placeholder="Найти текст"
                  value={textSearch}
                  onChange={(e) => setTextSearch(e.target.value)}
                />
              </label>
              {copyBlocks.map((block) => {
                const keys = block.keys.filter((key) =>
                  (key + " " + (draft.copy[key] || ""))
                    .toLowerCase()
                    .includes(textSearch.toLowerCase()),
                );
                return keys.length ? (
                  <details
                    className="copy-block"
                    key={block.id}
                    open={!!textSearch}
                  >
                    <summary>
                      {block.name} <small>{keys.length}</small>
                    </summary>
                    {keys.map((key) => (
                      <div className="copy-row" key={key}>
                        <Field label={key}>
                          <textarea
                            rows={2}
                            maxLength={2000}
                            value={draft.copy[key] ?? key}
                            onChange={(e) =>
                              update("copy", {
                                ...draft.copy,
                                [key]: e.target.value,
                              })
                            }
                          />
                        </Field>
                        <button
                          type="button"
                          className="quiet"
                          disabled={!(key in draft.copy)}
                          onClick={() => {
                            const next = { ...draft.copy };
                            delete next[key];
                            update("copy", next);
                          }}
                        >
                          Сбросить
                        </button>
                      </div>
                    ))}
                  </details>
                ) : null;
              })}
            </section>
          )}
          {tab === "catalog" && <CatalogEditor value={cat} onChange={setCat} />}
          {tab === "users" && (
            <section className="admin-panel">
              <form
                className="list-add"
                onSubmit={(e) => {
                  e.preventDefault();
                  setPage(1);
                  run(() => loadUsers(userSearch, 1));
                }}
              >
                <input
                  aria-label="Поиск пользователей"
                  placeholder="Имя или email"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                />
                <button className="button secondary" disabled={locked}>
                  <Search size={18} />
                  Найти
                </button>
              </form>
              <p className="help">Найдено: {total}</p>
              <div className="users-list">
                {users.map((u) => (
                  <article key={u.id}>
                    <div>
                      <strong>{u.name}</strong>
                      <span>{u.email}</span>
                      <small>
                        {u.role === "admin" ? "Администратор" : "Пользователь"}{" "}
                        · {u.blocked ? "Заблокирован" : "Активен"} ·
                        Велосипедов: {u.bikes}
                      </small>
                    </div>
                    <div className="user-actions">
                      <button
                        className="button secondary"
                        onClick={() => setEditUser(u)}
                      >
                        Изменить
                      </button>
                      <button
                        className="quiet"
                        disabled={locked}
                        onClick={() =>
                          ask(
                            "Завершить все сессии?",
                            "Пользователю потребуется войти заново.",
                            async () => {
                              await request(
                                "admin/users/" + u.id + "/sessions",
                                "DELETE",
                              );
                              setNotice("Сессии завершены");
                              // New session: reload the server viewer and discard private client state.
                              // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                              if (u.id === user.id) window.location.assign("/");
                            },
                          )
                        }
                      >
                        Сессии
                      </button>
                      <button
                        className="icon danger"
                        aria-label={"Удалить пользователя " + u.email}
                        disabled={
                          u.id === user.id || u.role === "admin" || locked
                        }
                        onClick={() =>
                          ask(
                            "Удалить пользователя?",
                            "Будут удалены аккаунт, все его велосипеды и фотографии. Для подтверждения введите email.",
                            async (email) => {
                              await request("admin/users/" + u.id, "DELETE", {
                                confirmEmail: email,
                              });
                              await loadUsers();
                              setNotice("Пользователь удалён");
                            },
                            u.email,
                          )
                        }
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              <div className="pager">
                <button
                  className="button secondary"
                  disabled={page === 1 || locked}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Назад
                </button>
                <span>
                  {page} / {Math.max(1, Math.ceil(total / 20))}
                </span>
                <button
                  className="button secondary"
                  disabled={page * 20 >= total || locked}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Далее
                </button>
              </div>
            </section>
          )}
          {tab === "audit" && (
            <section className="admin-panel">
              <p>Последние 100 действий администраторов.</p>
              <div className="audit-list">
                {events.map((event) => (
                  <article key={event.id}>
                    <strong>{event.action}</strong>
                    <span>
                      {event.actor || "Удалённый пользователь"} ·{" "}
                      {new Date(event.created_at).toLocaleString("ru-RU")}
                    </span>
                    <code>{event.target}</code>
                  </article>
                ))}
              </div>
              {!events.length && <p>Действий пока нет.</p>}
            </section>
          )}
          {canSave && (
            <div className="admin-save" data-dirty={currentDirty}>
              <span>
                {currentDirty
                  ? "Есть несохранённые изменения"
                  : "Изменения сохранены"}
              </span>
              <div>
                <button
                  className="quiet"
                  disabled={locked || !currentDirty}
                  onClick={() => {
                    if (isCatalog) setCat(catalog);
                    else setDraft(settings);
                    setError("");
                  }}
                >
                  Отменить изменения
                </button>
                <button
                  className="button"
                  disabled={locked || !currentDirty}
                  onClick={isCatalog ? saveCatalog : saveSettings}
                >
                  <Save size={17} />
                  {busy ? "Сохраняем…" : "Сохранить"}
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
      <dialog
        ref={dialog}
        aria-labelledby="admin-dialog-title"
        onCancel={(event) => {
          event.preventDefault();
          if (!locked) {
            setEditUser(null);
            setConfirm(null);
          }
        }}
      >
        <div className="modal-head">
          <h2 id="admin-dialog-title">
            {editUser ? "Пользователь" : confirm?.title}
          </h2>
          <button
            className="icon"
            disabled={locked}
            aria-label="Закрыть"
            onClick={() => {
              setEditUser(null);
              setConfirm(null);
            }}
          >
            <X size={20} />
          </button>
        </div>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {editUser && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              run(async () => {
                await request("admin/users/" + editUser.id, "PATCH", editUser);
                await loadUsers();
                setEditUser(null);
                setNotice("Пользователь обновлён, его сессии отозваны");
              });
            }}
          >
            <Field label="Имя">
              <input
                required
                maxLength={60}
                value={editUser.name}
                onChange={(e) =>
                  setEditUser({ ...editUser, name: e.target.value })
                }
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                required
                maxLength={254}
                value={editUser.email}
                onChange={(e) =>
                  setEditUser({ ...editUser, email: e.target.value })
                }
              />
            </Field>
            <Select
              label="Роль"
              value={editUser.role}
              onChange={(v) => setEditUser({ ...editUser, role: v })}
              options={[
                ["user", "Пользователь"],
                ["admin", "Администратор"],
              ]}
            />
            <Toggle
              label="Заблокировать аккаунт"
              checked={editUser.blocked}
              onChange={(v) => setEditUser({ ...editUser, blocked: v })}
            />
            <p className="help">
              Администратор управляет всем сайтом и пользователями. Изменение
              профиля завершает существующие сессии.
            </p>
            <button className="button block" disabled={locked}>
              Сохранить пользователя
            </button>
          </form>
        )}
        {confirm && (
          <>
            <p>{confirm.description}</p>
            {confirm.email && (
              <Field label="Email для подтверждения">
                <input
                  value={confirmEmail}
                  onChange={(e) => setConfirmEmail(e.target.value)}
                  placeholder={confirm.email}
                />
              </Field>
            )}
            <div className="form-actions">
              <button
                className="button secondary"
                disabled={locked}
                onClick={() => setConfirm(null)}
              >
                Отмена
              </button>
              <button
                className="button"
                disabled={
                  locked || (confirm.email && confirmEmail !== confirm.email)
                }
                onClick={() =>
                  run(async () => {
                    await confirm.action(confirmEmail);
                    setConfirm(null);
                  })
                }
              >
                Подтвердить
              </button>
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}
