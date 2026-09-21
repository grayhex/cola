"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ShoppingBag,
  Plus,
  MapPin,
  ArrowLeft,
  Image as ImageIcon,
} from "lucide-react";
import {
  SocialHeader,
  SocialFooter,
  socialApi,
  Pagination,
} from "./social-primitives.jsx";
import { useSite } from "./site-provider.jsx";
import styles from "./market.module.css";
export const marketCategories = {
  bikes: "Велосипеды",
  components: "Комплектующие",
  accessories: "Аксессуары",
};
const money = (p, c) =>
  Number(p).toLocaleString("ru-RU", {
    style: "currency",
    currency: c,
    maximumFractionDigits: 2,
  });
export function MarketCard({ listing: m }) {
  return (
    <article className={styles.card}>
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
        <small>
          {marketCategories[m.category]} ·{" "}
          {m.condition === "new" ? "Новое" : "С пробегом"}
          {m.status !== "active"
            ? " · " + (m.status === "sold" ? "Продано" : "Черновик")
            : ""}
        </small>
        <h3>
          <Link href={"/market/" + m.shareId}>{m.title}</Link>
        </h3>
        <strong className={styles.price}>{money(m.price, m.currency)}</strong>
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
  condition: "used",
  price: "",
  currency: "RUB",
  location: "",
  contact: "",
  status: "draft",
};
function ListingEditor({ initial, onSaved, onCancel }) {
  const [form, setForm] = useState(
      initial
        ? Object.fromEntries(Object.keys(blank).map((k) => [k, initial[k]]))
        : blank,
    ),
    [identity, setIdentity] = useState(initial),
    [photos, setPhotos] = useState(initial?.photos || []),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  async function save(status) {
    const body = { ...form, price: Number(form.price || 0), status };
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
      <div className={styles.formGrid}>
        <label className="field">
          <span>Цена</span>
          <input
            type="number"
            required
            min="0"
            max="9999999999"
            step="0.01"
            value={form.price}
            onChange={(e) => set("price", e.target.value)}
          />
        </label>
        <label className="field">
          <span>Валюта</span>
          <select
            value={form.currency}
            onChange={(e) => set("currency", e.target.value)}
          >
            <option value="RUB">₽ · RUB</option>
            <option value="USD">$ · USD</option>
            <option value="EUR">€ · EUR</option>
          </select>
        </label>
      </div>
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
    [own, setOwn] = useState(false),
    [category, setCategory] = useState(""),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false);
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    setOwn(p.get("own") === "1");
    setCategory(
      Object.hasOwn(marketCategories, p.get("category"))
        ? p.get("category")
        : "",
    );
    setEdit(create || p.get("edit") === "1");
    setReady(true);
    socialApi("me")
      .then((d) => {
        setUser(d.user);
        setPreferences(d.user?.preferences || {});
      })
      .catch((e) => setError(e.message));
  }, [share, create]);
  useEffect(() => {
    if (!ready || create || user === undefined || (own && !user)) return;
    let active = true;
    setError("");
    const path = share
      ? "market/public/" + share
      : "market?" +
        new URLSearchParams({
          ...(own ? { own: "1" } : {}),
          ...(category ? { category } : {}),
          q: query,
          page,
        });
    socialApi(path)
      .then((d) => {
        if (active) {
          if (share) setListing(d.listing);
          else setData(d);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [ready, share, create, user?.id, own, category, query, page]);
  const saved = async (r) => {
    location.assign("/market/" + r.shareId);
  };
  async function changeStatus(status) {
    setBusy(true);
    setError("");
    try {
      const body = {
        ...Object.fromEntries(Object.keys(blank).map((k) => [k, listing[k]])),
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
                  <small>
                    {marketCategories[listing.category]} ·{" "}
                    {listing.condition === "new" ? "Новое" : "С пробегом"}
                  </small>
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
                    ? "Объявление закрыто · продано"
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
                    {money(listing.price, listing.currency)}
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
                      <h3>Связаться с продавцом</h3>
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
                          ? "Отметить проданным"
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
                <p>Велосипеды, детали и вещи для следующей поездки.</p>
              </div>
              <Link className="button small" href="/market/new">
                <Plus size={16} />
                Добавить объявление
              </Link>
            </div>
            <div className={styles.filters}>
              <div className="ui-tabs">
                <button
                  aria-pressed={!own}
                  onClick={() => {
                    setOwn(false);
                    setPage(1);
                  }}
                >
                  Все объявления
                </button>
                <button
                  aria-pressed={own}
                  onClick={() => {
                    setOwn(true);
                    setPage(1);
                  }}
                >
                  Мои объявления
                </button>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setQuery(search);
                  setPage(1);
                }}
              >
                <input
                  aria-label="Поиск на рынке"
                  maxLength={100}
                  value={search}
                  placeholder="Название или город"
                  onChange={(e) => setSearch(e.target.value)}
                />
                <button className="quiet">Найти</button>
              </form>
            </div>
            <div className={styles.categories}>
              {[["", "Все"], ...Object.entries(marketCategories)].map(
                ([key, label]) => (
                  <button
                    key={key}
                    className="quiet"
                    aria-pressed={category === key}
                    onClick={() => {
                      setCategory(key);
                      setPage(1);
                    }}
                  >
                    {label}
                  </button>
                ),
              )}
            </div>
            {data ? (
              <>
                <div className={styles.grid}>
                  {data.items.map((m) => (
                    <MarketCard key={m.id} listing={m} />
                  ))}
                </div>
                {!data.items.length && (
                  <div className={styles.empty}>
                    <ShoppingBag size={32} />
                    <h2>Пока нет объявлений</h2>
                    <p>Попробуйте другую категорию или добавьте своё.</p>
                  </div>
                )}
                <Pagination {...data} onPage={setPage} />
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
