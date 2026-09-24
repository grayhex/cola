"use client";
import ClassificationFields, {
  ClassificationFilters,
} from "./bike-classification.jsx";
import { FormerBikeField } from "./bike-fields.jsx";
import fieldStyles from "./bike-fields.module.css";
import { PhotoActions } from "./content-label.jsx";
import {
  bikeCategories,
  classificationOf,
  compatibilityCategory,
  matchesClassification,
  readClassificationFilters,
} from "../../lib/bike-classification.js";
import SiteEmoji from "./site-emoji.jsx";
import { useConfirmation } from "./confirmation.jsx";
import ChoiceMenu from "./choice-menu.jsx";
import { BikeLabels, BikeLike } from "./bike-labels.jsx";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  readShowcaseQuery,
  writeShowcaseQuery,
} from "../../lib/showcase-query.js";
import { useBikeReaction } from "./use-bike-reaction.js";
import { useShowcaseScroll } from "./showcase-scroll.js";

import styles from "./garage.module.css";
import BikeGrid from "./bike-grid.jsx";
import { FilterControl, FilterChips } from "./compact-ui.jsx";
import { BikeGame } from "./achievements.jsx";
import RideList from "./ride-list.jsx";
import JournalList from "./journal-list.jsx";
import BikeCategoryIcon from "./bike-category-icon.jsx";
import BikeMeters from "./bike-meters.jsx";
import Photo from "./bike-photo.jsx";
import BikeCard from "./bike-card.jsx";
import { SocialFooter, AuthorLink } from "./social-primitives.jsx";
import ShareButton from "./share-button.jsx";
import { publicPath } from "../../lib/public-urls.js";
import GlobalHeader from "./global-header.jsx";

