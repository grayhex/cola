"use client";
import type {
  FeedDto,
  JournalFeedDto,
  SavedPageDto,
  NotificationPageDto,
  MarketListDto,
  MarketNoticeDto,
  NotificationDto,
} from "./content-types.ts";
type CommunityData =
  | (FeedDto & { view: "feed" })
  | (JournalFeedDto & { view: "journal"; entries: JournalFeedDto["items"] })
  | (SavedPageDto & { view: "saved" })
  | (NotificationPageDto & { view: "notifications" })
  | (MarketListDto & { view: "market" });
function isMarketNotice(n: NotificationDto): n is MarketNoticeDto {
  return n.type === "market_expiring";
}
import { errorMessage } from "../../lib/errors.ts";
import Link from "next/link";
import { MarketCard } from "./market.tsx";
import RideCard from "./ride-card.tsx";
import JournalCard from "./journal-card.tsx";
import { MotionList } from "./motion.tsx";
import {
  MessagesSquare,
  MonitorSmartphone,
  Trophy,
  Users,
  NotebookPen,
  ShoppingBag,
  RefreshCw,
} from "./icons.tsx";
import LocalDate from "./local-date.tsx";
import NotificationItem, { type ReadControl } from "./notification-item.tsx";
import { daysLabel } from "../../lib/market-types.ts";
import BikeGrid from "./bike-grid.tsx";
import {
  startTransition,
  useCallback,
  useEffect,
  useState,
  useRef,
} from "react";
import {
  SocialHeader,
  SocialFooter,
  Avatar,
  Pagination,
  socialApi,
} from "./social-primitives.tsx";
import { PageControls } from "./community-controls.tsx";
import BikeCard from "./bike-card.tsx";
import { useSite } from "./site-provider.tsx";
import { profilePath } from "../../lib/public-urls.ts";
import { personName } from "../../lib/usernames.ts";
import {
  notificationCategories,
  notificationCategoryKeys,
} from "../../lib/notification-catalog.ts";
const eventText: Record<string, string> = {
  plan_published: "запланировал покатушку",
  plan_nearby: "запланировал покатушку в выбранном вами районе —",
  intent_published: "ищет компанию для покатушки —",
  component_reply: "ответил вам в обсуждении компонента",
  article_like: "понравилась ваша статья",
  article_comment: "прокомментировал статью",
  article_reply: "ответил вам в статье",
  journal_like: "понравилась ваша запись",
  journal_comment: "прокомментировал запись",
  journal_reply: "ответил вам в журнале",
  ride_invite: "приглашает на покатушку",
  ride_changed: "изменил договорённости покатушки",
  ride_cancelled: "отменил покатушку",
  ride_response: "участники обновили ответы на покатушку",
  ride_reminder: "напоминание о подтверждённой покатушке",
  ride_like: "понравилась ваша покатушка",
  ride_comment: "прокомментировал покатушку",
  ride_reply: "ответил вам",
  follow: "подписался на вас",
  like: "понравился ваш велосипед",
  comment: "прокомментировал",
  reply: "ответил вам",
};
// The site's notice about a listing's term (#116). The text follows the
// listing as it is now: extended, sold or still ending.
function MarketNotice({
  notice: n,
  days,
  busy,
  onExtend,
  read,
}: {
  notice: MarketNoticeDto;
  days: number;
  busy: boolean;
  onExtend: () => void;
  read: ReadControl;
}) {
  const listing = (
    <a href={n.target.href} onClick={() => !n.readAt && read.onRead()}>
      {n.target.name}
    </a>
  );
  const until = (
    <LocalDate
      value={n.target.expiresAt}
      options={{ day: "numeric", month: "long" }}
    />
  );
  return (
    <NotificationItem
      notice={n}
      read={read}
      lead={
        <span className="notification-icon" aria-hidden="true">
          <ShoppingBag size={18} />
        </span>
      }
      action={
        ["expiring", "expired"].includes(n.target.state) && (
          <button
            type="button"
            className="button small"
            disabled={busy}
            onClick={onExtend}
          >
            <RefreshCw size={14} aria-hidden="true" />
            Продлить на {daysLabel(days)}
          </button>
        )
      }
    >
      {n.target.state === "expiring" ? (
        <>
          Объявление {listing} снимется с публикации {until}. Продлите его, если
          оно ещё актуально.
        </>
      ) : n.target.state === "expired" ? (
        <>Срок объявления {listing} истёк: его нет в поиске и ленте.</>
      ) : n.target.state === "extended" ? (
        <>
          Объявление {listing} продлено до {until}.
        </>
      ) : (
        <>Объявление {listing} снято с публикации.</>
      )}
    </NotificationItem>
  );
}
export default function CommunityPage({
  kind,
}: {
  kind: "saved" | "journal" | "feed" | "notifications";
}) {
  const [mode, setMode] = useState("new");
  useEffect(
    () =>
      setMode(
        new URLSearchParams(location.search).get("mode") === "following"
          ? "following"
          : "new",
      ),
    [],
  );
  const [feedType, setFeedType] = useState<string | null>(null);
  useEffect(
    () =>
      setFeedType(
        new URLSearchParams(location.search).get("type") === "rides"
          ? "rides"
          : "all",
      ),
    [],
  );
  // /saved → «Записи» or «Объявления» (#116).
  const [savedType, setSavedType] = useState<"journal" | "market" | null>(null);
  useEffect(
    () =>
      setSavedType(
        new URLSearchParams(location.search).get("type") === "market"
          ? "market"
          : "journal",
      ),
    [],
  );
  // The filters of the list of notifications (#341): the unread, one category.
  const [unreadOnly, setUnreadOnly] = useState(false),
    [category, setCategory] = useState("");
  const [data, setData] = useState<CommunityData | null>(null),
    [page, setPage] = useState(1),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const { viewer: user, settings } = useSite();
  const userId = user?.id;
  const requestRevision = useRef({ revision: 0 });
  const refresh = useCallback(async () => {
    const revision = ++requestRevision.current.revision;
    try {
      const path =
        kind === "saved" && savedType === "market"
          ? "market/saved?page=" + page
          : "community/" +
            (kind === "journal" ? "feed" : kind) +
            "?page=" +
            page +
            (kind === "journal"
              ? "&type=journal&mode=" + mode
              : kind === "notifications"
                ? (unreadOnly ? "&unread=1" : "") +
                  (category ? "&category=" + category : "")
                : feedType === "rides"
                  ? "&type=rides"
                  : "");
      let d: CommunityData;
      if (kind === "notifications")
        d = {
          ...(await socialApi<NotificationPageDto>(path)),
          view: "notifications",
        };
      else if (kind === "feed")
        d = { ...(await socialApi<FeedDto>(path)), view: "feed" };
      else if (kind === "journal") {
        const result = await socialApi<JournalFeedDto>(path);
        d = { ...result, entries: result.items, view: "journal" };
      } else if (savedType === "market")
        d = { ...(await socialApi<MarketListDto>(path)), view: "market" };
      else d = { ...(await socialApi<SavedPageDto>(path)), view: "saved" };
      if (revision !== requestRevision.current.revision) return;
      if (kind === "notifications") setData(d);
      else startTransition(() => setData(d));
      setError("");
      if (kind === "notifications")
        window.dispatchEvent(new Event("cola:notifications"));
    } catch (e) {
      if (revision === requestRevision.current.revision)
        setError(errorMessage(e));
    }
  }, [kind, savedType, page, mode, feedType, unreadOnly, category]);
  useEffect(() => {
    const pending = requestRevision.current;
    if (
      (userId || (kind === "journal" && mode === "new")) &&
      feedType !== null &&
      savedType !== null
    )
      refresh().catch((e) => setError(e.message));
    return () => {
      pending.revision++;
    };
  }, [userId, kind, feedType, mode, savedType, refresh]);
  useEffect(() => {
    if (!userId || kind !== "notifications") return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        refresh().catch((e) => setError(e.message));
    }, 30000);
    return () => clearInterval(timer);
  }, [userId, kind, refresh]);
  // «Отметить прочитанным» of one notice (#378): the same request for every
  // kind, its own state and error per notice, never twice at once. The list is
  // asked again with the filters of the moment, so a notice that came while the
  // request was out is not lost and the page and the filter stay.
  const [reading, setReading] = useState<string[]>([]),
    [readFailed, setReadFailed] = useState<Record<string, string>>({});
  const readingNow = useRef(new Set<string>());
  const refreshNow = useRef(refresh);
  refreshNow.current = refresh;
  const read = useCallback(async (id: string) => {
    if (readingNow.current.has(id)) return;
    readingNow.current.add(id);
    setReading([...readingNow.current]);
    setReadFailed((failed) =>
      Object.fromEntries(Object.entries(failed).filter(([key]) => key !== id)),
    );
    try {
      await socialApi("community/notifications/" + id + "/read", "PATCH");
      await refreshNow.current();
    } catch (e) {
      setReadFailed((failed) => ({ ...failed, [id]: errorMessage(e) }));
    } finally {
      readingNow.current.delete(id);
      setReading([...readingNow.current]);
    }
  }, []);
  const readOf = (id: string): ReadControl => ({
    pending: reading.includes(id),
    error: readFailed[id] || "",
    onRead: () => void read(id),
  });
  // «Продлить» right in the notice: one click, a new full term (#116).
  async function extend(n: MarketNoticeDto) {
    setBusy(true);
    setError("");
    try {
      await socialApi("market/" + n.target.id + "/extend", "POST");
      if (!n.readAt)
        await socialApi("community/notifications/" + n.id + "/read", "PATCH");
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <SocialHeader user={user} />
      <main className="page community-page">
        <div className="section-heading">
          <h1>
            {kind === "journal"
              ? "Журнал"
              : kind === "saved"
                ? "Сохранённое"
                : kind === "feed"
                  ? feedType === "rides"
                    ? "Покатушки подписок"
                    : "Подписки"
                  : "Уведомления"}
          </h1>
          {data?.view === "notifications" && !!data.unread && (
            <button
              className="quiet"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  // The mark of the list on the screen: a notice that arrived
                  // after it stays unread until it is shown (#341).
                  await socialApi(
                    "community/notifications/read-all",
                    "PATCH",
                    data.watermark ? { watermark: data.watermark } : {},
                  );
                  await refresh();
                } catch (e) {
                  setError(errorMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Прочитать все
            </button>
          )}
        </div>
        {kind === "notifications" && user && (
          <div className="notification-filters">
            <div
              className="ui-tabs"
              role="group"
              aria-label="Какие уведомления"
            >
              {(
                [
                  [false, "Все"],
                  [true, "Непрочитанные"],
                ] as const
              ).map(([only, label]) => (
                <button
                  key={label}
                  aria-pressed={unreadOnly === only}
                  onClick={() => {
                    if (unreadOnly === only) return;
                    setUnreadOnly(only);
                    setPage(1);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="field notification-category">
              <span className="sr-only">Категория уведомлений</span>
              <select
                aria-label="Категория уведомлений"
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Все категории</option>
                {notificationCategoryKeys.map((key) => (
                  <option key={key} value={key}>
                    {notificationCategories[key].label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {kind === "saved" && user && (
          <nav className="ui-tabs" aria-label="Что сохранено">
            {(
              [
                ["journal", "Записи", NotebookPen],
                ["market", "Объявления", ShoppingBag],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                className="quiet"
                aria-pressed={savedType === id}
                onClick={() => {
                  if (savedType === id) return;
                  setSavedType(id);
                  setPage(1);
                  setData(null);
                  setError("");
                  history.replaceState(
                    null,
                    "",
                    id === "market" ? "/saved?type=market" : "/saved",
                  );
                }}
              >
                <Icon size={17} aria-hidden="true" />
                {label}
              </button>
            ))}
          </nav>
        )}
        {kind === "journal" && (
          <nav className="journal-modes ui-tabs" aria-label="Режим журнала">
            {[
              ["new", "Новые"],
              ["following", "Подписки"],
            ].map(([id, label]) => (
              <button
                key={id}
                className="quiet"
                aria-pressed={mode === id}
                onClick={() => {
                  setMode(id);
                  setPage(1);
                  setData(null);
                  setError("");
                  history.replaceState(
                    null,
                    "",
                    id === "new" ? "/journal" : "/journal?mode=following",
                  );
                }}
              >
                {id === "new" ? (
                  <MessagesSquare size={17} aria-hidden="true" />
                ) : (
                  <Users size={17} aria-hidden="true" />
                )}
                {label}
              </button>
            ))}
          </nav>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {user === null && !(kind === "journal" && mode === "new") ? (
          <p>
            Войдите, чтобы увидеть{" "}
            {kind === "feed" || kind === "journal"
              ? "публикации ваших подписок"
              : kind === "saved"
                ? "сохранённые записи и объявления"
                : "уведомления"}
            .{" "}
            <Link className="button small" href="/account">
              Войти
            </Link>
          </p>
        ) : !data ? (
          <p role="status">Загружаем…</p>
        ) : data.view === "market" ? (
          <>
            <BikeGrid>
              {data.items.map((m) => (
                <MarketCard key={m.id} listing={m} />
              ))}
            </BikeGrid>
            {!data.items.length && (
              <section className="social-empty">
                <h2>Сохранённых объявлений нет</h2>
                <p>
                  Сохраняйте объявления кнопкой «Сохранить». Проданные, снятые и
                  истёкшие здесь не показываются.
                </p>
                <Link href="/market">Открыть рынок</Link>
              </section>
            )}
            <Pagination {...data} onPage={setPage} />
          </>
        ) : data.view === "journal" || data.view === "saved" ? (
          <>
            <MotionList>
              <div className="journal-feed">
                {data.entries.map((e) => (
                  <JournalCard
                    key={e.id}
                    entry={e}
                    onSaved={() => {
                      if (kind === "saved")
                        refresh().catch((e) => setError(e.message));
                    }}
                  />
                ))}
              </div>
            </MotionList>
            {!data.entries.length && (
              <section className="social-empty">
                <h2>
                  {kind === "saved"
                    ? "Пока ничего не сохранено"
                    : "Здесь пока нет историй"}
                </h2>
                <p>
                  {kind === "saved"
                    ? "Сохраняйте полезные записи, чтобы вернуться к ним."
                    : mode === "following"
                      ? "Подпишитесь на интересного автора или велосипед — свой велосипед для этого не нужен."
                      : "Истории владельцев появятся после публикации."}
                </p>
                <a href={kind === "saved" ? "/journal" : "/"}>
                  {kind === "saved"
                    ? "Открыть журнал"
                    : "Посмотреть велосипеды"}
                </a>
              </section>
            )}
            <Pagination {...data} onPage={setPage} />
          </>
        ) : data.view === "feed" ? (
          <>
            <p className="help">
              Новые публикации владельцев, на которых вы подписаны.
            </p>
            <BikeGrid>
              {data.items.map((b) =>
                b.kind === "journal" ? (
                  <JournalCard key={b.id} entry={b} />
                ) : b.kind === "market" ? (
                  <MarketCard key={b.id} listing={b} />
                ) : b.kind === "ride" ? (
                  <RideCard key={b.id} ride={b} />
                ) : (
                  <BikeCard key={b.id} bike={b} user={user} />
                ),
              )}
            </BikeGrid>
            {!data.items.length && (
              <section className="social-empty">
                <h2>Публикации знакомых появятся здесь</h2>
                <p>
                  Найдите интересных владельцев на общей витрине и подпишитесь
                  на них.
                </p>
                <Link className="button" href="/">
                  Открыть витрину
                </Link>
              </section>
            )}
            <Pagination {...data} onPage={setPage} />
          </>
        ) : (
          <>
            <ul className="notification-list">
              {data.notifications.map((n) =>
                isMarketNotice(n) ? (
                  <MarketNotice
                    key={n.id}
                    notice={n}
                    days={settings?.marketListingDays || 60}
                    busy={busy}
                    onExtend={() => extend(n)}
                    read={readOf(n.id)}
                  />
                ) : n.type === "session_reuse" ? (
                  <NotificationItem
                    key={n.id}
                    notice={n}
                    read={readOf(n.id)}
                    lead={
                      <span className="notification-icon" aria-hidden="true">
                        <MonitorSmartphone size={18} />
                      </span>
                    }
                    action={
                      <Link
                        href={n.target.href}
                        onClick={() => void read(n.id)}
                      >
                        Проверить устройства
                      </Link>
                    }
                  >
                    Токен устройства использовали повторно, сессия завершена.
                    Если это были не вы, смените пароль.
                  </NotificationItem>
                ) : n.type === "bike_week" ? (
                  <NotificationItem
                    key={n.id}
                    notice={n}
                    read={readOf(n.id)}
                    lead={
                      <span className="notification-icon" aria-hidden="true">
                        <Trophy size={18} />
                      </span>
                    }
                    action={
                      <Link
                        href={n.target.href}
                        onClick={() => void read(n.id)}
                      >
                        Подготовить материал для главной
                      </Link>
                    }
                  >
                    Ваш велосипед — велосипед недели: {n.target.name}
                  </NotificationItem>
                ) : (
                  <NotificationItem
                    key={n.id}
                    notice={n}
                    read={readOf(n.id)}
                    lead={
                      n.actor && (
                        <a
                          href={profilePath(n.actor.username)}
                          aria-label={"Профиль: " + personName(n.actor)}
                        >
                          <Avatar person={n.actor} />
                        </a>
                      )
                    }
                  >
                    {n.actor ? (
                      <a
                        className="notification-actor"
                        href={profilePath(n.actor.username)}
                      >
                        {personName(n.actor)}
                      </a>
                    ) : (
                      <span className="notification-actor">ColaBike ·</span>
                    )}
                    {" " + eventText[n.type] + " "}
                    {n.type !== "follow" && (
                      <a href={n.target.href} onClick={() => void read(n.id)}>
                        {n.type === "reply"
                          ? "в обсуждении " + n.target.name
                          : n.type === "intent_published"
                            ? "открыть «Хочу кататься»"
                            : n.target.name}
                      </a>
                    )}
                  </NotificationItem>
                ),
              )}
            </ul>
            {!data.notifications.length && (
              <p className="help">
                {unreadOnly || category
                  ? "По этому фильтру уведомлений нет."
                  : "Здесь появятся реакции на ваши велосипеды, ответы, новые подписчики и планы друзей."}
              </p>
            )}
            <PageControls {...data} onPage={setPage} />
          </>
        )}
      </main>
      <SocialFooter />
    </>
  );
}
