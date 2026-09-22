"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ShoppingBag,
  Plus,
  MapPin,
  ArrowLeft,
  Search,
  Image as ImageIcon,
} from "lucide-react";
import {
  SocialHeader,
  SocialFooter,
  socialApi,
  Pagination,
} from "./social-primitives.jsx";
import { useSite } from "./site-provider.jsx";
import { ContentLabel } from "./content-label.jsx";
import { listingTypes, listingPriceLabel } from "../../lib/market-types.js";
import { marketCategories, readMarketQuery, writeMarketQuery } from "../../lib/market-query.js";
import styles from "./market.module.css";
export { marketCategories } from "../../lib/market-query.js";

function ListingTypeLabel({ type = "sale" }) {
  return (
    <ContentLabel tone={{ sale: "green", wanted: "blue", exchange: "purple", free: "teal" }[type] || "neutral"}
      data-listing-type={type}>
      {listingTypes[type] || listingTypes.sale}
    </ContentLabel>
  );
}
export function MarketCard({ listing: m }) {
  return (
    <article className={styles.card} data-listing-id={m.id}>
      <Link
        href={"/market/" + m.shareId}
        className={styles.cover}
        aria-label={m.title}
      >
        {m.photos[0] ? (
          <img
            src={"/api/market/media/" + m.photos[0].id + "?width=320"}
            alt=""
            loading="lazy"
          />
        ) : (
          <ShoppingBag size={32} />
        )}
      </Link>
      <div className={styles.cardBody}>
        <div className={styles.labels}>
          <ListingTypeLabel type={m.listingType} />
          <small>
            {marketCategories[m.category]} ·{" "}
            {m.condition === "new" ? "Новое" : "С пробегом"}
            {m.status !== "active"
              ? " · " + (m.status === "sold" ? "Закрыто" : "Черновик")
              : ""}
          </small>
        </div>
        <h3>
          <Link href={"/market/" + m.shareId}>{m.title}</Link>
        </h3>
        <strong className={styles.price}>{listingPriceLabel(m)}</strong>
        <p>
          {m.location || "Город не указан"} ·{" "}
          <Link href={"/u/" + m.author.username}>@{m.author.username}</Link>
        </p>
      </div>
    </article>
  );
}
const blank = {
  title: "",
  description: "",
  category: "bikes",
  listingType: "sale",
  condition: "used",
  price: "",
  currency: "RUB",
  location: "",
  contact: "",
  status: "draft",
};
function ListingEditor({ initial, onSaved, onCancel }) {
  const legacyCurrency = !!initial?.currency && initial.currency !== "RUB";
  const [form, setForm] = useState(() => ({
      ...Object.fromEntries(Object.keys(blank).map((k) => [k, initial?.[k] ?? blank[k]])),
      currency: "RUB",
      price: legacyCurrency ? "" : initial?.price ?? "",
    })),
    [identity, setIdentity] = useState(initial),
    [photos, setPhotos] = useState(initial?.photos || []),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  async function save(status) {
    const body = {
      ...form,
      price: form.listingType === "free" ? 0 : form.price === "" ? null : Number(form.price),
      currency: "RUB",
      status,
    };
    const saved = await socialApi(
      "market" + (identity ? "/" + identity.id : ""),
      identity ? "PATCH" : "POST",
      body,
    );
    setIdentity(saved);
    return saved;
  }
  return (
    <form
      className={styles.editor}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await onSaved(await save(form.status === "sold" ? "sold" : "active"));
        } catch (e) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h1>{initial ? "Изменить объявление" : "Новое объявление"}</h1>
      <label className="field">
        <span>Тип объявления</span>
        <select value={form.listingType} disabled={busy}
          onChange={(e) => set("listingType", e.target.value)}>
          {Object.entries(listingTypes).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Название</span>
        <input
          required
          maxLength={120}
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="Например, гравийный велосипед M"
        />
      </label>
      <div className={styles.formGrid}>
        <label className="field">
          <span>Категория</span>
          <select
            value={form.category}
            onChange={(e) => set("category", e.target.value)}
          >
            {Object.entries(marketCategories).map(([k, v]) => (
              <option value={k} key={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Состояние</span>
          <select
            value={form.condition}
            onChange={(e) => set("condition", e.target.value)}
          >
            <option value="used">С пробегом</option>
            <option value="new">Новое</option>
          </select>
        </label>
      </div>
      <label className="field">
        <span>Описание</span>
        <textarea
          required
          maxLength={6000}
          rows={6}
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="Размер, комплектация, состояние и особенности"
        />
      </label>
      {legacyCurrency && (
        <p className="help">Старая цена была указана не в рублях. Она не конвертирована автоматически: укажите новую сумму в рублях или сохраните объявление без цены.</p>
      )}
      <label className="field">
        <span>{form.listingType === "wanted" ? "Бюджет, ₽" : form.listingType === "exchange" ? "Доплата, ₽" : "Цена, ₽"}</span>
        <input
          type="number"
          min="0"
          max="9999999999"
          step="0.01"
          disabled={busy || form.listingType === "free"}
          value={form.listingType === "free" ? 0 : form.price}
          onChange={(e) => set("price", e.target.value)}
        />
      </label>
      <p className="help">
        {form.listingType === "free"
          ? "Бесплатно. Цена для «Отдам даром» всегда равна нулю."
          : "Все суммы в рублях. Поле можно оставить пустым, если сумма обсуждается."}
      </p>
      <label className="field">
        <span>Город</span>
        <input
          maxLength={100}
          value={form.location}
          onChange={(e) => set("location", e.target.value)}
        />
      </label>
      <label className="field">
        <span>Как с вами связаться</span>
        <input
          maxLength={300}
          value={form.contact}
          onChange={(e) => set("contact", e.target.value)}
          placeholder="Например, Telegram @username"
        />
        <small>Этот контакт будет виден в опубликованном объявлении.</small>
      </label>
      <fieldset className={styles.photoField}>
        <legend>Фотографии · {photos.length} / 8</legend>
        <div className={styles.photoGrid}>
          {photos.map((p) => (
            <div key={p.id}>
              <img
                src={"/api/market/media/" + p.id + "?width=160"}
                alt="Фото объявления"
              />
              <button
                type="button"
                className="quiet"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await socialApi("market/media/" + p.id, "DELETE");
                    setPhotos((rows) => rows.filter((v) => v.id !== p.id));
                  } catch (e) {
                    setError(e.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Удалить
              </button>
            </div>
          ))}
        </div>
        <label className="field">
          <span>Добавить фото</span>
          <input
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            disabled={busy || photos.length >= 8}
            onChange={async (e) => {
              const files = Array.from(e.target.files || []);
              e.target.value = "";
              if (!files.length) return;
              if (!form.title.trim()) {
                setError("Сначала укажите название объявления.");
                return;
              }
              if (photos.length + files.length > 8) {
                setError("Максимум 8 фотографий.");
                return;
              }
              if (files.some((f) => f.size > 10 * 1024 * 1024)) {
                setError("Каждое фото должно быть не больше 10 МБ.");
                return;
              }
              setBusy(true);
              setError("");
              try {
                const saved = identity || (await save("draft"));
                for (const file of files) {
                  const r = await fetch("/api/market/" + saved.id + "/photos", {
                      method: "POST",
                      headers: { "Content-Type": file.type },
                      body: file,
                    }),
                    p = await r.json();
                  if (!r.ok) throw Error(p.error);
                  setPhotos((rows) => [...rows, p]);
                }
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          />
          <small>
            JPEG, PNG или WebP · до 10 МБ каждое. Первое фото станет обложкой.
          </small>
        </label>
      </fieldset>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {busy && <p role="status">Сохраняем…</p>}
      <div className="form-actions">
        <button className="button" disabled={busy}>
          {form.status === "sold" ? "Сохранить" : "Опубликовать"}
        </button>
        <button
          type="button"
          className="quiet"
          disabled={busy || !form.title.trim()}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await onSaved(await save("draft"));
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Сохранить черновик
        </button>
        <button
          type="button"
          className="quiet"
          disabled={busy}
          onClick={() => onCancel(identity)}
        >
          Отмена
        </button>
      </div>
    </form>
  );
}
export default function Market({ share = null, create = false }) {
  const { setPreferences } = useSite();
  const [user, setUser] = useState(undefined),
    [data, setData] = useState(null),
    [listing, setListing] = useState(null),
    [edit, setEdit] = useState(create),
    [filters, setFilters] = useState(() => readMarketQuery(new URLSearchParams())),
    [search, setSearch] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false);
  const { own, category, listingType, condition, query } = filters;
  const filterKey = writeMarketQuery(filters);
  function changeFilters(patch) {
    const next = { ...filters, page: 1, ...patch };
    setFilters(next);
    setData(null);
    const queryString = writeMarketQuery(next);
    window.history.pushState(null, "", "/market" + (queryString ? "?" + queryString : ""));
  }
  useEffect(() => {
    let active = true;
    const restore = () => {
      const p = new URLSearchParams(location.search);
      const state = readMarketQuery(p);
      setFilters(state);
      setSearch(state.query);
      setData(null);
      setEdit(create || p.get("edit") === "1");
    };
    restore();
    setListing(null);
    setReady(true);
    window.addEventListener("popstate", restore);
    socialApi("me")
      .then((d) => {
        if (!active) return;
        setUser(d.user);
        setPreferences(d.user?.preferences || {});
      })
      .catch((e) => { if (active) setError(e.message); });
    return () => {
      active = false;
      window.removeEventListener("popstate", restore);
    };
  }, [share, create]);
  useEffect(() => {
    if (!ready || create || user === undefined || (own && !user)) return;
    let active = true;
    setError("");
    setData(null);
    const path = share
      ? "market/public/" + share
      : "market?" + filterKey;
    socialApi(path)
      .then((d) => {
        if (active) {
          if (share) setListing(d.listing);
          else setData(d);
        }
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          if (share) setListing(null);
        }
      });
    return () => {
      active = false;
    };
  }, [ready, share, create, user?.id, user === undefined, filterKey]);
  const saved = async (r) => {
    location.assign("/market/" + r.shareId);
  };
  async function changeStatus(status) {
    setBusy(true);
    setError("");
    try {
      if (listing.currency !== "RUB")
        throw Error("Сначала измените объявление и уточните цену в рублях. Старая сумма не конвертируется автоматически.");
      const body = {
        ...Object.fromEntries(Object.keys(blank).map((k) => [k, listing[k]])),
        listingType: listing.listingType || "sale",
        price: listing.price ?? null,
        currency: "RUB",
        status,
      };
      await socialApi("market/" + listing.id, "PATCH", body);
      setListing((v) => ({ ...v, status }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <SocialHeader user={user} />
      <main className="social-page">
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {user === undefined ? (
          <p role="status">Загружаем…</p>
        ) : (create || own) && !user ? (
          <section className={styles.empty}>
            <ShoppingBag />
            <h1>Рынок ColaBike</h1>
            <p>Войдите, чтобы публиковать объявления.</p>
            <Link
              className="button"
              href={
                "/login?next=" +
                encodeURIComponent(create ? "/market/new" : "/market?own=1")
              }
            >
              Войти
            </Link>
          </section>
        ) : create || (edit && listing?.isOwner) ? (
          <ListingEditor
            key={listing?.id || "new"}
            initial={listing}
            onSaved={saved}
            onCancel={(r) =>
              r
                ? location.assign("/market/" + r.shareId)
                : location.assign("/market")
            }
          />
        ) : share ? (
          listing ? (
            <article className={styles.detail}>
              <Link className={styles.back} href="/market">
                <ArrowLeft size={16} />
                Все объявления
              </Link>
              <div className="section-heading">
                <div>
                  <div className={styles.labels}>
                    <ListingTypeLabel type={listing.listingType} />
                    <small>
                      {marketCategories[listing.category]} ·{" "}
                      {listing.condition === "new" ? "Новое" : "С пробегом"}
                    </small>
                  </div>
                  <h1>{listing.title}</h1>
                </div>
                {listing.isOwner && (
                  <button className="quiet" onClick={() => setEdit(true)}>
                    Изменить
                  </button>
                )}
              </div>
              {listing.status !== "active" && (
                <p className={styles.state}>
                  {listing.status === "sold"
                    ? "Объявление закрыто" + (listing.listingType === "sale" ? " · продано" : "")
                    : "Черновик · виден только вам"}
                </p>
              )}
              <div className={styles.detailGrid}>
                <div>
                  <div className={styles.gallery}>
                    {listing.photos.length ? (
                      listing.photos.map((p, i) => (
                        <a
                          key={p.id}
                          href={"/api/market/media/" + p.id}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <img
                            src={"/api/market/media/" + p.id}
                            alt={listing.title + " · фото " + (i + 1)}
                          />
                        </a>
                      ))
                    ) : (
                      <div className={styles.emptyPhoto}>
                        <ImageIcon size={48} />
                        <span>Без фотографий</span>
                      </div>
                    )}
                  </div>
                  <h2>Описание</h2>
                  <p className={styles.description}>
                    {listing.description || "Описание пока не добавлено."}
                  </p>
                </div>
                <aside className={styles.seller}>
                  <strong className={styles.detailPrice}>
                    {listingPriceLabel(listing)}
                  </strong>
                  {listing.location && (
                    <p>
                      <MapPin size={16} />
                      {listing.location}
                    </p>
                  )}
                  <Link href={"/u/" + listing.author.username}>
                    @{listing.author.username}
                  </Link>
                  <p>{listing.author.name}</p>
                  {listing.contact && (
                    <div>
                      <h3>Связаться с автором</h3>
                      <p className={styles.description}>{listing.contact}</p>
                    </div>
                  )}
                  {listing.isOwner && (
                    <div className={styles.ownerActions}>
                      <button
                        className="quiet"
                        disabled={busy}
                        onClick={() =>
                          changeStatus(
                            listing.status === "active" ? "sold" : "active",
                          )
                        }
                      >
                        {listing.status === "active"
                          ? listing.listingType === "sale" ? "Отметить проданным" : "Закрыть объявление"
                          : "Опубликовать"}
                      </button>
                      {listing.status !== "draft" && (
                        <button
                          className="quiet"
                          disabled={busy}
                          onClick={() => changeStatus("draft")}
                        >
                          Снять с публикации
                        </button>
                      )}
                      <button
                        className="quiet danger"
                        disabled={busy}
                        onClick={async () => {
                          if (!confirm("Удалить объявление и фотографии?"))
                            return;
                          setBusy(true);
                          try {
                            await socialApi("market/" + listing.id, "DELETE");
                            location.assign("/market?own=1");
                          } catch (e) {
                            setError(e.message);
                            setBusy(false);
                          }
                        }}
                      >
                        Удалить
                      </button>
                    </div>
                  )}
                </aside>
              </div>
            </article>
          ) : (
            !error && <p role="status">Загружаем объявление…</p>
          )
        ) : (
          <>
            <div className="section-heading">
              <div>
                <h1>Рынок</h1>
                <p>Продать, купить, обменять или отдать велосипед и детали.</p>
              </div>
              <Link className="button small" href="/market/new">
                <Plus size={16} />
                Добавить объявление
              </Link>
            </div>
            <form className={styles.search} role="search" aria-label="Поиск объявлений"
              onSubmit={(e) => {
                e.preventDefault();
                changeFilters({ query: search.trim(), page: 1 });
              }}>
              <Search size={22} aria-hidden="true" />
              <input
                type="search"
                aria-label="Поиск на рынке"
                maxLength={100}
                value={search}
                placeholder="Велосипед, деталь или город"
                onChange={(e) => setSearch(e.target.value)}
              />
              <button className="button">Найти</button>
            </form>
            <section className={styles.filterPanel} aria-label="Фильтры объявлений">
              <div className="ui-tabs">
                <button aria-pressed={!own} onClick={() => changeFilters({ own: false })}>
                  Все объявления
                </button>
                <button aria-pressed={own} onClick={() => changeFilters({ own: true })}>
                  Мои объявления
                </button>
              </div>
              <div className={styles.filterFields}>
                <label className="field">
                  <span>Тип объявления</span>
                  <select value={listingType} onChange={(e) => changeFilters({ listingType: e.target.value })}>
                    <option value="">Все типы</option>
                    {Object.entries(listingTypes).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Состояние</span>
                  <select value={condition} onChange={(e) => changeFilters({ condition: e.target.value })}>
                    <option value="">Любое состояние</option>
                    <option value="used">С пробегом</option>
                    <option value="new">Новое</option>
                  </select>
                </label>
              </div>
              <div className={styles.categories} aria-label="Категории товаров">
                {[["", "Все"], ...Object.entries(marketCategories)].map(([key, label]) => (
                  <button key={key} className="quiet" aria-pressed={category === key}
                    onClick={() => changeFilters({ category: key })}>{label}</button>
                ))}
              </div>
              {(query || category || listingType || condition) && (
                <button type="button" className="quiet" onClick={() => {
                  setSearch("");
                  changeFilters({ query: "", category: "", listingType: "", condition: "", page: 1 });
                }}>Сбросить фильтры</button>
              )}
            </section>
            {data ? (
              <>
                <p className="help" role="status">Найдено объявлений: {data.total}</p>
                <div className={styles.grid}>
                  {data.items.map((m) => (
                    <MarketCard key={m.id} listing={m} />
                  ))}
                </div>
                {!data.items.length && (
                  <div className={styles.empty}>
                    <ShoppingBag size={32} />
                    <h2>Пока нет объявлений</h2>
                    <p>Попробуйте другой запрос или фильтр либо добавьте своё.</p>
                  </div>
                )}
                <Pagination {...data} onPage={(page) => changeFilters({ page })} />
              </>
            ) : (
              !error && <p role="status">Загружаем объявления…</p>
            )}
          </>
        )}
      </main>
      <SocialFooter />
    </>
  );
}