import Versions from "./versions.jsx";
import { parseBikeName } from "../../lib/bike-name.js";
import GroupedComponents from "./grouped-components.jsx";
import { defaultBlocks } from "../../lib/garage-layout.js";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Bike,
  Trophy,
  Heart,
  Plus,
  ArrowUpRight,
  ArrowUpDown,
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
} from "./icons.jsx";
import { useSite } from "./site-provider.jsx";
import PartIcon from "./part-icon.jsx";
// Loaded on demand: the showcase and a guest's bike page never download the
// comment editor (Tiptap), the wizard (form schemas) or the owner's tools.
const Discussion = dynamic(() => import("./discussion.jsx"), { ssr: false });
const AuthForm = dynamic(() => import("./auth-form.jsx"), { ssr: false });
const PhotoSearch = dynamic(() => import("./photo-search.jsx"), { ssr: false });
const BikeWizard = dynamic(() => import("./bike-wizard.jsx"), { ssr: false });
const FactorySpecification = dynamic(
  () => import("./factory-specification.jsx"),
  { ssr: false },
);

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
  is_former: false,
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
  if (!r.ok) {
    const error = new Error(b.error || "Не удалось выполнить запрос");
    error.status = r.status;
    throw error;
  }
  return b;
}
function Modal({ title, onClose, children, dismissible = true }) {
  const { settings, catalog, t } = useSite();
  const { categories, models, parts, partCategories, manufacturers } = catalog;
  const ref = useRef();
  useEffect(() => {
    const el = ref.current;
    const y = window.scrollY,
      body = document.body,
      previous = body.getAttribute("style");
    Object.assign(body.style, {
      position: "fixed",
      top: `-${y}px`,
      left: "0",
      right: "0",
      width: "100%",
    });
    el.showModal();
    return () => {
      el.close();
      if (previous === null) body.removeAttribute("style");
      else body.setAttribute("style", previous);
      window.scrollTo({ top: y, behavior: "instant" });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) onClose();
      }}
      onClick={(e) => {
        if (dismissible && e.target === e.currentTarget) onClose();
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

export default function Garage({
  share,
  initial = null,
  account = false,
  embedded = false,
  startCreate = false,
  initialBikeId = null,
  onAuthenticated,
  onCreateOpened,
}) {
  const {
    personalSettings: settings,
    catalog,
    t,
    viewer: user,
    refreshViewer,
  } = useSite();
  const [ask, confirmation] = useConfirmation();
  const [wizardDirty, setWizardDirty] = useState(false);
  const { categories, models, parts, partCategories, manufacturers } = catalog;
  const [bikes, setBikes] = useState([]),
    [selected, setSelected] = useState(initial?.bike || null),
    [loading, setLoading] = useState(!initial),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [modal, setModal] = useState(null),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("build"),
    [localSort, setLocalSort] = useState("new"),
    [localFilters, setLocalFilters] = useState([]),
    [localQuery, setLocalQuery] = useState(""),
    [photo, setPhoto] = useState(null);
  const [localPage, setLocalPage] = useState(1),
    [total, setTotal] = useState(0);
  const router = useRouter(),
    params = useSearchParams();
  const parsed = useMemo(
    () => readShowcaseQuery(params, categories),
    [params, categories],
  );
  const publicShowcase = !account && !share;
  const [localFacets, setLocalFacets] = useState(() =>
    readClassificationFilters(new URLSearchParams()),
  );
  const facets = publicShowcase
    ? readClassificationFilters(params)
    : localFacets;
  const facetKey = JSON.stringify(facets);
  function setFacets(value) {
    if (publicShowcase) change({ ...value, page: 1 });
    else {
      setLocalFacets((previous) => ({ ...previous, ...value }));
      setLocalPage(1);
    }
  }
  const rememberScroll = useShowcaseScroll(publicShowcase && !loading);
  const { sort, filters, query, page } = publicShowcase
    ? parsed
    : {
        sort: localSort,
        filters: localFilters,
        query: localQuery,
        page: localPage,
      };
  function change(patch) {
    const search = writeShowcaseQuery(
      new URLSearchParams(window.location.search),
      patch,
    );
    window.history.replaceState(
      null,
      "",
      window.location.pathname + (search ? "?" + search : ""),
    );
  }
  const setSort = (value) =>
    publicShowcase ? change({ sort: value, page: 1 }) : setLocalSort(value);
  const setFilters = (value) =>
    publicShowcase
      ? change({ filters: value, page: 1 })
      : setLocalFilters(value);
  const setQuery = (value) =>
    publicShowcase ? change({ query: value, page: 1 }) : setLocalQuery(value);
  const setPage = (value) =>
    publicShowcase
      ? change({ page: typeof value === "function" ? value(page) : value })
      : setLocalPage(value);
  const [updating, setUpdating] = useState(false),
    [resultRevision, setResultRevision] = useState(0);
  const requestId = useRef(0);
  const initialSelection = useRef(initialBikeId);
  // The server rendered the shared bike for this viewer (#74): the first
  // load reuses it instead of asking again.
  const seed = useRef(initial);
  const file = useRef();
  const filterKey = filters.join(",");
  // The reader comes from the server layout (#74); a sign-in in the dialog
  // passes the new one explicitly, before the context re-renders.
  async function load(viewer = user) {
    const sequence = ++requestId.current;
    setUpdating(true);
    setError("");
    try {
      const dataRequest = share
        ? seed.current || api("shared/" + share)
        : publicShowcase
          ? api(
              "showcase?" +
                new URLSearchParams({
                  sort,
                  page,
                  category: filterKey,
                  ...facets,
                  q: query,
                }),
            )
          : null;
      seed.current = null;
      const publicData = await dataRequest;
      const data = publicData || (viewer ? await api("bikes") : { bikes: [] });
      if (sequence !== requestId.current) return;
      if (viewer && onAuthenticated) onAuthenticated();
      if (share) setSelected(data.bike);
      else {
        setBikes(data.bikes);
        setTotal(data.total ?? data.bikes.length);
        setResultRevision((v) => v + 1);
        const requested = initialSelection.current;
        initialSelection.current = null;
        setSelected((prev) =>
          prev
            ? data.bikes.find((b) => b.id === prev.id) || null
            : requested
              ? data.bikes.find((b) => b.id === requested) || null
              : null,
        );
      }
    } catch (e) {
      if (sequence === requestId.current) {
        setError(e.message);
        if (share && [401, 403, 404].includes(e.status)) setSelected(null);
      }
    } finally {
      if (sequence === requestId.current) {
        setLoading(false);
        setUpdating(false);
      }
    }
  }
  useEffect(() => {
    // Invalidate before the debounce so an old response cannot win during the delay.
    requestId.current++;
    const timer = setTimeout(
      () => {
        void load();
      },
      query ? 200 : 0,
    );
    return () => {
      clearTimeout(timer);
      requestId.current++;
    };
  }, [share, account, page, filterKey, facetKey, query, sort]);
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
  useEffect(() => {
    if (startCreate && user) {
      setModal({ type: "bike" });
      onCreateOpened?.();
    }
  }, [startCreate, user?.id, onCreateOpened]);
  const Main = embedded ? "section" : "main";
  const bike = selected;
  const detailReaction = useBikeReaction(bike, user, () => auth());
  const blocks = settings.detailBlocks || defaultBlocks;
  const block = (id) =>
    blocks.find((b) => b.id === id) || defaultBlocks.find((b) => b.id === id);
  const blockProps = (id) => ({
    hidden: !block(id).enabled,
    style: { order: blocks.findIndex((b) => b.id === id) + 1 },
    "data-variant": block(id).variant,
  });
  const editable = !!user && bike?.is_owner === true;
  const modelName = [bike?.brand, bike?.model, bike?.trim]
    .filter(Boolean)
    .join(" ");
  const named = Boolean(bike?.name) && bike.name !== modelName;
  const subtitle = [
    named && modelName,
    bike?.year && (named ? bike.year : `${t("Модельный год")} ${bike.year}`),
  ]
    .filter(Boolean)
    .join(" · ");
  // Without the "О велосипеде" block, the owner's text, public price and
  // manufacturer link stay visible under the title.
  const intro = bike &&
    !block("summary").enabled && {
      description:
        settings.summaryFields?.description !== false && bike.description,
      price:
        bike.show_bike_price &&
        bike.price != null &&
        settings.summaryFields?.price !== false,
      link:
        settings.summaryFields?.manufacturer !== false && bike.manufacturer_url,
    };
  function openBike(b) {
    if (!account) {
      router.push(publicPath("bike", b));
      return;
    }
    setSelected(b);
    setPhoto(null);
    setTab("build");
    window.scrollTo({ top: 0 });
  }
  async function close() {
    if (busy) return;
    if (
      modal?.type === "bike" &&
      !modal.bike &&
      wizardDirty &&
      !(await ask("Несохранённые данные будут потеряны.", {
        title: "Закрыть мастер?",
        confirmLabel: "Закрыть мастер",
        cancelLabel: "Продолжить редактирование",
        danger: true,
      }))
    )
      return;
    setModal(null);
    setWizardDirty(false);
    setError("");
  }
  async function refresh() {
    if (!share || !editable) return load();
    // A revocation rotates share_id. Refresh through the owner-authorized ID
    // endpoint, not the revoked public URL, then adopt the new canonical URL.
    requestId.current++;
    try {
      const { bike: updated } = await api("bikes/" + bike.id);
      setSelected(updated);
      if (updated.share_id !== share)
        router.replace(publicPath("bike", updated), { scroll: false });
    } catch (e) {
      if ([401, 403, 404].includes(e.status)) setSelected(null);
      throw e;
    }
  }
  function auth(mode = "login") {
    setError("");
    setModal({ type: "auth", mode });
  }
  const filtered = account
    ? bikes.filter(
        (b) =>
          matchesClassification(b, facets, filters) &&
          `${b.name} ${b.brand} ${b.model}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      )
    : bikes;
  return (
    <>
      {!embedded && (
        <GlobalHeader
          user={user}
          onProfile={!user ? () => auth() : undefined}
        />
      )}
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
      {loading && !publicShowcase ? (
        <Main className="loading">
          <LoaderCircle className="spin" />
          {t("Загружаем велосипеды…")}
        </Main>
      ) : share && !bike ? (
        <Main className="empty">
          <Lock size={36} />
          <h1>{t("Велосипед недоступен")}</h1>
          <p>{t("Владелец мог закрыть доступ или изменить ссылку.")}</p>
          <a href="/" className="button">
            {t("Открыть ColaBike")}
          </a>
        </Main>
      ) : bike ? (
        <Main className="detail bike-detail">
          <div className="breadcrumbs">
            {!share ? (
              <button
                className="quiet"
                onClick={() => {
                  setSelected(null);
                  setPhoto(null);
                }}
              >
                <ArrowLeft size={16} />
                {t("Мои велосипеды")}
              </button>
            ) : (
              <span>
                {share ? (
                  <AuthorLink author={bike.author} />
                ) : (
                  t("Пример вашего будущего гаража")
                )}
              </span>
            )}
            <ChevronRight size={14} />
            <a
              href={
                "/experience?" +
                new URLSearchParams({
                  brand: bike.brand || "",
                  model: bike.model || "",
                })
              }
              title="Опыт владельцев этой модели"
            >
              {bike.brand} {bike.model}
            </a>
          </div>
          <div
            className="bike-heading configurable-block"
            {...blockProps("heading")}
          >
            <div>
              <div className="bike-detail-title-row">
                <h1>{bike.name || modelName}</h1>
              </div>
              {subtitle && <p className="bike-subtitle">{subtitle}</p>}
              <div className="bike-heading-labels">
                <BikeLabels bike={bike} />
              </div>
            </div>
            <div className="detail-actions">
              {share && <AuthorLink author={bike.author} />}
              {editable ? (
                <>
                  {bike.is_public && (
                    <ShareButton
                      path={publicPath("bike", bike)}
                      title={bike.name || modelName}
                    />
                  )}
                  <button
                    className="icon bordered share-action"
                    aria-label={t("Доступ")}
                    title={t("Кто видит велосипед")}
                    onClick={() => setModal({ type: "share" })}
                  >
                    {bike.is_public ? <Globe size={17} /> : <Lock size={17} />}
                    <span>{t("Доступ")}</span>
                  </button>
                  <button
                    className="icon bordered"
                    aria-label={t("Редактировать велосипед")}
                    onClick={() => setModal({ type: "bike", bike })}
                  >
                    <Pencil size={18} />
                  </button>
                  <button
                    className="icon danger"
                    aria-label="Удалить велосипед"
                    onClick={() => setModal({ type: "deleteBike" })}
                  >
                    <Trash2 size={16} />
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
                <ShareButton
                  path={publicPath("bike", bike)}
                  title={bike.name || modelName}
                />
              )}
            </div>
            {intro && (intro.description || intro.price || intro.link) && (
              <div className="bike-intro">
                {intro.description && <p>{bike.description}</p>}
                {(intro.price || intro.link) && (
                  <p className="bike-intro-facts">
                    {intro.price && (
                      <span>
                        {t("Стоимость велосипеда")}:{" "}
                        <strong>{rub(bike.price)}</strong>
                      </span>
                    )}
                    {intro.link && (
                      <a
                        className="part-link"
                        href={bike.manufacturer_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t("Сайт производителя")}
                      </a>
                    )}
                  </p>
                )}
              </div>
            )}
          </div>
          <div
            className="bike-meta-line"
            hidden={!block("heading").enabled}
            style={{ order: blocks.findIndex((b) => b.id === "heading") + 1 }}
          >
            {bike.color && <span>{bike.color}</span>}
            {settings.showMileage && (
              <span>
                {Number(bike.mileage || 0).toLocaleString("ru-RU")} км
              </span>
            )}
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
                <Photo
                  bike={bike}
                  photo={photo}
                  className="hero-photo"
                  sizes="(max-width: 700px) 100vw, 40vw"
                  priority
                />
              </button>
              {editable && (
                <div className="photo-tools">
                  <button
                    type="button"
                    className="icon"
                    disabled={busy}
                    aria-label="Загрузить фото"
                    onClick={() => file.current.click()}
                  >
                    <Plus size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon"
                    aria-label="Найти фотографии"
                    onClick={() => setModal({ type: "photoSearch" })}
                  >
                    <Search size={16} />
                  </button>
                </div>
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
            {bike.is_public && (
              <PhotoActions>
                <BikeLike bike={bike} reaction={detailReaction} t={t} />
                {detailReaction.error && (
                  <p role="alert">{t("Лайк не сохранился. Попробуй ещё раз")}</p>
                )}
              </PhotoActions>
            )}
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
                      <Photo bike={bike} photo={p} sizes="160px" />
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
          {bike.is_public && (
            <BikeGame
              key={JSON.stringify([
                bike.id,
                bike.likes,
                bike.weight,
                bike.category,
                bike.show_bike_price,
                bike.price,
                bike.scores,
                bike.photos.length,
              ])}
              bike={bike}
              user={user}
            />
          )}
          {bike.is_public && <RideList bikeId={bike.id} latest />}
          {/* Sibling keys must differ: with two equal keys React loses one
              fiber on update and leaves a stale copy of its DOM behind. */}
          {bike.id !== "demo" && (
            <JournalList
              key={"journal:" + bike.id}
              bike={bike}
              owner={bike.is_owner}
              editable={editable}
            />
          )}
          {bike.is_public && (
            <Discussion key={"discussion:" + bike.id} bike={bike} user={user} />
          )}
        </Main>
      ) : (
        <>
          <Main
            className={`garage ${styles.garage}`}
            onClickCapture={publicShowcase ? rememberScroll : undefined}
          >
            <div className={`garage-heading ${styles.heading}`}>
              <div className="showcase-heading-copy">
                <h1 className={styles.title}>
                  {account
                    ? t("Мои велосипеды")
                    : t(settings.showcaseTitle || "Наши велосипеды")}
                </h1>
              </div>
              <div
                className={`showcase-actions ${styles.actions}`}
                aria-label={t("Действия витрины")}
              >
                {!account && (
                  <ChoiceMenu
                    label="Порядок витрины"
                    value={sort}
                    choices={[
                      { value: "new", label: "Новые", emoji: "new" },
                      {
                        value: "popular",
                        label: "Популярные",
                        emoji: "popular",
                      },
                      {
                        value: "records",
                        label: "Рекордсмены",
                        emoji: "records",
                      },
                    ]}
                    onChange={(value) => {
                      setSort(value);
                      setPage(1);
                    }}
                  />
                )}
                <FilterControl
                  categories={bikeCategories}
                  selected={filters}
                  onChange={(values) => {
                    setFilters(values);
                    setPage(1);
                  }}
                />
                {!account && (
                  <Link
                    className="compact-button add-bike"
                    href="/account?tab=bikes&action=add"
                    aria-label={t("Добавить велосипед")}
                  >
                    <SiteEmoji name="addBike" />
                    <span className={styles.addLabel}>
                      {t("Добавить велосипед")}
                    </span>
                  </Link>
                )}
                {user && account && (
                  <button
                    type="button"
                    className="compact-icon add-bike"
                    aria-label="Добавить велосипед"
                    title="Добавить велосипед"
                    onClick={() => setModal({ type: "bike" })}
                  >
                    <SiteEmoji name="addBike" />
                  </button>
                )}
              </div>
            </div>
            {publicShowcase && !user && (
              <p className={styles.invitation}>
                {t("Твой байк тоже здесь к месту")} ·{" "}
                <Link href="/account?tab=bikes&action=add">
                  {t("Покажи велосипед. Расскажи, что поменял")}
                </Link>
              </p>
            )}
            {account && !user && (
              <p>Войдите, чтобы управлять своими велосипедами и оформлением.</p>
            )}
            <FilterChips
              categories={categories}
              selected={filters}
              onChange={(values) => {
                setFilters(values);
                setPage(1);
              }}
              query={query}
              onClearSearch={() => {
                setQuery("");
                setPage(1);
              }}
            />
            <ClassificationFilters value={facets} onChange={setFacets} />
            <span className={styles.status} role="status">
              {loading
                ? t("Загружаем велосипеды…")
                : updating
                  ? t("Обновляем велосипеды…")
                  : ""}
            </span>
            <BikeGrid bikes={filtered} revision={resultRevision}>
              {loading &&
                [0, 1, 2].map((id) => (
                  <div
                    key={id}
                    className={styles.skeleton}
                    aria-hidden="true"
                  />
                ))}
              {filtered.map((b) => (
                <BikeCard
                  key={b.id}
                  bike={b}
                  onOpen={account ? () => openBike(b) : undefined}
                  user={user}
                  onGuest={() => auth()}
                  ownerView={account}
                />
              ))}
            </BikeGrid>
            {!account && total > 24 && (
              <nav className="feed-pages" aria-label="Страницы витрины">
                <button
                  className="quiet"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Назад
                </button>
                <span>
                  {page} / {Math.ceil(total / 24)}
                </span>
                <button
                  className="quiet"
                  disabled={page * 24 >= total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Далее
                </button>
              </nav>
            )}
            {!loading && !filtered.length && !query && !filters.length && (
              <p className="help">
                {account
                  ? "Добавьте свой первый велосипед."
                  : "Пока нет публичных велосипедов. Опубликуйте свой!"}
              </p>
            )}
            {!loading && !filtered.length && (query || filters.length > 0) && (
              <div className="empty-parts">
                <Search />
                <h3>{t("Таких велосипедов пока не нашли")}</h3>
                <button
                  className="quiet"
                  onClick={() => {
                    setQuery("");
                    setFilters([]);
                  }}
                >
                  {t("Сбросить фильтры")}
                </button>
              </div>
            )}
          </Main>
        </>
      )}
      {!embedded && <SocialFooter />}
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
              profile: "Личный кабинет",
              auth:
                modal.mode === "register"
                  ? t("Регистрация")
                  : t("С возвращением"),
              bike: modal.bike ? t("О велосипеде") : t("Новый велосипед"),
              part: modal.part
                ? t("Изменить деталь")
                : modal.section === "build"
                  ? t("Добавить компонент")
                  : t("Добавить аксессуар"),
              share: t("Доступ к велосипеду"),
              photoSearch: "Выбор фотографий",
              photoView: t("Фотография велосипеда"),
              deleteBike: t("Удалить велосипед?"),
              deletePart: t("Удалить деталь?"),
              deletePhoto: t("Удалить фотографию?"),
            }[modal.type]
          }
          onClose={close}
          dismissible={modal.type !== "bike" || !!modal.bike}
        >
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {modal.type === "photoView" && (
            <Photo bike={bike} photo={photo} className="full-photo" full />
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
                  const signedIn = await refreshViewer();
                  setSelected(null);
                  await load(signedIn);
                  setModal(null);
                  setNotice(
                    modal.mode === "register"
                      ? t("Аккаунт готов. Добавьте свой первый байк.")
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
          {modal.type === "bike" && !modal.bike && (
            <BikeWizard
              onDirtyChange={setWizardDirty}
              onBusy={setBusy}
              onCreated={async (id) => {
                if (!account) {
                  router.push("/account");
                  return;
                }
                await refresh();
                const { bike: b } = await api("bikes/" + id);
                openBike(b);
                setModal(null);
                setNotice("Велосипед сохранён");
              }}
            />
          )}
          {modal.type === "bike" && modal.bike && (
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
                      ? t("Опубликован на витрине")
                      : t("Личный велосипед")}
                  </h3>
                  <p>
                    {t(
                      "Публичный велосипед виден всем на витрине. Почта скрыта; цены видны только при включённом отображении.",
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
                  : t("Опубликовать на витрине")}
              </button>
              {bike.is_public && (
                <div className="share-copy">
                  <input
                    readOnly
                    aria-label={t("Публичная ссылка")}
                    value={
                      typeof window !== "undefined"
                        ? window.location.origin + publicPath("bike", bike)
                        : ""
                    }
                  />
                  <button
                    className="icon bordered"
                    aria-label={t("Скопировать ссылку")}
                    onClick={() =>
                      run(async () => {
                        await navigator.clipboard.writeText(
                          window.location.origin + publicPath("bike", bike),
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
                      if (modal.type === "deleteBike") {
                        setSelected(null);
                        if (share) {
                          setModal(null);
                          router.replace("/account?tab=bikes");
                          return;
                        }
                      }
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
      {confirmation}
    </>
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
          className={fieldStyles.modelInput}
        />
      </Field>
      <FormerBikeField value={b.is_former} disabled={busy}
        onChange={(value) => update("is_former", value)} />
      <ClassificationFields
        value={classificationOf(b)}
        onChange={(classification) =>
          set((previous) => ({
            ...previous,
            classification,
            category: compatibilityCategory(classification),
          }))
        }
      />
      <div className="form-grid">
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
      <fieldset className="bike-purposes">
        <legend>Метки опыта — необязательно</legend>
        {catalog.purposes
          .filter((p) => p.enabled || (b.purposes || []).includes(p.id))
          .map((p) => (
            <label key={p.id}>
              <input
                type="checkbox"
                checked={(b.purposes || []).includes(p.id)}
                onChange={(e) =>
                  update(
                    "purposes",
                    e.target.checked
                      ? [...(b.purposes || []), p.id]
                      : (b.purposes || []).filter((id) => id !== p.id),
                  )
                }
              />
              {p.name}
            </label>
          ))}
      </fieldset>
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
      <Field label="Текущий пробег, км">
        <input
          type="number"
          min="0"
          max="10000000"
          step="1"
          value={b.mileage ?? 0}
          onChange={(e) => update("mileage", Number(e.target.value))}
        />
      </Field>
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
          {manufacturers
            .filter(
              (m) =>
                !search ||
                m.toLowerCase().includes(search.trim().toLowerCase()),
            )
            .slice(0, 8)
            .map((m) => (
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
          {suggestions.slice(0, 8).map((p) => (
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
        {t("Выберите из справочника или введите своё название.")} Показываем до
        8 совпадений — уточните название.
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
