"use client";
import PhotoSearch from "./photo-search.jsx";
import Versions from "./versions.jsx";
import { parseBikeName } from "../../lib/bike-name.js";
import GroupedComponents from "./grouped-components.jsx";
import { defaultBlocks } from "../../lib/garage-layout.js";
import FactorySpecification from "./factory-specification.jsx";
import { useEffect, useRef, useState } from "react";
import {
  Bike,
  Plus,
  ArrowUpRight,
  ArrowLeft,
  X,
  Lock,
  Globe,
  Copy,
  Check,
  Pencil,
  Trash2,
  Camera,
  LogOut,
  ChevronRight,
  Search,
  Package,
  Settings2,
  LoaderCircle,
} from "lucide-react";
import { useSite } from "./site-provider.jsx";
import PartIcon from "./part-icon.jsx";

const demo = {
  id: "demo",
  name: "Дальше асфальта",
  brand: "Canyon",
  model: "Grizl",
  year: 2025,
  category: "gravel",
  size: "M",
  color: "Affogato",
  weight: 10.8,
  description:
    "Для тихих просёлков, длинных выходных и маршрутов, которые хочется повторить.",
  is_public: false,
  photos: [],
  components: [
    {
      id: "1",
      section: "build",
      category: "Рама",
      name: "Canyon Grizl AL",
      notes: "Алюминий · размер M",
    },
    {
      id: "2",
      section: "build",
      category: "Групсет",
      name: "Shimano GRX RX820",
      notes: "1 × 12",
    },
    {
      id: "3",
      section: "build",
      category: "Колёса",
      name: "DT Swiss G 1800 SPLINE",
      notes: "700C · алюминий",
    },
    {
      id: "4",
      section: "build",
      category: "Покрышки",
      name: "Schwalbe G-One Bite",
      notes: "45 мм · бескамерно",
    },
    {
      id: "5",
      section: "build",
      category: "Седло",
      name: "Brooks C17",
      notes: "Чёрное",
      price: "12500",
    },
    {
      id: "6",
      section: "build",
      category: "Педали",
      name: "Shimano XT PD-M8100",
      notes: "Контактные SPD",
    },
    {
      id: "7",
      section: "accessories",
      category: "Велокомпьютер",
      name: "Garmin Edge 540",
      notes: "",
    },
    {
      id: "8",
      section: "accessories",
      category: "Рамная сумка",
      name: "Apidura Expedition Frame Pack",
      notes: "3 л",
    },
    {
      id: "9",
      section: "accessories",
      category: "Задний свет",
      name: "Garmin Varia RTL515",
      notes: "С радаром",
    },
  ],
};
const demoImage =
  "https://dma.canyon.com/image/upload/w_930%2Ch_487%2Cc_fit/f_auto/q_auto/v1760425750/2025_FULL_grizl_al-7-raw_4527_R075_P08_ujmfyh";
