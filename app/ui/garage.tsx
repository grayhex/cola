"use client";
import type * as React from "react";
import type { BikeDto, PublicPhoto } from "../../lib/contracts.ts";
import { sendBikePhoto, type PhotoProblem } from "../../lib/photo-upload.ts";
import type { GarageModalState } from "./garage/types.ts";
import { errorMessage, errorStatus } from "../../lib/errors.ts";
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  matchesClassification,
  readClassificationFilters,
} from "../../lib/bike-classification.ts";
import {
  readShowcaseQuery,
  writeShowcaseQuery,
} from "../../lib/showcase-query.ts";
import { publicPath } from "../../lib/public-urls.ts";
import EmailPolicyAction from "./email-policy-action.tsx";
import { useConfirmation } from "./confirmation.tsx";
import { useBikeReaction } from "./use-bike-reaction.ts";
import { useShowcaseScroll } from "./showcase-scroll.ts";
import { SocialFooter } from "./social-primitives.tsx";
import GlobalHeader from "./global-header.tsx";
import { Check, Lock, LoaderCircle } from "./icons.tsx";
import { useSite } from "./site-provider.tsx";
import api from "./garage/api.ts";
import BikeDetail from "./garage/bike-detail.tsx";
import Showcase from "./garage/showcase.tsx";
import GarageModal from "./garage/garage-modal.tsx";

export default function Garage({
  share,
  initial = null,
  account = false,
  embedded = false,
  startCreate = false,
  initialBikeId = null,
  onAuthenticated,
  onCreateOpened,
}: {
  share?: string;
  initial?: { bike: BikeDto } | null;
  account?: boolean;
  embedded?: boolean;
  startCreate?: boolean;
  initialBikeId?: string | null;
  onAuthenticated?: () => void;
  onCreateOpened?: () => void;
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
  const [bikes, setBikes] = useState<BikeDto[]>([]),
    [selected, setSelected] = useState(initial?.bike || null),
    [loading, setLoading] = useState(!initial),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [modal, setModal] = useState<GarageModalState | null>(null),
    [busy, setBusy] = useState(false),
    [localSort, setLocalSort] = useState("new"),
    [localFilters, setLocalFilters] = useState<string[]>([]),
    [localQuery, setLocalQuery] = useState(""),
    [photo, setPhoto] = useState<PublicPhoto | null>(null),
    // The refusals belong to the bike they were made on: the page shows them
    // only there, however the selection moves.
    [refused, setRefused] = useState<{
      bikeId: string;
      problems: PhotoProblem[];
    } | null>(null);
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
  function setFacets(value: Record<string, string>) {
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
  function change(patch: Parameters<typeof writeShowcaseQuery>[1]) {
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
  const setSort = (value: string) =>
    publicShowcase ? change({ sort: value, page: 1 }) : setLocalSort(value);
  const setFilters = (value: string[]) =>
    publicShowcase
      ? change({ filters: value, page: 1 })
      : setLocalFilters(value);
  const setQuery = (value: string) =>
    publicShowcase ? change({ query: value, page: 1 }) : setLocalQuery(value);
  const setPage = (value: React.SetStateAction<number>) =>
    publicShowcase
      ? change({ page: typeof value === "function" ? value(page) : value })
      : setLocalPage(value);
  const [updating, setUpdating] = useState(false);
  const userId = user?.id;
  const requestId = useRef({ sequence: 0 });
  const initialSelection = useRef(initialBikeId);
  // The server rendered the shared bike for this viewer (#74): the first
  // load reuses it instead of asking again.
  const seed = useRef(initial);
  const loaded = useRef(false);
  const file = useRef<HTMLInputElement>(null);
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
          ? seed.current || api<{ bike: BikeDto }>("shared/" + share)
          : publicShowcase
            ? api<{ bikes: BikeDto[]; total: number }>(
                "showcase?" +
                  new URLSearchParams({
                    sort,
                    page: String(page),
                    category: filterKey,
                    ...JSON.parse(facetKey),
                    q: query,
                  }),
              )
            : null;
        seed.current = null;
        const publicData = await dataRequest;
        const data =
          publicData ||
          (viewer
            ? await api<{ bikes: BikeDto[]; total?: number }>("bikes")
            : { bikes: [] });
        if (sequence !== requestId.current.sequence) return;
        if (viewer && onAuthenticated) onAuthenticated();
        if (share) setSelected((data as { bike: BikeDto }).bike);
        else {
          const list = data as { bikes: BikeDto[]; total?: number };
          const updateGrid = () => {
            setBikes(list.bikes);
            setTotal(list.total ?? list.bikes.length);
          };
          // The first grid must commit with loading=false: scroll restoration
          // needs its real height, and account forms must not remount later.
          if (publicShowcase && loaded.current) startTransition(updateGrid);
          else updateGrid();
          loaded.current = true;
          const requested = initialSelection.current;
          initialSelection.current = null;
          setSelected((prev) =>
            prev
              ? list.bikes.find((b) => b.id === prev.id) || null
              : requested
                ? list.bikes.find((b) => b.id === requested) || null
                : null,
          );
        }
      } catch (e) {
        if (sequence === requestId.current.sequence) {
          setError(errorMessage(e));
          if (share && [401, 403, 404].includes(errorStatus(e) || 0))
            setSelected(null);
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
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
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
  function openBike(b: BikeDto) {
    if (!account) {
      router.push(publicPath("bike", b));
      return;
    }
    setSelected(b);
    setPhoto(null);
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
      const { bike: updated } = await api<{ bike: BikeDto }>(
        "bikes/" + bike!.id,
      );
      setSelected(updated);
      if (updated.share_id !== share)
        router.replace(publicPath("bike", updated), { scroll: false });
    } catch (e) {
      if ([401, 403, 404].includes(errorStatus(e) || 0)) setSelected(null);
      throw e;
    }
  }
  function auth(mode: "login" | "register" = "login") {
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
          <EmailPolicyAction message={error} />
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
          key={bike.id + ":" + (userId || "guest")}
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
          photoProblems={refused?.bikeId === bike.id ? refused.problems : []}
          dismissPhotoProblems={() => setRefused(null)}
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
          setRefused(null);
          run(async () => {
            // A refused file is told about beside the button, not in the
            // page's general error line far above it (#366).
            const sent = await sendBikePhoto(bike!.id, image);
            if (!sent.ok) {
              setRefused({ bikeId: bike!.id, problems: [sent.problem] });
              return;
            }
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
