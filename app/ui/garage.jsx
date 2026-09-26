"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { matchesClassification, readClassificationFilters } from "../../lib/bike-classification.js";
import { readShowcaseQuery, writeShowcaseQuery } from "../../lib/showcase-query.js";
import { publicPath } from "../../lib/public-urls.js";
import EmailPolicyAction from "./email-policy-action.jsx";
import { useConfirmation } from "./confirmation.jsx";
import { useBikeReaction } from "./use-bike-reaction.js";
import { useShowcaseScroll } from "./showcase-scroll.js";
import { SocialFooter } from "./social-primitives.jsx";
import GlobalHeader from "./global-header.jsx";
import { Check, Lock, LoaderCircle } from "./icons.jsx";
import { useSite } from "./site-provider.jsx";
import api from "./garage/api.js";
import BikeDetail from "./garage/bike-detail.jsx";
import Showcase from "./garage/showcase.jsx";
import GarageModal from "./garage/garage-modal.jsx";

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
  // Typed but unsaved data in the open window (wizard or part form).
  const [dirty, setDirty] = useState(false);
  const { categories } = catalog;
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
  const userId = user?.id;
  const requestId = useRef({ sequence: 0 });
  const initialSelection = useRef(initialBikeId);
  // The server rendered the shared bike for this viewer (#74): the first
  // load reuses it instead of asking again.
  const seed = useRef(initial);
  const file = useRef();
  const filterKey = filters.join(",");
  // The reader comes from the server layout (#74). Signing in updates userId
  // and lets the loading effect fetch once with the new viewer.
  const load = useCallback(
    async (viewer = userId) => {
      const sequence = ++requestId.current.sequence;
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
                    ...JSON.parse(facetKey),
                    q: query,
                  }),
              )
            : null;
        seed.current = null;
        const publicData = await dataRequest;
        const data = publicData || (viewer ? await api("bikes") : { bikes: [] });
        if (sequence !== requestId.current.sequence) return;
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
        if (sequence === requestId.current.sequence) {
          setError(e.message);
          if (share && [401, 403, 404].includes(e.status)) setSelected(null);
        }
      } finally {
        if (sequence === requestId.current.sequence) {
          setLoading(false);
          setUpdating(false);
        }
      }
    },
    [
      userId,
      share,
      publicShowcase,
      sort,
      page,
      filterKey,
      facetKey,
      query,
      onAuthenticated,
    ],
  );
  useEffect(() => {
    const pending = requestId.current;
    // Invalidate before the debounce so an old response cannot win during the delay.
    requestId.current.sequence++;
    const timer = setTimeout(
      () => {
        void load();
      },
      query ? 200 : 0,
    );
    return () => {
      clearTimeout(timer);
      pending.sequence++;
    };
  }, [load, query]);
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
    if (startCreate && userId) {
      setModal({ type: "bike" });
      onCreateOpened?.();
    }
  }, [startCreate, userId, onCreateOpened]);
  const Main = embedded ? "section" : "main";
  const bike = selected;
  const detailReaction = useBikeReaction(bike, user, () => auth());
  const editable = !!user && bike?.is_owner === true;
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
    // A window with typed data asks first: a stray click or key must not
    // throw the input away (#129).
    const guard =
      dirty &&
      (modal?.type === "bike" && !modal.bike
        ? { title: "Закрыть мастер?", confirmLabel: "Закрыть мастер" }
        : modal?.type === "part"
          ? {
              title: "Закрыть без сохранения?",
              confirmLabel: "Закрыть без сохранения",
            }
          : null);
    if (
      guard &&
      !(await ask("Несохранённые данные будут потеряны.", {
        ...guard,
        cancelLabel: "Продолжить редактирование",
        danger: true,
      }))
    )
      return;
    setModal(null);
    setDirty(false);
    setError("");
  }
  async function refresh() {
    if (!share || !editable) return load();
    // A revocation rotates share_id. Refresh through the owner-authorized ID
    // endpoint, not the revoked public URL, then adopt the new canonical URL.
    requestId.current.sequence++;
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
          {error}<EmailPolicyAction message={error} />
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
          <Link href="/" className="button">
            {t("Открыть ColaBike")}
          </Link>
        </Main>
      ) : bike ? (
        <BikeDetail
          Main={Main}
          bike={bike}
          share={share}
          settings={settings}
          catalog={catalog}
          t={t}
          user={user}
          editable={editable}
          detailReaction={detailReaction}
          busy={busy}
          photo={photo}
          setPhoto={setPhoto}
          tab={tab}
          setTab={setTab}
          setSelected={setSelected}
          setModal={setModal}
          file={file}
          auth={auth}
          run={run}
          refresh={refresh}
          setNotice={setNotice}
        />
      ) : (
        <Showcase
          Main={Main}
          embedded={embedded}
          publicShowcase={publicShowcase}
          rememberScroll={rememberScroll}
          account={account}
          settings={settings}
          t={t}
          loading={loading}
          total={total}
          sort={sort}
          setSort={setSort}
          setPage={setPage}
          filters={filters}
          setFilters={setFilters}
          user={user}
          setModal={setModal}
          categories={categories}
          query={query}
          setQuery={setQuery}
          facets={facets}
          setFacets={setFacets}
          updating={updating}
          filtered={filtered}
          resultRevision={resultRevision}
          openBike={openBike}
          auth={auth}
          page={page}
        />
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
        <GarageModal
          modal={modal}
          bike={bike}
          photo={photo}
          t={t}
          busy={busy}
          error={error}
          close={close}
          setError={setError}
          setModal={setModal}
          run={run}
          refreshViewer={refreshViewer}
          setSelected={setSelected}
          setNotice={setNotice}
          refresh={refresh}
          setDirty={setDirty}
          setBusy={setBusy}
          account={account}
          router={router}
          openBike={openBike}
          share={share}
          setPhoto={setPhoto}
        />
      )}
      {confirmation}
    </>
  );
}