const blankBike = {
  name: "",
  brand: "",
  model: "",
  year: new Date().getFullYear(),
  category: "gravel",
  description: "",
  color: "",
  size: "",
  weight: "",
};
const rub = (v) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(Number(v));
async function api(url, method = "GET", data) {
  const r = await fetch("/api/" + url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : undefined,
    body: data ? JSON.stringify(data) : undefined,
  });
  let b;
  try {
    b = await r.json();
  } catch {
    throw new Error("Сервер не ответил. Попробуйте ещё раз.");
  }
  if (!r.ok) throw new Error(b.error || "Не удалось выполнить запрос");
  return b;
}
function Modal({ title, onClose, children }) {
  const { settings, catalog, t } = useSite();
  const { categories, models, parts, partCategories, manufacturers } = catalog;
  const ref = useRef();
  useEffect(() => {
    const el = ref.current;
    el.showModal();
    return () => el.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-labelledby="dialog-title"
    >
      <div className="modal-head">
        <h2 id="dialog-title">{title}</h2>
        <button className="icon" aria-label={t("Закрыть")} onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Field({ label, children }) {
  const { settings, catalog, t } = useSite();
  const { categories, models, parts, partCategories, manufacturers } = catalog;
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Photo({ bike, className = "", photo }) {
  const { settings, catalog, t } = useSite();
  const { categories, models, parts, partCategories, manufacturers } = catalog;
  const [failed, setFailed] = useState(false);
  const selected = photo || bike.photos?.[0];
  const src =
    bike.id === "demo"
      ? settings.demoImageId
        ? "/api/assets/" + settings.demoImageId
        : demoImage
      : selected
        ? "/api/photos/" + selected.id
        : null;
  useEffect(() => setFailed(false), [src]);
  return src && !failed ? (
    <img
      className={className}
      src={src}
      alt={`${bike.brand} ${bike.model} — ${bike.name}`}
      onError={() => setFailed(true)}
    />
  ) : (
    <div className={"photo-empty " + className}>
      <Camera size={38} strokeWidth={1} />
      <span>{t("Фотография велосипеда")}</span>
    </div>
  );
}

export default function Garage({ share }) {
  const { settings, catalog, t } = useSite();
  const { categories, models, parts, partCategories, manufacturers } = catalog;
  const [user, setUser] = useState(null),
    [bikes, setBikes] = useState([]),
    [selected, setSelected] = useState(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [modal, setModal] = useState(null),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("build"),
    [filter, setFilter] = useState("all"),
    [query, setQuery] = useState(""),
    [searchOpen, setSearchOpen] = useState(false),
    [photo, setPhoto] = useState(null);
  const file = useRef();
  async function load() {
    if (share) {
      const data = await api("shared/" + share);
      setSelected(data.bike);
    } else {
      const { user: u } = await api("me");
      setUser(u);
      if (u) {
        const { bikes: all } = await api("bikes");
        setBikes(all);
        setSelected(
          (prev) => (prev && all.find((b) => b.id === prev.id)) || null,
        );
      }
    }
  }
  useEffect(() => {
    load()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [share]);
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(""), 4000);
      return () => clearTimeout(t);
    }
  }, [notice]);
  async function run(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const bike = share
    ? selected
    : user
      ? selected
      : settings.showDemo
        ? demo
        : null;
  const blocks = settings.detailBlocks || defaultBlocks;
  const block = (id) =>
    blocks.find((b) => b.id === id) || defaultBlocks.find((b) => b.id === id);
  const blockProps = (id) => ({
    hidden: !block(id).enabled,
    style: { order: blocks.findIndex((b) => b.id === id) + 1 },
    "data-variant": block(id).variant,
  });
  const editable = !!user && !share && bike?.id !== "demo";
  function openBike(b) {
    setSelected(b);
    setPhoto(null);
    setTab("build");
    window.scrollTo({ top: 0 });
  }
  function close() {
    if (!busy) {
      setModal(null);
      setError("");
    }
  }
  async function refresh() {
    await load();
  }
  function auth(mode = "login") {
    setError("");
    setModal({ type: "auth", mode });
  }
  const filtered = bikes.filter(
    (b) =>
      (filter === "all" || b.category === filter) &&
      `${b.name} ${b.brand} ${b.model}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <>
      <header className="header">
        <a className="brand" href="/" aria-label={t("ColaBike — главная")}>
          {settings.logoId ? (
            <img
              className="site-logo"
              src={"/api/assets/" + settings.logoId}
              alt=""
            />
          ) : (
            <span className="brand-mark">c.</span>
          )}
          {settings.siteName}
        </a>
        <div className="header-right">
          {share ? (
            <a href="/" className="text-link">
              {t("Мой гараж")}
              <ArrowUpRight size={16} />
            </a>
          ) : user ? (
            <>
              {user.role === "admin" && (
                <a className="admin-link" href="/admin">
                  <Settings2 size={18} />
                  <span>{t("Админка")}</span>
                </a>
              )}
              <span className="user-name">{user.name}</span>
              <span className="avatar">
                {user.name.slice(0, 1).toUpperCase()}
              </span>
              <button
                className="icon"
                aria-label={t("Выйти")}
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api("auth/logout", "POST");
                    setUser(null);
                    setBikes([]);
                    setSelected(null);
                  })
                }
              >
                <LogOut size={18} />
              </button>
            </>
          ) : (
            <>
              <button className="quiet" onClick={() => auth()}>
                {t("Войти")}
              </button>
              <button
                className="button small"
                disabled={!settings.registrationOpen}
                onClick={() => auth("register")}
              >
                {t("Создать гараж")}
                <ArrowUpRight size={16} />
              </button>
            </>
          )}
        </div>
      </header>
      <div className="subnav">
        <span>
          <Bike size={18} />
          {share ? t("Публичный велосипед") : t("Личный гараж")}
        </span>
        {settings.showTagline && (
          <span className="subnav-note">
            {t("КАЖДАЯ ДЕТАЛЬ ИМЕЕТ ЗНАЧЕНИЕ")}
          </span>
        )}
      </div>
      {notice && (
        <div className="toast" role="status">
          <Check size={18} />
          {notice}
        </div>
      )}
      {error && !modal && (
        <div className="error global-error" role="alert">
          {error}
          <button className="quiet" onClick={() => run(load)}>
            {t("Повторить")}
          </button>
        </div>
      )}
      {loading ? (
        <main className="loading">
          <LoaderCircle className="spin" />
          {t("Открываем гараж…")}
        </main>
      ) : share && !bike ? (
        <main className="empty">
          <Lock size={36} />
          <h1>{t("Велосипед недоступен")}</h1>
          <p>{t("Владелец мог закрыть доступ или изменить ссылку.")}</p>
          <a href="/" className="button">
            {t("Открыть ColaBike")}
          </a>
        </main>
      ) : bike ? (
        <main className="detail">
          <div className="breadcrumbs">
            {user && !share ? (
              <button
                className="quiet"
                onClick={() => {
                  setSelected(null);
                  setPhoto(null);
                }}
              >
                <ArrowLeft size={16} />
                {t("Мой гараж")}
              </button>
            ) : (
              <span>
                {share
                  ? t("Коллекция владельца")
                  : t("Пример вашего будущего гаража")}
              </span>
            )}
            <ChevronRight size={14} />
            <span>
              {bike.brand} {bike.model}
            </span>
          </div>
          <div
            className="bike-heading configurable-block"
            {...blockProps("heading")}
          >
            <div>
              <div className="eyebrow">
                <span className="category-tag">
                  {categories[bike.category]}
                </span>
                <span>{bike.year}</span>
                {bike.id === "demo" && <span>{t("ДЕМОНСТРАЦИЯ")}</span>}
              </div>
              <h1>
                {bike.brand || bike.name}{" "}
                <span>{bike.brand ? bike.model : ""}</span>
              </h1>
              <p className="nickname">{bike.brand ? bike.name : ""}</p>
            </div>
            <div className="detail-actions">
              {editable ? (
                <>
                  <button
                    className="icon bordered share-action"
                    aria-label={t("Поделиться")}
                    onClick={() => setModal({ type: "share" })}
                  >
                    {bike.is_public ? <Globe size={17} /> : <Lock size={17} />}
                    <span>{t("Поделиться")}</span>
                  </button>
                  <button
                    className="icon bordered"
                    aria-label={t("Редактировать велосипед")}
                    onClick={() => setModal({ type: "bike", bike })}
                  >
                    <Pencil size={18} />
                  </button>
                </>
              ) : !share ? (
                <button
                  className="button secondary"
                  onClick={() => auth("register")}
                >
                  {t("Добавить свой байк")}
                  <Plus size={17} />
                </button>
              ) : (
                <span className="muted">
                  <Globe size={16} />
                  {t("Доступен по ссылке")}
                </span>
              )}
            </div>
          </div>
          <div
            className="showcase configurable-block"
            {...blockProps("photos")}
          >
            <div className="photo-stage">
              <span className="photo-index">
                {String(
                  Math.max(
                    1,
                    bike.photos.findIndex((p) => p.id === photo?.id) + 1,
                  ),
                ).padStart(2, "0")}{" "}
                / {String(Math.max(1, bike.photos.length)).padStart(2, "0")}
              </span>
              <button
                className="photo-open"
                aria-label={t("Открыть фото целиком")}
                onClick={() => setModal({ type: "photoView" })}
              >
                <Photo bike={bike} photo={photo} className="hero-photo" />
              </button>
              {editable && (
                <button
                  className="photo-add"
                  disabled={busy}
                  onClick={() => file.current.click()}
                >
                  <Camera size={16} />
                  {bike.photos.length
                    ? t("Добавить фото")
                    : t("Загрузить фото")}
                </button>
              )}
              {(photo || bike.photos[0])?.source_page_url && (
                <a
                  className="photo-credit"
                  href={(photo || bike.photos[0]).source_page_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Источник фотографии
                </a>
              )}
              {bike.id === "demo" && !settings.demoImageId && (
                <a
                  className="photo-credit"
                  href="https://www.canyon.com/en-si/outlet-bikes/gravel-bikes/grizl-al-7-raw/50051247.html"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("Фото: Canyon · пример сборки")}
                </a>
              )}
            </div>
          </div>
          <details
            className="bike-summary configurable-block"
            {...blockProps("summary")}
            open={block("summary").open}
          >
            <summary>{t("О велосипеде")}</summary>
            <span className="eyebrow">{t("ПАСПОРТ ВЕЛОСИПЕДА")}</span>
            <h2>
              {t("Собран")}
              <br />
              {t("под себя.")}
            </h2>
            <p hidden={settings.summaryFields?.description === false}>
              {bike.description ||
                t(
                  "У каждого велосипеда своя история. Добавьте пару слов о вашем.",
                )}
            </p>
            <dl hidden={settings.summaryFields?.metadata === false}>
              <div>
                <dt>{t("Год")}</dt>
                <dd>{bike.year}</dd>
              </div>
              <div>
                <dt>{t("Размер рамы")}</dt>
                <dd>{bike.size || "—"}</dd>
              </div>
              <div>
                <dt>{t("Вес")}</dt>
                <dd>{bike.weight ? `${Number(bike.weight)} кг` : "—"}</dd>
              </div>
              <div>
                <dt>{t("Цвет")}</dt>
                <dd>{bike.color || "—"}</dd>
              </div>
            </dl>
            <div className="summary-bottom">
              <span>{String(bike.components.length).padStart(2, "0")}</span>
              {t("деталей в конфигурации")}
            </div>
            {bike.manufacturer_url &&
              settings.summaryFields?.manufacturer !== false && (
                <a
                  className="part-link"
                  href={bike.manufacturer_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("Сайт производителя")}
                </a>
              )}
            {bike.show_bike_price &&
              bike.price != null &&
              settings.summaryFields?.price !== false && (
                <p>
                  {t("Стоимость велосипеда")}:{" "}
                  <strong>{rub(bike.price)}</strong>
                </p>
              )}
          </details>
          {editable && (
            <button
              className="quiet photo-search-trigger"
              style={{ order: 2 }}
              onClick={() => setModal({ type: "photoSearch" })}
            >
              Найти фотографии в интернете
            </button>
          )}
          {bike.photos.length > 0 && (
            <details
              className="gallery-details configurable-block"
              {...blockProps("gallery")}
              open={block("gallery").open}
            >
              <summary>Фотографии · {bike.photos.length}</summary>
              <div className="gallery">
                {bike.photos.map((p) => (
                  <div className="thumb-wrap" key={p.id}>
                    <button
                      className={
                        "thumb " +
                        ((photo?.id || bike.photos[0].id) === p.id
                          ? "active"
                          : "")
                      }
                      aria-label={t("Показать фотографию")}
                      onClick={() => setPhoto(p)}
                    >
                      <Photo bike={bike} photo={p} />
                    </button>
                    {editable && (
                      <div className="thumb-actions">
                        <button
                          className="quiet"
                          disabled={busy || p.is_cover}
                          onClick={() =>
                            run(async () => {
                              await api(
                                `bikes/${bike.id}/photos/${p.id}`,
                                "PATCH",
                              );
                              await refresh();
                              setNotice(t("Обложка обновлена"));
                            })
                          }
                        >
                          {p.is_cover ? t("Обложка") : t("На обложку")}
                        </button>
                        <button
                          className="icon"
                          aria-label={t("Удалить фото")}
                          onClick={() =>
                            setModal({ type: "deletePhoto", photo: p })
                          }
                        >
                          <X size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </details>
          )}
          <section
            className="specifications configurable-block"
            {...blockProps("specifications")}
          >
            {bike.factory_spec && (
              <details className="factory-source">
                <summary>
                  Заводская комплектация ·{" "}
                  {bike.factory_spec.source.manufacturer}
                </summary>
                <p className="help">
                  Текущие компоненты можно менять независимо от заводской
                  комплектации.{" "}
                  <a
                    href={bike.factory_spec.source.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Источник
                  </a>
                </p>
                <dl className="resolver-preview">
                  {bike.factory_spec.components.map((c, i) => (
                    <div key={i}>
                      <dt>{c.raw.label}</dt>
                      <dd>{c.raw.value}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}
            <div className="tabs-row">
              <div
                className="tabs"
                role="tablist"
                aria-label={t("Разделы конфигурации")}
              >
                {[
                  ["build", t("Комплектация")],
                  ["accessories", t("Аксессуары")],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    role="tab"
                    aria-selected={tab === key}
                    aria-controls="parts-panel"
                    id={"tab-" + key}
                    onClick={() => setTab(key)}
                    className={tab === key ? "active" : ""}
                  >
                    {label}
                    <span>
                      {bike.components.filter((p) => p.section === key).length}
                    </span>
                  </button>
                ))}
              </div>
              {editable && (
                <button
                  className="text-link add-component"
                  onClick={() => setModal({ type: "part", section: tab })}
                >
                  <Plus size={17} />
                  {t("Добавить")}{" "}
                  {tab === "build" ? t("компонент") : t("аксессуар")}
                </button>
              )}
            </div>
            <div
              id="parts-panel"
              role="tabpanel"
              aria-labelledby={"tab-" + tab}
            >
              <div className="spec-label">
                <span>
                  {tab === "build"
                    ? t("ОСНОВА И ДЕТАЛИ")
                    : t("ВСЁ ДЛЯ ПОЕЗДКИ")}
                </span>
                <span>{t("АКТУАЛЬНАЯ КОНФИГУРАЦИЯ")}</span>
              </div>
              {bike.components.filter((c) => c.section === tab).length ? (
                <GroupedComponents
                  bike={bike}
                  section={tab}
                  catalog={catalog}
                  editable={editable}
                  rub={rub}
                  onEdit={(c) =>
                    setModal({ type: "part", part: c, section: c.section })
                  }
                  onDelete={(c) => setModal({ type: "deletePart", part: c })}
                  onOrder={(order) =>
                    run(async () => {
                      await api("bikes/" + bike.id + "/order", "PUT", order);
                      await refresh();
                    })
                  }
                />
              ) : (
                <div className="empty-parts">
                  <Package size={28} strokeWidth={1} />
                  <h3>
                    {tab === "build"
                      ? t("Всё начинается с первой детали")
                      : t("Место для полезных дополнений")}
                  </h3>
                  <p>
                    {tab === "build"
                      ? t(
                          "Добавьте компоненты, из которых собран ваш велосипед.",
                        )
                      : t(
                          "Свет, сумки, велокомпьютер — всё, что берёте с собой.",
                        )}
                  </p>
                  {editable && (
                    <button
                      className="button secondary"
                      onClick={() => setModal({ type: "part", section: tab })}
                    >
                      <Plus size={16} />
                      {t("Добавить")}
                    </button>
                  )}
                </div>
              )}
            </div>
            {(tab === "build"
              ? bike.show_component_prices
              : bike.show_accessory_prices) &&
              bike.components.some(
                (c) => c.section === tab && c.price != null,
              ) && (
                <div className="cost">
                  <Lock size={14} />
                  <span>{t("Стоимость выбранного раздела")}</span>
                  <strong>
                    {rub(
                      bike.components
                        .filter((c) => c.section === tab)
                        .reduce((s, c) => s + Number(c.price || 0), 0),
                    )}
                  </strong>
                </div>
              )}
          </section>
          {editable && (
            <div className="detail-footer">
              <span>
                {bike.is_public
                  ? t("Публичная ссылка включена")
                  : t("Этот велосипед виден только вам")}
              </span>
              <button
                className="quiet danger"
                onClick={() => setModal({ type: "deleteBike" })}
              >
                <Trash2 size={14} />
                {t("Удалить велосипед")}
              </button>
            </div>
          )}
        </main>
      ) : (
        <main className="garage">
          {settings.garageImageId && (
            <img
              className="garage-banner"
              src={"/api/assets/" + settings.garageImageId}
              alt=""
            />
          )}
          <div className="garage-heading">
            <div>
              <div className="eyebrow">{t("ВАША ЛИЧНАЯ КОЛЛЕКЦИЯ")}</div>
              <h1>
                {t("Мой гараж")}
                <span className="count">
                  {String(bikes.length).padStart(2, "0")}
                </span>
              </h1>
              <p>{t("Любимые велосипеды. Все детали на своих местах.")}</p>
            </div>
            <button
              className="button"
              onClick={() =>
                user ? setModal({ type: "bike" }) : auth("register")
              }
            >
              <Plus size={18} />
              <span className="add-bike-label">{t("Добавить велосипед")}</span>
            </button>
          </div>
          <div className="garage-tools">
            <div className="filters">
              {[
                ["all", t("Все велосипеды")],
                ...Object.entries(categories),
              ].map(([key, label]) => (
                <button
                  key={key}
                  className={filter === key ? "active" : ""}
                  onClick={() => setFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              className="icon search-toggle"
              aria-label="Поиск по гаражу"
              aria-expanded={searchOpen}
              onClick={() => {
                if (searchOpen) setQuery("");
                setSearchOpen((v) => !v);
              }}
            >
              <Search size={18} />
            </button>
            {searchOpen && (
              <label className="search">
                <Search size={17} />
                <input
                  aria-label={t("Найти велосипед")}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  autoFocus
                  placeholder={t("Найти в гараже")}
                />
              </label>
            )}
          </div>
          <div className="bike-grid">
            {filtered.map((b) => (
              <button
                className="bike-card"
                key={b.id}
                onClick={() => openBike(b)}
              >
                <div className="card-photo">
                  <Photo bike={b} />
                  <span className="card-type">{categories[b.category]}</span>
                </div>
                <div className="card-info">
                  <span className="eyebrow">
                    {b.year} · {b.is_public ? t("По ссылке") : t("Личный")}
                  </span>
                  <h2>
                    {b.brand} {b.model}
                    <ArrowUpRight size={22} />
                  </h2>
                  <p>{b.name}</p>
                  <div className="card-bottom">
                    <span>
                      {b.components.length}
                      {t("деталей")}
                    </span>
                    <span>
                      {b.weight
                        ? Number(b.weight) + t(" кг")
                        : t("Вес не указан")}
                    </span>
                  </div>
                </div>
              </button>
            ))}
            {!query && filter === "all" && (
              <button
                className="add-card"
                onClick={() =>
                  user ? setModal({ type: "bike" }) : auth("register")
                }
              >
                <span className="plus-circle">
                  <Plus size={28} />
                </span>
                <h2>
                  {bikes.length
                    ? t("Ещё один любимый")
                    : t("Ваш первый велосипед")}
                </h2>
                <p>
                  {t("Добавьте байк и соберите")}
                  <br />
                  {t("его историю в деталях.")}
                </p>
              </button>
            )}
          </div>
          {!filtered.length && (query || filter !== "all") && (
            <div className="empty-parts">
              <Search />
              <h3>{t("Ничего не найдено")}</h3>
              <button
                className="quiet"
                onClick={() => {
                  setQuery("");
                  setFilter("all");
                }}
              >
                {t("Сбросить фильтры")}
              </button>
            </div>
          )}
        </main>
      )}
      <footer className="footer">
        <span className="footer-logo">
          {settings.siteName}
          <span>© {new Date().getFullYear()}</span>
        </span>
        <span>{t("Ваш велосипед. В деталях.")}</span>
        <Versions />
      </footer>
      <input
        ref={file}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => {
          const image = e.target.files?.[0];
          e.target.value = "";
          if (!image) return;
          run(async () => {
            if (image.size > 10 * 1024 * 1024)
              throw new Error(t("Фото должно быть меньше 10 МБ"));
            const r = await fetch(`/api/bikes/${bike.id}/photos`, {
              method: "POST",
              headers: { "Content-Type": image.type },
              body: image,
            });
            if (!r.ok) throw new Error((await r.json()).error);
            await refresh();
            setNotice(t("Фотография добавлена"));
          });
        }}
      />
      {busy && !modal && (
        <div className="saving" role="status">
          <LoaderCircle className="spin" size={16} />
          {t("Сохраняем…")}
        </div>
      )}
      {modal && (
        <Modal
          title={
            {
              auth:
                modal.mode === "register"
                  ? t("Ваш гараж начинается здесь")
                  : t("С возвращением"),
              bike: modal.bike ? t("О велосипеде") : t("Новый велосипед"),
              part: modal.part
                ? t("Изменить деталь")
                : modal.section === "build"
                  ? t("Добавить компонент")
                  : t("Добавить аксессуар"),
              share: t("Поделиться велосипедом"),
              photoSearch: "Выбор фотографий",
              photoView: t("Фотография велосипеда"),
              deleteBike: t("Удалить велосипед?"),
              deletePart: t("Удалить деталь?"),
              deletePhoto: t("Удалить фотографию?"),
            }[modal.type]
          }
          onClose={close}
        >
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {modal.type === "photoView" && (
            <Photo bike={bike} photo={photo} className="full-photo" />
          )}
          {modal.type === "auth" && (
            <AuthForm
              mode={modal.mode}
              busy={busy}
              switchMode={() => {
                setError("");
                setModal({
                  ...modal,
                  mode: modal.mode === "login" ? "register" : "login",
                });
              }}
              onSubmit={(data) =>
                run(async () => {
                  await api("auth/" + modal.mode, "POST", data);
                  setSelected(null);
                  await refresh();
                  setModal(null);
                  setNotice(
                    modal.mode === "register"
                      ? t("Гараж готов. Добавьте свой первый байк.")
                      : t("Добро пожаловать"),
                  );
                })
              }
            />
          )}
          {modal.type === "photoSearch" && (
            <PhotoSearch
              bike={bike}
              onDone={async () => {
                await refresh();
                setModal(null);
                setNotice("Фотографии добавлены");
              }}
            />
          )}
          {modal.type === "bike" && (
            <BikeForm
              initial={modal.bike}
              busy={busy}
              onSubmit={(data) =>
                run(async () => {
                  const result = await api(
                    "bikes" + (modal.bike ? "/" + modal.bike.id : ""),
                    modal.bike ? "PATCH" : "POST",
                    data,
                  );
                  let factoryWarning = false;
                  if (data.importFactory) {
                    try {
                      const imported = await api(
                        "bikes/" +
                          (modal.bike?.id || result.id) +
                          "/factory-spec",
                        "POST",
                        {
                          sourceUrl: data.factorySourceUrl,
                          candidateId: data.factoryCandidateId,
                          initializeCurrent: data.initializeCurrent === true,
                        },
                      );
                      factoryWarning = imported.status !== "resolved";
                    } catch {
                      factoryWarning = true;
                    }
                  }
                  await refresh();
                  if (!modal.bike) {
                    const { bike: b } = await api("bikes/" + result.id);
                    openBike(b);
                  }
                  setModal(modal.bike ? null : { type: "photoSearch" });
                  setNotice(
                    factoryWarning
                      ? t(
                          "Велосипед сохранён. Заводскую комплектацию импортировать не удалось; повторите поиск позже.",
                        )
                      : t("Велосипед сохранён"),
                  );
                })
              }
            />
          )}
          {modal.type === "part" && (
            <PartForm
              initial={modal.part}
              section={modal.section}
              busy={busy}
              onSubmit={(data) =>
                run(async () => {
                  await api(
                    `bikes/${bike.id}/components` +
                      (modal.part ? "/" + modal.part.id : ""),
                    modal.part ? "PATCH" : "POST",
                    data,
                  );
                  await refresh();
                  setModal(null);
                  setNotice(t("Деталь сохранена"));
                })
              }
            />
          )}
          {modal.type === "share" && (
            <div className="share-form">
              <div className="share-status">
                {bike.is_public ? <Globe size={26} /> : <Lock size={26} />}
                <div>
                  <h3>
                    {bike.is_public
                      ? t("Доступен по ссылке")
                      : t("Личный велосипед")}
                  </h3>
                  <p>
                    {t(
                      "Видны фотографии, комплектация и аксессуары. Цены и почта скрыты.",
                    )}
                  </p>
                </div>
              </div>
              <button
                className={"button " + (bike.is_public ? "secondary" : "")}
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api(`bikes/${bike.id}/share`, "PATCH", {
                      is_public: !bike.is_public,
                    });
                    await refresh();
                  })
                }
              >
                {bike.is_public
                  ? t("Закрыть доступ")
                  : t("Включить публичную ссылку")}
              </button>
              {bike.is_public && (
                <div className="share-copy">
                  <input
                    readOnly
                    aria-label={t("Публичная ссылка")}
                    value={
                      typeof window !== "undefined"
                        ? window.location.origin + "/b/" + bike.share_id
                        : ""
                    }
                  />
                  <button
                    className="icon bordered"
                    aria-label={t("Скопировать ссылку")}
                    onClick={() =>
                      run(async () => {
                        await navigator.clipboard.writeText(
                          window.location.origin + "/b/" + bike.share_id,
                        );
                        setNotice(t("Ссылка скопирована"));
                      })
                    }
                  >
                    <Copy size={18} />
                  </button>
                </div>
              )}
              <p className="help">
                {t("После закрытия доступа старая ссылка перестанет работать.")}
              </p>
            </div>
          )}
          {modal.type.startsWith("delete") && (
            <div>
              <p className="delete-text">
                {modal.type === "deleteBike"
                  ? t(
                      "Велосипед, все его фотографии и детали будут удалены без возможности восстановления.",
                    )
                  : modal.type === "deletePart"
                    ? `«${modal.part.name}» будет удалён из актуальной конфигурации.`
                    : t("Фотография будет удалена из галереи.")}
              </p>
              <div className="form-actions">
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={close}
                >
                  {t("Отмена")}
                </button>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      let url = "bikes/" + bike.id;
                      if (modal.type === "deletePart")
                        url += "/components/" + modal.part.id;
                      if (modal.type === "deletePhoto")
                        url += "/photos/" + modal.photo.id;
                      await api(url, "DELETE");
                      if (modal.type === "deleteBike") setSelected(null);
                      setPhoto(null);
                      await refresh();
                      setModal(null);
                      setNotice(t("Удалено"));
                    })
                  }
                >
                  {busy ? t("Удаляем…") : t("Удалить")}
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
function AuthForm({ mode, busy, onSubmit, switchMode }) {
  const { settings, catalog, t } = useSite();
  const { categories, models, parts, partCategories, manufacturers } = catalog;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const d = new FormData(e.currentTarget);
        onSubmit(Object.fromEntries(d));
      }}
    >
      <p className="form-intro">
        {mode === "register"
          ? t("Сохраните комплектацию и фотографии своих велосипедов.")
          : t("Войдите, чтобы открыть свои велосипеды.")}
      </p>
      {mode === "register" && (
        <Field label={t("Ваше имя")}>
          <input
            name="name"
            required
            maxLength={60}
            autoComplete="name"
            autoFocus
          />
        </Field>
      )}
      <Field label={t("Электронная почта")}>
        <input
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          autoFocus={mode === "login"}
        />
      </Field>
      <Field label={t("Пароль")}>
        <input
          name="password"
          type="password"
          minLength={10}
          maxLength={128}
          required
          autoComplete={
            mode === "register" ? "new-password" : "current-password"
          }
        />
      </Field>
      <p className="help">{t("Минимум 10 символов.")}</p>
      <button className="button full" disabled={busy}>
        {busy
          ? t("Подождите…")
          : mode === "register"
            ? t("Создать аккаунт")
            : t("Войти в гараж")}
        <ArrowUpRight size={17} />
      </button>
      <button type="button" className="quiet switch-auth" onClick={switchMode}>
        {mode === "register"
          ? t("Уже есть аккаунт? Войти")
          : t("Нет аккаунта? Зарегистрироваться")}
      </button>
    </form>
  );
}
function BikeForm({ initial, busy, onSubmit }) {
  const { settings, catalog, t } = useSite();
  const { categories, models, parts, partCategories, manufacturers } = catalog;
  const [b, set] = useState(
    initial
      ? { ...initial, price: initial.price ?? "", weight: initial.weight || "" }
      : {
          ...blankBike,
          price: "",
          manufacturer_url: "",
          show_bike_price: false,
          show_component_prices: false,
          show_accessory_prices: false,
        },
  );
  const [resolving, setResolving] = useState(false);
  const update = (k, v) =>
    set((p) => ({
      ...p,
      [k]: v,
      ...(["brand", "model", "trim", "year"].includes(k)
        ? {
            importFactory: false,
            factoryCandidateId: undefined,
            factory_spec: null,
          }
        : {}),
    }));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          ...b,
          year: Number(b.year),
          price: b.price === "" ? null : Number(b.price),
          weight: b.weight === "" ? null : Number(b.weight),
        });
      }}
    >
      <Field label={t("Название вашего велосипеда")}>
        <input
          autoFocus
          required
          maxLength={100}
          value={b.name}
          onChange={(e) => update("name", e.target.value)}
          onBlur={() => {
            if (!initial && !b.brand && !b.model) {
              const parsed = parseBikeName(b.name, [
                ...new Set(Object.values(models).flatMap(Object.keys)),
              ]);
              if (parsed)
                set((p) => ({
                  ...p,
                  ...parsed,
                  importFactory: false,
                  factory_spec: null,
                }));
            }
          }}
          placeholder="Canyon Grail CF SLX 8 AXS 2026"
        />
      </Field>
      <div className="form-grid">
        <Field label={t("Тип")}>
          <select
            value={b.category}
            onChange={(e) => update("category", e.target.value)}
          >
            {Object.entries(categories).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Год")}>
          <input
            type="number"
            min="1900"
            max="2100"
            required
            value={b.year}
            onChange={(e) => update("year", e.target.value)}
          />
        </Field>
        <Field label={t("Марка")}>
          <input
            list="brands"
            maxLength={60}
            value={b.brand}
            onChange={(e) => update("brand", e.target.value)}
            placeholder={t("Выберите или введите")}
          />
          <datalist id="brands">
            {Object.keys(models[b.category] || {}).map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </Field>
        <Field label={t("Модель")}>
          <input
            list="models"
            maxLength={100}
            value={b.model}
            onChange={(e) => update("model", e.target.value)}
            placeholder={t("Выберите или введите")}
          />
          <datalist id="models">
            {(models[b.category]?.[b.brand] || []).map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </Field>
        <Field label={t("Размер рамы")}>
          <input
            maxLength={30}
            value={b.size}
            onChange={(e) => update("size", e.target.value)}
            placeholder={t("M / 54 см")}
          />
        </Field>
        <Field label={t("Вес, кг")}>
          <input
            type="number"
            min="0.01"
            max="100"
            step="0.01"
            value={b.weight}
            onChange={(e) => update("weight", e.target.value)}
            placeholder="10.8"
          />
        </Field>
      </div>
      <Field label={t("Комплектация модели")}>
        <input
          maxLength={100}
          value={b.trim || ""}
          onChange={(e) => update("trim", e.target.value)}
          placeholder="SL / CF SLX 8 AXS"
        />
      </Field>
      <FactorySpecification
        key={JSON.stringify([b.brand, b.model, b.trim, b.year])}
        bike={b}
        automatic={!initial}
        onBusy={setResolving}
        onReset={() =>
          set((p) => ({ ...p, importFactory: false, initializeCurrent: false }))
        }
        onImport={(candidateId, initializeCurrent, sourceUrl) =>
          set((p) => ({
            ...p,
            importFactory: true,
            factoryCandidateId: candidateId,
            factorySourceUrl: sourceUrl,
            initializeCurrent,
          }))
        }
        imported={b.importFactory}
      />
      <Field label={t("Сайт производителя")}>
        <input
          type="url"
          value={b.manufacturer_url || ""}
          onChange={(e) => update("manufacturer_url", e.target.value)}
          placeholder="https://…"
        />
      </Field>
      <Field label={t("Стоимость велосипеда")}>
        <input
          type="number"
          min="0"
          max="999999999"
          step="0.01"
          value={b.price ?? ""}
          onChange={(e) => update("price", e.target.value)}
        />
      </Field>
      <details className="price-settings">
        <summary>{t("Отображение стоимости")}</summary>
        <p className="help">
          Включённая стоимость видна в карточке и по публичной ссылке, если
          доступ открыт.
        </p>
        {[
          ["show_bike_price", "Велосипед"],
          ["show_component_prices", "Компоненты"],
          ["show_accessory_prices", "Аксессуары"],
        ].map(([key, label]) => (
          <label className="admin-toggle" key={key}>
            {label}
            <input
              type="checkbox"
              checked={!!b[key]}
              onChange={(e) => update(key, e.target.checked)}
            />
          </label>
        ))}
      </details>
      <Field label={t("Цвет")}>
        <input
          maxLength={60}
          value={b.color}
          onChange={(e) => update("color", e.target.value)}
          placeholder={t("Название или оттенок")}
        />
      </Field>
      <Field label={t("Пара слов о велосипеде")}>
        <textarea
          rows={3}
          maxLength={2000}
          value={b.description}
          onChange={(e) => update("description", e.target.value)}
          placeholder={t("Для каких дорог и приключений он создан?")}
        />
      </Field>
      <p className="help">
        {t(
          "Фотографии можно добавить после сохранения. Велосипед по умолчанию приватный.",
        )}
      </p>
      <button className="button full" disabled={busy || resolving}>
        {busy ? t("Сохраняем…") : t("Сохранить велосипед")}
        <Check size={18} />
      </button>
    </form>
  );
}
function PartForm({ initial, section, busy, onSubmit }) {
  const { settings, catalog, t } = useSite();
  const { categories, models, parts, partCategories, manufacturers } = catalog;
  const [c, set] = useState(
    initial
      ? { ...initial, price: initial.price ?? "" }
      : {
          section,
          category: partCategories[section][0],
          name: "",
          notes: "",
          price: "",
        },
  );
  const [search, setSearch] = useState("");
  const update = (k, v) => set((p) => ({ ...p, [k]: v }));
  const suggestions = (parts[c.category] || []).filter((p) =>
    p.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ ...c, price: c.price === "" ? null : Number(c.price) });
      }}
    >
      <div className="selected-part-icon">
        <PartIcon category={c.category} icons={catalog.icons} size={38} />
        <span>{c.category}</span>
      </div>
      <Field label={t("Категория")}>
        <select
          value={c.category}
          onChange={(e) => {
            update("category", e.target.value);
            setSearch("");
          }}
        >
          {Array.from(new Set([c.category, ...partCategories[section]]))
            .filter(Boolean)
            .map((p) => (
              <option key={p}>{p}</option>
            ))}
        </select>
      </Field>
      <Field label={t("Производитель")}>
        <input
          list="component-manufacturers"
          placeholder={t("Выберите производителя")}
          onChange={(e) => {
            update("name", e.target.value + " ");
            setSearch(e.target.value);
          }}
        />
        <datalist id="component-manufacturers">
          {manufacturers.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </Field>
      <Field label={t("Компонент или модель")}>
        <input
          required
          autoFocus
          maxLength={150}
          value={c.name}
          onChange={(e) => {
            update("name", e.target.value);
            setSearch(e.target.value);
          }}
          placeholder={t("Например, Brooks C17")}
        />
      </Field>
      {suggestions.length > 0 && (
        <div className="suggestions" aria-label={t("Модели из справочника")}>
          {suggestions.map((p) => (
            <button
              key={p}
              type="button"
              className={c.name === p ? "chosen" : ""}
              onClick={() => {
                update("name", p);
                setSearch("");
              }}
            >
              {p}
              {c.name === p && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
      <p className="help">
        {t("Выберите из справочника или введите своё название.")}
      </p>
      <Field label={t("Примечание")}>
        <input
          maxLength={500}
          value={c.notes}
          onChange={(e) => update("notes", e.target.value)}
          placeholder={t("Размер, материал, передаточное отношение…")}
        />
      </Field>
      <Field label="Группа">
        <select
          value={c.group_id || ""}
          onChange={(e) => update("group_id", e.target.value)}
        >
          <option value="">По категории</option>
          {catalog.componentGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Ссылка на компонент или аксессуар">
        <input
          type="url"
          value={c.url || ""}
          maxLength={2048}
          onChange={(e) => update("url", e.target.value)}
          placeholder="https://…"
        />
      </Field>
      <Field label={t("Стоимость покупки / апгрейда, ₽")}>
        <input
          type="number"
          min="0"
          max="999999999"
          step="0.01"
          value={c.price}
          onChange={(e) => update("price", e.target.value)}
          placeholder={t("Необязательно")}
        />
      </Field>
      <p className="help">
        <Lock size={13} />
        {t("Стоимость видна только вам.")}
      </p>
      <button className="button full" disabled={busy}>
        {busy ? t("Сохраняем…") : t("Сохранить деталь")}
        <Check size={18} />
      </button>
    </form>
  );
}
