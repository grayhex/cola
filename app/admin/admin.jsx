"use client";
import ScoringSettings from "./scoring-settings.jsx";
import { BlockSettings, GroupSettings } from "./layout-settings.jsx";
import { copyBlocks } from "../../lib/copy-blocks.js";
import ResolverSettings from "./resolver-settings.jsx";
import { useEffect, useState, useRef } from "react";
import {
  ArrowLeft,
  Check,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Upload,
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
} from "lucide-react";
import { useSite } from "../ui/site-provider.jsx";
import PartIcon from "../ui/part-icon.jsx";
import { iconNames, categoryIcons } from "../../lib/part-icons.js";
import { uiCopy } from "../../lib/ui-copy.js";
import { defaultSettings, fontStacks } from "../../lib/site-defaults.js";

async function request(url, method = "GET", data) {
  const r = await fetch("/api/" + url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : undefined,
    body: data ? JSON.stringify(data) : undefined,
  });
  const b = await r.json();
  if (!r.ok) throw new Error(b.error || "Не удалось выполнить действие");
  return b;
}
function Field({ label, help, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {help && <small>{help}</small>}
    </label>
  );
}
function Select({ label, value, onChange, options }) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => (
          <option value={v} key={v}>
            {l}
          </option>
        ))}
      </select>
    </Field>
  );
}
function Toggle({ label, checked, onChange }) {
  return (
    <label className="admin-toggle">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
function ListEditor({ values, onChange, label }) {
  const [newValue, setNew] = useState("");
  function move(i, d) {
    const a = [...values];
    [a[i], a[i + d]] = [a[i + d], a[i]];
    onChange(a);
  }
  return (
    <div className="list-editor">
      <div className="list-add">
        <input
          aria-label={"Новое значение: " + label}
          placeholder="Новое название"
          value={newValue}
          onChange={(e) => setNew(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (newValue.trim() && !values.includes(newValue.trim())) {
                onChange([...values, newValue.trim()]);
                setNew("");
              }
            }
          }}
        />
        <button
          type="button"
          className="button secondary"
          disabled={!newValue.trim() || values.includes(newValue.trim())}
          onClick={() => {
            onChange([...values, newValue.trim()]);
            setNew("");
          }}
        >
          <Plus size={18} />
          Добавить
        </button>
      </div>
      <p className="help">
        {values.length} записей. Названия можно редактировать; стрелки меняют
        порядок.
      </p>
      {values.map((v, i) => (
        <div className="list-row" key={i}>
          <input
            aria-label={label + " " + (i + 1)}
            value={v}
            maxLength={150}
            onChange={(e) =>
              onChange(values.map((x, n) => (n === i ? e.target.value : x)))
            }
          />
          <button
            type="button"
            className="icon"
            aria-label="Выше"
            disabled={i === 0}
            onClick={() => move(i, -1)}
          >
            <ChevronUp size={17} />
          </button>
          <button
            type="button"
            className="icon"
            aria-label="Ниже"
            disabled={i === values.length - 1}
            onClick={() => move(i, 1)}
          >
            <ChevronDown size={17} />
          </button>
          <button
            type="button"
            className="icon danger"
            aria-label={"Убрать " + v}
            onClick={() => onChange(values.filter((_, n) => n !== i))}
          >
            <Trash2 size={17} />
          </button>
        </div>
      ))}
    </div>
  );
}
const sections = [
  ["overview", "Обзор", Settings2],
  ["scoring", "Оценка велосипедов", Settings2],
  ["resolver", "Bike Resolver", Settings2],
  ["design", "Оформление", Palette],
  ["blocks", "Блоки карточки", Settings2],
  ["groups", "Группы деталей", BookOpen],
  ["copy", "Тексты", Type],
  ["catalog", "Справочники", BookOpen],
  ["users", "Пользователи", Users],
  ["media", "Медиа", Image],
  ["audit", "Журнал", History],
];
export default function Admin() {
  const { settings, catalog, setSite } = useSite();
  const [tab, setTab] = useState("overview"),
    [user, setUser] = useState(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [draft, setDraft] = useState(settings),
    [cat, setCat] = useState(catalog),
    [sv, setSv] = useState(1),
    [cv, setCv] = useState(1),
    [stats, setStats] = useState({}),
    [assets, setAssets] = useState([]),
    [events, setEvents] = useState([]),
    [textSearch, setTextSearch] = useState("");
  const [users, setUsers] = useState([]),
    [userSearch, setUserSearch] = useState(""),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [editUser, setEditUser] = useState(null),
    [confirm, setConfirm] = useState(null),
    [confirmEmail, setConfirmEmail] = useState("");
  const file = useRef(),
    dialog = useRef();
  const dirtySettings = JSON.stringify(draft) !== JSON.stringify(settings),
    dirtyCatalog = JSON.stringify(cat) !== JSON.stringify(catalog),
    dirty = dirtySettings || dirtyCatalog;
  useEffect(() => {
    const warn = (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    if (editUser || confirm) dialog.current?.showModal();
    else dialog.current?.close();
  }, [editUser, confirm]);
  async function run(fn) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function loadUsers(q = userSearch, p = page) {
    const r = await request(`admin/users?q=${encodeURIComponent(q)}&page=${p}`);
    setUsers(r.users);
    setTotal(r.total);
  }
  async function reload() {
    const r = await request("admin/overview");
    setUser(r.user);
    setStats(r.stats);
    setDraft(r.settings);
    setCat(r.catalog);
    setSv(r.settingsVersion);
    setCv(r.catalogVersion);
    setSite(r);
    setAssets((await request("admin/assets")).assets);
  }
  useEffect(() => {
    request("me")
      .then(async (r) => {
        setUser(r.user);
        if (r.user?.role === "admin") await reload();
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (user?.role !== "admin") return;
    if (tab === "users") run(() => loadUsers());
    if (tab === "media")
      run(async () => setAssets((await request("admin/assets")).assets));
    if (tab === "audit")
      run(async () => setEvents((await request("admin/audit")).events));
  }, [tab, page]);
  const update = (k, v) => setDraft((s) => ({ ...s, [k]: v }));
  async function saveSettings() {
    await run(async () => {
      const r = await request("admin/settings", "PUT", {
        value: draft,
        version: sv,
      });
      setSv(r.version);
      setSite((prev) => ({
        ...prev,
        settings: draft,
        settingsVersion: r.version,
      }));
      setNotice("Настройки опубликованы на сайте");
    });
  }
  async function saveCatalog() {
    await run(async () => {
      const r = await request("admin/catalog", "PUT", {
        value: cat,
        version: cv,
      });
      setCv(r.version);
      setSite((prev) => ({ ...prev, catalog: cat, catalogVersion: r.version }));
      setNotice("Справочники обновлены");
    });
  }
  function ask(title, description, action, email) {
    setConfirm({ title, description, action, email });
    setConfirmEmail("");
  }
  function assetSelect(key, label) {
    return (
      <Select
        label={label}
        value={draft[key] || ""}
        onChange={(v) => update(key, v || null)}
        options={[["", "По умолчанию"], ...assets.map((a) => [a.id, a.name])]}
      />
    );
  }
  if (loading)
    return (
      <main className="loading">
        <LoaderCircle className="spin" />
        Открываем управление…
      </main>
    );
  if (user?.role !== "admin")
    return (
      <main className="empty">
        <ShieldCheck size={40} />
        <h1>Вход для администратора</h1>
        <p>
          {user
            ? "У этого аккаунта нет прав администратора."
            : "Войдите в аккаунт администратора на главной странице."}
        </p>
        <a className="button" href="/">
          Открыть ColaBike
        </a>
        <p className="help">
          Первого администратора назначает владелец сервера через команду из
          README.
        </p>
        {error && <p role="alert">{error}</p>}
      </main>
    );
  return (
    <div className="admin-shell">
      <header className="admin-header">
        <a href="/" className="text-link">
          <ArrowLeft size={18} />
          На сайт
        </a>
        <strong>
          {settings.siteName} <span>Управление</span>
        </strong>
        <span className="admin-account">
          <ShieldCheck size={17} />
          {user.name}
        </span>
      </header>
      <div className="admin-layout">
        <nav className="admin-nav" aria-label="Разделы админки">
          {sections.map(([id, label, Icon]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => {
                setTab(id);
                setError("");
                setNotice("");
              }}
            >
              <Icon size={19} />
              {label}
              {((["design", "copy", "overview", "blocks", "scoring"].includes(id) &&
                dirtySettings) ||
                (["catalog", "groups"].includes(id) && dirtyCatalog)) && (
                <span
                  className="unsaved-dot"
                  aria-label="Есть несохранённые изменения"
                />
              )}
            </button>
          ))}
        </nav>
        <main className="admin-content">
          <div className="admin-title">
            <div>
              <span className="eyebrow">COLABIKE / ADMIN</span>
              <h1>{sections.find((s) => s[0] === tab)[1]}</h1>
            </div>
            {busy && (
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
          {tab === "scoring" && <ScoringSettings value={draft.scoring} catalog={catalog} onChange={v=>update("scoring",v)}/>}
          {tab === "resolver" && <ResolverSettings />}
          {tab === "overview" && (
            <>
              <div className="admin-stats">
                {[
                  ["Пользователей", stats.users],
                  ["Велосипедов", stats.bikes],
                  ["Фотографий", stats.photos],
                ].map(([l, n]) => (
                  <div key={l}>
                    <span>{l}</span>
                    <strong>{n ?? 0}</strong>
                  </div>
                ))}
              </div>
              <section className="admin-panel">
                <h2>Основные настройки</h2>
                <Field label="Название сайта">
                  <input
                    maxLength={150}
                    value={draft.siteName}
                    onChange={(e) => update("siteName", e.target.value)}
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
                <Toggle
                  label="Показывать подпись под шапкой"
                  checked={draft.showTagline}
                  onChange={(v) => update("showTagline", v)}
                />
              </section>
              <p className="help">
                Адрес сервера, доступ к БД и secure-cookie задаются в окружении
                Docker. Секреты не передаются в браузер.
              </p>
            </>
          )}
          {tab === "design" && (
            <>
              <section className="admin-panel">
                <h2>Тема и типографика</h2>
                <div className="admin-form-grid">
                  <Select
                    label="Тема сайта"
                    value={draft.theme}
                    onChange={(v) => update("theme", v)}
                    options={[
                      ["light", "Светлая"],
                      ["dark", "Тёмная"],
                      ["system", "Как на устройстве"],
                    ]}
                  />
                  <Select
                    label="Шрифт"
                    value={draft.font}
                    onChange={(v) => update("font", v)}
                    options={[
                      ["manrope", "Manrope"],
                      ["system", "Системный"],
                      ["arial", "Arial"],
                      ["georgia", "Georgia"],
                      ["mono", "Моноширинный"],
                    ]}
                  />
                  <Field label="Акцентный цвет">
                    <input
                      type="color"
                      value={draft.accent}
                      onChange={(e) => update("accent", e.target.value)}
                    />
                  </Field>
                  <Field label={"Скругления: " + draft.radius + " px"}>
                    <input
                      type="range"
                      min="0"
                      max="28"
                      value={draft.radius}
                      onChange={(e) => update("radius", Number(e.target.value))}
                    />
                  </Field>
                </div>
                <div
                  className="design-preview"
                  style={{
                    fontFamily: fontStacks[draft.font],
                    borderRadius: draft.radius,
                    background: draft.theme === "dark" ? "#202724" : "#f3f5f0",
                    color: draft.theme === "dark" ? "#f3f5f0" : "#202724",
                  }}
                >
                  <span>Предпросмотр оформления</span>
                  <h2>{draft.siteName}</h2>
                  <p>Ваш велосипед. Каждая деталь на своём месте.</p>
                  <span
                    className="preview-button"
                    style={{ background: draft.accent }}
                  >
                    Добавить велосипед
                  </span>
                </div>
              </section>
              <section className="admin-panel">
                <h2>Расположение элементов</h2>
                <div
                  className="layout-presets"
                  role="radiogroup"
                  aria-label="Компоновка велосипеда"
                >
                  {[
                    [
                      "dense",
                      "Максимально компактно",
                      "Маленькое фото, мелкий шрифт, две колонки деталей.",
                    ],
                    [
                      "balanced",
                      "Сбалансированно",
                      "Умеренные отступы и компактная комплектация.",
                    ],
                    [
                      "spacious",
                      "Подробно",
                      "Большое фото, крупнее текст, свободная одноколоночная комплектация.",
                    ],
                  ].map(([value, title, description]) => (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={draft.bikeLayout === value}
                      className={"layout-preset " + value}
                      key={value}
                      onClick={() => update("bikeLayout", value)}
                    >
                      <span className="layout-mini" aria-hidden="true">
                        <i />
                        <b />
                        <b />
                        <b />
                      </span>
                      <strong>{title}</strong>
                      <small>{description}</small>
                    </button>
                  ))}
                </div>
                <p className="help">
                  Компактная схема поднимает комплектацию на первый экран;
                  длинные списки остаются доступны прокруткой. Порядок и
                  видимость блоков задаются отдельно.
                </p>
                <button className="quiet" onClick={() => setTab("blocks")}>
                  Настроить блоки карточки →
                </button>
                <div className="admin-form-grid">
                  <Select
                    label="Выравнивание заголовков"
                    value={draft.textAlign}
                    onChange={(v) => update("textAlign", v)}
                    options={[
                      ["left", "По левому краю"],
                      ["center", "По центру"],
                    ]}
                  />
                  <Select
                    label="Карточек в ряд на компьютере"
                    value={String(draft.desktopColumns)}
                    onChange={(v) => update("desktopColumns", Number(v))}
                    options={[
                      ["2", "Две"],
                      ["3", "Три"],
                      ["4", "Четыре"],
                    ]}
                  />
                  <Select
                    label="Отображение фотографии"
                    value={draft.photoMode}
                    onChange={(v) => update("photoMode", v)}
                    options={[
                      ["natural", "Целиком, без внешних полей"],
                      ["cover", "Заполнить блок с кадрированием"],
                    ]}
                  />
                  <Select
                    label="Пропорции при кадрировании"
                    value={draft.photoRatio}
                    onChange={(v) => update("photoRatio", v)}
                    options={[
                      ["4/3", "4:3"],
                      ["3/2", "3:2"],
                      ["16/9", "16:9"],
                      ["1/1", "Квадрат"],
                    ]}
                  />
                </div>
                <p className="help">
                  На телефоне — одна колонка, фото на всю ширину и паспорт под
                  ним. Любую фотографию можно открыть целиком.
                </p>
              </section>
              <section className="admin-panel">
                <h2>Логотипы и графика</h2>
                <p>
                  Сначала загрузите изображения в разделе «Медиа», затем
                  выберите их здесь.
                </p>
                <div className="admin-form-grid">
                  {assetSelect("logoId", "Логотип в шапке")}
                  {assetSelect("mtbImageId", "Стоковое изображение — MTB")}
                  {assetSelect("roadImageId", "Стоковое изображение — шоссе")}
                  {assetSelect(
                    "gravelImageId",
                    "Стоковое изображение — гравел",
                  )}
                  {assetSelect("faviconId", "Иконка вкладки")}
                  {assetSelect("demoImageId", "Фото демонстрационного байка")}
                  {assetSelect("garageImageId", "Изображение над гаражом")}
                </div>
                <button className="quiet" onClick={() => setTab("media")}>
                  <Upload size={16} />
                  Открыть медиатеку
                </button>
              </section>
            </>
          )}
          {tab === "blocks" && (
            <BlockSettings settings={draft} onChange={update} />
          )}
          {tab === "groups" && (
            <GroupSettings catalog={cat} onChange={setCat} />
          )}
          {tab === "copy" && (
            <section className="admin-panel">
              <p>
                Заголовки, подписи, кнопки и подсказки сайта. Пустое
                переопределение можно сбросить отдельно. Пользовательские
                названия велосипедов и деталей здесь не меняются.
              </p>
              <label className="search admin-search">
                <Search size={18} />
                <input
                  aria-label="Найти текст сайта"
                  placeholder="Найти текст"
                  value={textSearch}
                  onChange={(e) => setTextSearch(e.target.value)}
                />
              </label>
              {copyBlocks.map((group) => {
                const keys = group.keys.filter((k) =>
                  (k + " " + (draft.copy[k] || ""))
                    .toLowerCase()
                    .includes(textSearch.toLowerCase()),
                );
                return keys.length ? (
                  <details
                    className="copy-block"
                    key={group.id}
                    open={!!textSearch}
                  >
                    <summary>
                      {group.name} <small>{keys.length}</small>
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
          {tab === "media" && (
            <>
              <section className="admin-panel">
                <div className="panel-heading">
                  <div>
                    <h2>Медиатека сайта</h2>
                    <p>
                      Логотипы, иконка вкладки и иллюстрации. JPEG, PNG, WebP до
                      10 МБ. Эти изображения публичны.
                    </p>
                  </div>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => file.current.click()}
                  >
                    <Upload size={18} />
                    Загрузить
                  </button>
                </div>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  ref={file}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f) return;
                    run(async () => {
                      if (f.size > 10 * 1024 * 1024)
                        throw new Error("Максимальный размер 10 МБ");
                      const r = await fetch(
                        "/api/admin/assets?name=" + encodeURIComponent(f.name),
                        {
                          method: "POST",
                          headers: { "Content-Type": f.type },
                          body: f,
                        },
                      );
                      const b = await r.json();
                      if (!r.ok) throw new Error(b.error);
                      setAssets((await request("admin/assets")).assets);
                      setNotice(
                        "Изображение загружено. Выберите его в оформлении.",
                      );
                    });
                  }}
                />
                <div className="asset-grid">
                  {assets.map((a) => (
                    <article key={a.id}>
                      <img src={"/api/assets/" + a.id} alt={a.name} />
                      <strong>{a.name}</strong>
                      <button
                        className="quiet danger"
                        disabled={busy}
                        onClick={() =>
                          ask(
                            "Удалить изображение?",
                            "Действие нельзя отменить. Изображения, используемые сайтом, удалить нельзя.",
                            async () => {
                              await request("admin/assets/" + a.id, "DELETE");
                              setAssets((await request("admin/assets")).assets);
                              setNotice("Изображение удалено");
                            },
                          )
                        }
                      >
                        <Trash2 size={16} />
                        Удалить
                      </button>
                    </article>
                  ))}
                </div>
                {!assets.length && (
                  <p className="empty-parts">Загрузите первое изображение.</p>
                )}
              </section>
            </>
          )}
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
                <button className="button secondary" disabled={busy}>
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
                        disabled={busy}
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
                        disabled={u.id === user.id || u.role === "admin"}
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
              <div className="pagination">
                <button
                  className="button secondary"
                  disabled={page === 1 || busy}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Назад
                </button>
                <span>
                  {page} / {Math.max(1, Math.ceil(total / 20))}
                </span>
                <button
                  className="button secondary"
                  disabled={page * 20 >= total || busy}
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
                {events.map((e) => (
                  <article key={e.id}>
                    <strong>{e.action}</strong>
                    <span>
                      {e.actor || "Удалённый пользователь"} ·{" "}
                      {new Date(e.created_at).toLocaleString("ru-RU")}
                    </span>
                    <code>{e.target}</code>
                  </article>
                ))}
              </div>
              {!events.length && <p>Действий пока нет.</p>}
            </section>
          )}
          {["overview", "design", "copy", "catalog", "scoring"].includes(tab) && (
            <div className="admin-save">
              <span>
                {(tab === "catalog" ? dirtyCatalog : dirtySettings)
                  ? "Есть несохранённые изменения"
                  : "Изменения сохранены"}
              </span>
              <div>
                <button
                  className="quiet"
                  disabled={
                    busy || !(tab === "catalog" ? dirtyCatalog : dirtySettings)
                  }
                  onClick={() => {
                    if (tab === "catalog") setCat(catalog);
                    else setDraft(settings);
                    setError("");
                  }}
                >
                  Отменить изменения
                </button>
                <button
                  className="button"
                  disabled={
                    busy || !(tab === "catalog" ? dirtyCatalog : dirtySettings)
                  }
                  onClick={tab === "catalog" ? saveCatalog : saveSettings}
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
        onCancel={(e) => {
          e.preventDefault();
          if (!busy) {
            setEditUser(null);
            setConfirm(null);
          }
        }}
        aria-labelledby="admin-dialog-title"
      >
        <div className="modal-head">
          <h2 id="admin-dialog-title">
            {editUser ? "Пользователь" : confirm?.title}
          </h2>
          <button
            className="icon"
            disabled={busy}
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
            onSubmit={(e) => {
              e.preventDefault();
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
            <button className="button full" disabled={busy}>
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
                disabled={busy}
                onClick={() => setConfirm(null)}
              >
                Отмена
              </button>
              <button
                className="button"
                disabled={
                  busy || (confirm.email && confirmEmail !== confirm.email)
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
function CatalogEditor({ value: c, onChange }) {
  const [kind, setKind] = useState("bikes"),
    [type, setType] = useState("gravel"),
    [brand, setBrand] = useState(""),
    [newBrand, setNewBrand] = useState(""),
    [brandName, setBrandName] = useState(""),
    [section, setSection] = useState("build"),
    [category, setCategory] = useState("");
  const brands = Object.keys(c.models[type]);
  const selectedBrand = brands.includes(brand) ? brand : brands[0] || "";
  const allCategories = Array.from(
    new Set([
      ...c.partCategories.build,
      ...c.partCategories.accessories,
      ...Object.keys(c.parts),
    ]),
  );
  const selectedCategory = allCategories.includes(category)
    ? category
    : allCategories[0] || "";
  function models(next) {
    onChange({ ...c, models: { ...c.models, [type]: next } });
  }
  return (
    <section className="admin-panel">
      <div className="catalog-tabs">
        {[
          ["bikes", "Марки и модели"],
          ["manufacturers", "Производители"],
          ["categories", "Категории навески"],
          ["parts", "Модели компонентов"],
          ["types", "Типы велосипедов"],
        ].map(([k, l]) => (
          <button
            key={k}
            className={kind === k ? "active" : ""}
            onClick={() => setKind(k)}
          >
            {l}
          </button>
        ))}
      </div>
      <p className="help">
        Изменения применяются к подсказкам для новых записей. Сохранённые
        велосипеды и детали не меняются.
      </p>
      {kind === "bikes" && (
        <>
          <Select
            label="Тип велосипеда"
            value={type}
            onChange={(v) => {
              setType(v);
              setBrand("");
              setBrandName("");
            }}
            options={Object.entries(c.categories)}
          />
          <div className="list-add">
            <input
              aria-label="Новая марка"
              value={newBrand}
              placeholder="Новая марка велосипеда"
              onChange={(e) => setNewBrand(e.target.value)}
            />
            <button
              className="button secondary"
              disabled={!newBrand.trim() || brands.includes(newBrand.trim())}
              onClick={() => {
                models({ ...c.models[type], [newBrand.trim()]: [] });
                setBrand(newBrand.trim());
                setNewBrand("");
              }}
            >
              <Plus size={17} />
              Добавить
            </button>
          </div>
          {brands.length > 0 && (
            <>
              <Select
                label="Марка"
                value={selectedBrand}
                onChange={(v) => {
                  setBrand(v);
                  setBrandName("");
                }}
                options={brands.map((b) => [b, b])}
              />
              <div className="list-add">
                <input
                  aria-label="Новое название марки"
                  value={brandName}
                  placeholder={"Переименовать " + selectedBrand}
                  onChange={(e) => setBrandName(e.target.value)}
                />
                <button
                  className="button secondary"
                  disabled={
                    !brandName.trim() || brands.includes(brandName.trim())
                  }
                  onClick={() => {
                    models(
                      Object.fromEntries(
                        Object.entries(c.models[type]).map(([k, v]) => [
                          k === selectedBrand ? brandName.trim() : k,
                          v,
                        ]),
                      ),
                    );
                    setBrand(brandName.trim());
                    setBrandName("");
                  }}
                >
                  Переименовать
                </button>
              </div>
              <h3>Модели {selectedBrand}</h3>
              <ListEditor
                label="Модель велосипеда"
                values={c.models[type][selectedBrand] || []}
                onChange={(a) =>
                  models({ ...c.models[type], [selectedBrand]: a })
                }
              />
              <button
                className="quiet danger"
                onClick={() => {
                  const next = { ...c.models[type] };
                  delete next[selectedBrand];
                  models(next);
                  setBrand("");
                }}
              >
                Убрать марку из справочника
              </button>
            </>
          )}
        </>
      )}
      {kind === "manufacturers" && (
        <ListEditor
          label="Производитель"
          values={c.manufacturers}
          onChange={(a) => onChange({ ...c, manufacturers: a })}
        />
      )}
      {kind === "categories" && (
        <>
          <Select
            label="Раздел"
            value={section}
            onChange={setSection}
            options={[
              ["build", "Комплектация"],
              ["accessories", "Аксессуары"],
            ]}
          />
          <ListEditor
            label="Категория"
            values={c.partCategories[section]}
            onChange={(a) =>
              onChange({
                ...c,
                partCategories: { ...c.partCategories, [section]: a },
              })
            }
          />
          <p className="help">
            После переименования категории её модели останутся под прежним
            названием. Их можно перенести в разделе «Модели компонентов».
          </p>
        </>
      )}
      {kind === "parts" && (
        <>
          <Select
            label="Категория компонента"
            value={selectedCategory}
            onChange={setCategory}
            options={allCategories.map((x) => [x, x])}
          />
          <div className="icon-picker">
            <PartIcon category={selectedCategory} icons={c.icons} size={42} />
            <Select
              label="Иконка категории"
              value={
                c.icons[selectedCategory] ||
                categoryIcons[selectedCategory] ||
                "other"
              }
              onChange={(v) =>
                onChange({ ...c, icons: { ...c.icons, [selectedCategory]: v } })
              }
              options={iconNames.map((k) => [
                k,
                Object.entries(categoryIcons).find(([, v]) => v === k)?.[0] ||
                  k,
              ])}
            />
          </div>
          <ListEditor
            label="Модель компонента"
            values={c.parts[selectedCategory] || []}
            onChange={(a) =>
              onChange({ ...c, parts: { ...c.parts, [selectedCategory]: a } })
            }
          />
          <Select
            label="Скопировать модели в другую категорию"
            value=""
            onChange={(target) => {
              if (target)
                onChange({
                  ...c,
                  parts: {
                    ...c.parts,
                    [target]: Array.from(
                      new Set([
                        ...(c.parts[target] || []),
                        ...(c.parts[selectedCategory] || []),
                      ]),
                    ),
                  },
                });
            }}
            options={[
              ["", "Выберите категорию"],
              ...allCategories
                .filter((k) => k !== selectedCategory)
                .map((k) => [k, k]),
            ]}
          />
        </>
      )}
      {kind === "types" &&
        Object.entries(c.categories).map(([key, label]) => (
          <Field key={key} label={"Название типа: " + key}>
            <input
              value={label}
              onChange={(e) =>
                onChange({
                  ...c,
                  categories: { ...c.categories, [key]: e.target.value },
                })
              }
            />
          </Field>
        ))}
    </section>
  );
}
