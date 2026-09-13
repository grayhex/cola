"use client";
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
import {
  categories,
  models,
  parts,
  partCategories,
  manufacturers,
} from "../../lib/catalog.js";

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
        <button className="icon" aria-label="Закрыть" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Photo({ bike, className = "", photo }) {
  const [failed, setFailed] = useState(false);
  const selected = photo || bike.photos?.[0];
  const src =
    bike.id === "demo"
      ? demoImage
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
      <span>Фотография велосипеда</span>
    </div>
  );
}

export default function Garage({ share }) {
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
  const bike = share ? selected : user ? selected : demo;
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
        <a className="brand" href="/" aria-label="ColaBike — главная">
          <span className="brand-mark">c.</span>Cola<span>Bike</span>
        </a>
        <div className="header-right">
          {share ? (
            <a href="/" className="text-link">
              Мой гараж <ArrowUpRight size={16} />
            </a>
          ) : user ? (
            <>
              <span className="user-name">{user.name}</span>
              <span className="avatar">
                {user.name.slice(0, 1).toUpperCase()}
              </span>
              <button
                className="icon"
                aria-label="Выйти"
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
                Войти
              </button>
              <button className="button small" onClick={() => auth("register")}>
                Создать гараж <ArrowUpRight size={16} />
              </button>
            </>
          )}
        </div>
      </header>
      <div className="subnav">
        <span>
          <Bike size={18} />
          {share ? "Публичный велосипед" : "Личный гараж"}
        </span>
        <span className="subnav-note">КАЖДАЯ ДЕТАЛЬ ИМЕЕТ ЗНАЧЕНИЕ</span>
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
            Повторить
          </button>
        </div>
      )}
      {loading ? (
        <main className="loading">
          <LoaderCircle className="spin" />
          Открываем гараж…
        </main>
      ) : share && !bike ? (
        <main className="empty">
          <Lock size={36} />
          <h1>Велосипед недоступен</h1>
          <p>Владелец мог закрыть доступ или изменить ссылку.</p>
          <a href="/" className="button">
            Открыть ColaBike
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
                Мой гараж
              </button>
            ) : (
              <span>
                {share
                  ? "Коллекция владельца"
                  : "Пример вашего будущего гаража"}
              </span>
            )}
            <ChevronRight size={14} />
            <span>
              {bike.brand} {bike.model}
            </span>
          </div>
          <div className="bike-heading">
            <div>
              <div className="eyebrow">
                <span className="category-tag">
                  {categories[bike.category]}
                </span>
                <span>{bike.year}</span>
                {bike.id === "demo" && <span>ДЕМОНСТРАЦИЯ</span>}
              </div>
              <h1>
                {bike.brand || bike.name}
                <span>{bike.brand ? bike.model : ""}</span>
              </h1>
              <p className="nickname">{bike.brand ? bike.name : ""}</p>
            </div>
            <div className="detail-actions">
              {editable ? (
                <>
                  <button
                    className="button secondary"
                    onClick={() => setModal({ type: "share" })}
                  >
                    {bike.is_public ? <Globe size={17} /> : <Lock size={17} />}
                    Поделиться
                  </button>
                  <button
                    className="icon bordered"
                    aria-label="Редактировать велосипед"
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
                  Добавить свой байк <Plus size={17} />
                </button>
              ) : (
                <span className="muted">
                  <Globe size={16} />
                  Доступен по ссылке
                </span>
              )}
            </div>
          </div>
          <div className="showcase">
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
              <Photo bike={bike} photo={photo} className="hero-photo" />
              {editable && (
                <button
                  className="photo-add"
                  disabled={busy}
                  onClick={() => file.current.click()}
                >
                  <Camera size={16} />
                  {bike.photos.length ? "Добавить фото" : "Загрузить фото"}
                </button>
              )}
              {bike.id === "demo" && (
                <a
                  className="photo-credit"
                  href="https://www.canyon.com/en-si/outlet-bikes/gravel-bikes/grizl-al-7-raw/50051247.html"
                  target="_blank"
                  rel="noreferrer"
                >
                  Фото: Canyon · пример сборки
                </a>
              )}
            </div>
            <aside className="bike-summary">
              <span className="eyebrow">ПАСПОРТ ВЕЛОСИПЕДА</span>
              <h2>
                Собран
                <br />
                под себя.
              </h2>
              <p>
                {bike.description ||
                  "У каждого велосипеда своя история. Добавьте пару слов о вашем."}
              </p>
              <dl>
                <div>
                  <dt>Год</dt>
                  <dd>{bike.year}</dd>
                </div>
                <div>
                  <dt>Размер рамы</dt>
                  <dd>{bike.size || "—"}</dd>
                </div>
                <div>
                  <dt>Вес</dt>
                  <dd>{bike.weight ? `${Number(bike.weight)} кг` : "—"}</dd>
                </div>
                <div>
                  <dt>Цвет</dt>
                  <dd>{bike.color || "—"}</dd>
                </div>
              </dl>
              <div className="summary-bottom">
                <span>{String(bike.components.length).padStart(2, "0")}</span>
                деталей в конфигурации
              </div>
            </aside>
          </div>
          {bike.photos.length > 0 && (
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
                    aria-label="Показать фотографию"
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
                            setNotice("Обложка обновлена");
                          })
                        }
                      >
                        {p.is_cover ? "Обложка" : "На обложку"}
                      </button>
                      <button
                        className="icon"
                        aria-label="Удалить фото"
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
          )}
          <section className="specifications">
            <div className="tabs-row">
              <div
                className="tabs"
                role="tablist"
                aria-label="Разделы конфигурации"
              >
                {[
                  ["build", "Комплектация"],
                  ["accessories", "Аксессуары"],
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
                  Добавить {tab === "build" ? "компонент" : "аксессуар"}
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
                  {tab === "build" ? "ОСНОВА И ДЕТАЛИ" : "ВСЁ ДЛЯ ПОЕЗДКИ"}
                </span>
                <span>АКТУАЛЬНАЯ КОНФИГУРАЦИЯ</span>
              </div>
              {bike.components.filter((c) => c.section === tab).length ? (
                <div className="spec-table">
                  {bike.components
                    .filter((c) => c.section === tab)
                    .map((c) => (
                      <div className="spec-row" key={c.id}>
                        <span className="part-category">{c.category}</span>
                        <div>
                          <strong>{c.name}</strong>
                          {c.notes && (
                            <span className="part-notes">{c.notes}</span>
                          )}
                        </div>
                        <div className="part-end">
                          {editable && c.price != null && (
                            <span className="price">{rub(c.price)}</span>
                          )}
                          {editable && (
                            <>
                              <button
                                className="icon"
                                aria-label={"Изменить " + c.name}
                                onClick={() =>
                                  setModal({
                                    type: "part",
                                    part: c,
                                    section: c.section,
                                  })
                                }
                              >
                                <Pencil size={15} />
                              </button>
                              <button
                                className="icon"
                                aria-label={"Удалить " + c.name}
                                onClick={() =>
                                  setModal({ type: "deletePart", part: c })
                                }
                              >
                                <Trash2 size={15} />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              ) : (
                <div className="empty-parts">
                  <Package size={28} strokeWidth={1} />
                  <h3>
                    {tab === "build"
                      ? "Всё начинается с первой детали"
                      : "Место для полезных дополнений"}
                  </h3>
                  <p>
                    {tab === "build"
                      ? "Добавьте компоненты, из которых собран ваш велосипед."
                      : "Свет, сумки, велокомпьютер — всё, что берёте с собой."}
                  </p>
                  {editable && (
                    <button
                      className="button secondary"
                      onClick={() => setModal({ type: "part", section: tab })}
                    >
                      <Plus size={16} />
                      Добавить
                    </button>
                  )}
                </div>
              )}
            </div>
            {editable && bike.components.some((c) => c.price != null) && (
              <div className="cost">
                <Lock size={14} />
                <span>Указанная стоимость деталей · видна только вам</span>
                <strong>
                  {rub(
                    bike.components.reduce(
                      (s, c) => s + Number(c.price || 0),
                      0,
                    ),
                  )}
                </strong>
              </div>
            )}
          </section>
          {editable && (
            <div className="detail-footer">
              <span>
                {bike.is_public
                  ? "Публичная ссылка включена"
                  : "Этот велосипед виден только вам"}
              </span>
              <button
                className="quiet danger"
                onClick={() => setModal({ type: "deleteBike" })}
              >
                <Trash2 size={14} />
                Удалить велосипед
              </button>
            </div>
          )}
        </main>
      ) : (
        <main className="garage">
          <div className="garage-heading">
            <div>
              <div className="eyebrow">ВАША ЛИЧНАЯ КОЛЛЕКЦИЯ</div>
              <h1>
                Мой гараж
                <span className="count">
                  {String(bikes.length).padStart(2, "0")}
                </span>
              </h1>
              <p>Любимые велосипеды. Все детали на своих местах.</p>
            </div>
            <button
              className="button"
              onClick={() => setModal({ type: "bike" })}
            >
              <Plus size={18} />
              Добавить велосипед
            </button>
          </div>
          <div className="garage-tools">
            <div className="filters">
              {[["all", "Все велосипеды"], ...Object.entries(categories)].map(
                ([key, label]) => (
                  <button
                    key={key}
                    className={filter === key ? "active" : ""}
                    onClick={() => setFilter(key)}
                  >
                    {label}
                  </button>
                ),
              )}
            </div>
            <label className="search">
              <Search size={17} />
              <input
                aria-label="Найти велосипед"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Найти в гараже"
              />
            </label>
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
                    {b.year} · {b.is_public ? "По ссылке" : "Личный"}
                  </span>
                  <h2>
                    {b.brand} {b.model}
                    <ArrowUpRight size={22} />
                  </h2>
                  <p>{b.name}</p>
                  <div className="card-bottom">
                    <span>{b.components.length} деталей</span>
                    <span>
                      {b.weight ? Number(b.weight) + " кг" : "Вес не указан"}
                    </span>
                  </div>
                </div>
              </button>
            ))}
            {!query && filter === "all" && (
              <button
                className="add-card"
                onClick={() => setModal({ type: "bike" })}
              >
                <span className="plus-circle">
                  <Plus size={28} />
                </span>
                <h2>
                  {bikes.length ? "Ещё один любимый" : "Ваш первый велосипед"}
                </h2>
                <p>
                  Добавьте байк и соберите
                  <br />
                  его историю в деталях.
                </p>
              </button>
            )}
          </div>
          {!filtered.length && (query || filter !== "all") && (
            <div className="empty-parts">
              <Search />
              <h3>Ничего не найдено</h3>
              <button
                className="quiet"
                onClick={() => {
                  setQuery("");
                  setFilter("all");
                }}
              >
                Сбросить фильтры
              </button>
            </div>
          )}
        </main>
      )}
      <footer className="footer">
        <span className="footer-logo">
          ColaBike<span>© {new Date().getFullYear()}</span>
        </span>
        <span>Ваш велосипед. В деталях.</span>
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
              throw new Error("Фото должно быть меньше 10 МБ");
            const r = await fetch(`/api/bikes/${bike.id}/photos`, {
              method: "POST",
              headers: { "Content-Type": image.type },
              body: image,
            });
            if (!r.ok) throw new Error((await r.json()).error);
            await refresh();
            setNotice("Фотография добавлена");
          });
        }}
      />
      {busy && !modal && (
        <div className="saving" role="status">
          <LoaderCircle className="spin" size={16} />
          Сохраняем…
        </div>
      )}
      {modal && (
        <Modal
          title={
            {
              auth:
                modal.mode === "register"
                  ? "Ваш гараж начинается здесь"
                  : "С возвращением",
              bike: modal.bike ? "О велосипеде" : "Новый велосипед",
              part: modal.part
                ? "Изменить деталь"
                : modal.section === "build"
                  ? "Добавить компонент"
                  : "Добавить аксессуар",
              share: "Поделиться велосипедом",
              deleteBike: "Удалить велосипед?",
              deletePart: "Удалить деталь?",
              deletePhoto: "Удалить фотографию?",
            }[modal.type]
          }
          onClose={close}
        >
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
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
                      ? "Гараж готов. Добавьте свой первый байк."
                      : "Добро пожаловать",
                  );
                })
              }
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
                  await refresh();
                  if (!modal.bike) {
                    const { bike: b } = await api("bikes/" + result.id);
                    openBike(b);
                  }
                  setModal(null);
                  setNotice("Велосипед сохранён");
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
                  setNotice("Деталь сохранена");
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
                    {bike.is_public ? "Доступен по ссылке" : "Личный велосипед"}
                  </h3>
                  <p>
                    Видны фотографии, комплектация и аксессуары. Цены и почта
                    скрыты.
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
                  ? "Закрыть доступ"
                  : "Включить публичную ссылку"}
              </button>
              {bike.is_public && (
                <div className="share-copy">
                  <input
                    readOnly
                    aria-label="Публичная ссылка"
                    value={
                      typeof window !== "undefined"
                        ? window.location.origin + "/b/" + bike.share_id
                        : ""
                    }
                  />
                  <button
                    className="icon bordered"
                    aria-label="Скопировать ссылку"
                    onClick={() =>
                      run(async () => {
                        await navigator.clipboard.writeText(
                          window.location.origin + "/b/" + bike.share_id,
                        );
                        setNotice("Ссылка скопирована");
                      })
                    }
                  >
                    <Copy size={18} />
                  </button>
                </div>
              )}
              <p className="help">
                После закрытия доступа старая ссылка перестанет работать.
              </p>
            </div>
          )}
          {modal.type.startsWith("delete") && (
            <div>
              <p className="delete-text">
                {modal.type === "deleteBike"
                  ? "Велосипед, все его фотографии и детали будут удалены без возможности восстановления."
                  : modal.type === "deletePart"
                    ? `«${modal.part.name}» будет удалён из актуальной конфигурации.`
                    : "Фотография будет удалена из галереи."}
              </p>
              <div className="form-actions">
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={close}
                >
                  Отмена
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
                      setNotice("Удалено");
                    })
                  }
                >
                  {busy ? "Удаляем…" : "Удалить"}
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
          ? "Сохраните комплектацию и фотографии своих велосипедов."
          : "Войдите, чтобы открыть свои велосипеды."}
      </p>
      {mode === "register" && (
        <Field label="Ваше имя">
          <input
            name="name"
            required
            maxLength={60}
            autoComplete="name"
            autoFocus
          />
        </Field>
      )}
      <Field label="Электронная почта">
        <input
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          autoFocus={mode === "login"}
        />
      </Field>
      <Field label="Пароль">
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
      <p className="help">Минимум 10 символов.</p>
      <button className="button full" disabled={busy}>
        {busy
          ? "Подождите…"
          : mode === "register"
            ? "Создать аккаунт"
            : "Войти в гараж"}
        <ArrowUpRight size={17} />
      </button>
      <button type="button" className="quiet switch-auth" onClick={switchMode}>
        {mode === "register"
          ? "Уже есть аккаунт? Войти"
          : "Нет аккаунта? Зарегистрироваться"}
      </button>
    </form>
  );
}
function BikeForm({ initial, busy, onSubmit }) {
  const [b, set] = useState(
    initial ? { ...initial, weight: initial.weight || "" } : blankBike,
  );
  const update = (k, v) => set((p) => ({ ...p, [k]: v }));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          ...b,
          year: Number(b.year),
          weight: b.weight === "" ? null : Number(b.weight),
        });
      }}
    >
      <Field label="Название вашего велосипеда">
        <input
          autoFocus
          required
          maxLength={100}
          value={b.name}
          onChange={(e) => update("name", e.target.value)}
          placeholder="Например, Дальше асфальта"
        />
      </Field>
      <div className="form-grid">
        <Field label="Тип">
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
        <Field label="Год">
          <input
            type="number"
            min="1900"
            max="2100"
            required
            value={b.year}
            onChange={(e) => update("year", e.target.value)}
          />
        </Field>
        <Field label="Марка">
          <input
            list="brands"
            maxLength={60}
            value={b.brand}
            onChange={(e) => update("brand", e.target.value)}
            placeholder="Выберите или введите"
          />
          <datalist id="brands">
            {Object.keys(models[b.category]).map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </Field>
        <Field label="Модель">
          <input
            list="models"
            maxLength={100}
            value={b.model}
            onChange={(e) => update("model", e.target.value)}
            placeholder="Выберите или введите"
          />
          <datalist id="models">
            {(models[b.category][b.brand] || []).map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </Field>
        <Field label="Размер рамы">
          <input
            maxLength={30}
            value={b.size}
            onChange={(e) => update("size", e.target.value)}
            placeholder="M / 54 см"
          />
        </Field>
        <Field label="Вес, кг">
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
      <Field label="Цвет">
        <input
          maxLength={60}
          value={b.color}
          onChange={(e) => update("color", e.target.value)}
          placeholder="Название или оттенок"
        />
      </Field>
      <Field label="Пара слов о велосипеде">
        <textarea
          rows={3}
          maxLength={2000}
          value={b.description}
          onChange={(e) => update("description", e.target.value)}
          placeholder="Для каких дорог и приключений он создан?"
        />
      </Field>
      <p className="help">
        Фотографии можно добавить после сохранения. Велосипед по умолчанию
        приватный.
      </p>
      <button className="button full" disabled={busy}>
        {busy ? "Сохраняем…" : "Сохранить велосипед"}
        <Check size={18} />
      </button>
    </form>
  );
}
function PartForm({ initial, section, busy, onSubmit }) {
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
      <Field label="Категория">
        <select
          value={c.category}
          onChange={(e) => {
            update("category", e.target.value);
            setSearch("");
          }}
        >
          {partCategories[section].map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </Field>
      <Field label="Компонент или модель">
        <input
          required
          autoFocus
          maxLength={150}
          value={c.name}
          onChange={(e) => {
            update("name", e.target.value);
            setSearch(e.target.value);
          }}
          placeholder="Например, Brooks C17"
        />
      </Field>
      {suggestions.length > 0 && (
        <div className="suggestions" aria-label="Модели из справочника">
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
      <p className="help">Выберите из справочника или введите своё название.</p>
      <Field label="Примечание">
        <input
          maxLength={500}
          value={c.notes}
          onChange={(e) => update("notes", e.target.value)}
          placeholder="Размер, материал, передаточное отношение…"
        />
      </Field>
      <Field label="Стоимость покупки / апгрейда, ₽">
        <input
          type="number"
          min="0"
          max="999999999"
          step="0.01"
          value={c.price}
          onChange={(e) => update("price", e.target.value)}
          placeholder="Необязательно"
        />
      </Field>
      <p className="help">
        <Lock size={13} />
        Стоимость видна только вам.
      </p>
      <button className="button full" disabled={busy}>
        {busy ? "Сохраняем…" : "Сохранить деталь"}
        <Check size={18} />
      </button>
    </form>
  );
}
