"use client";
import type {
  Channel as StreamChannel,
  StreamChat,
  ChannelSort,
} from "stream-chat";
import type {
  ChannelListItemUIProps,
  ChannelListUIProps,
  ComponentContextValue,
} from "stream-chat-react";
import type { PropsWithChildren } from "react";
import type { RideDto } from "../ui/content-types.ts";
interface MessengerActions {
  newChat: () => void;
  retryList: () => void;
  back: () => void;
}
import { errorMessage } from "../../lib/errors.ts";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Channel,
  ChannelList,
  ChannelListItem,
  ComponentProvider,
  MessageComposer,
  MessageList,
  Thread,
  Window,
  useChatContext,
  useChannelStateContext,
} from "stream-chat-react";
import { Avatar } from "../ui/avatar.tsx";
import { CompactDialog, CompactIconButton } from "../ui/compact-ui.tsx";
import {
  ArrowLeft,
  CheckCheck,
  Download,
  Info,
  MessagesSquare,
  Plus,
  Users,
} from "../ui/icons.tsx";
import { chatApi } from "./chat-api.ts";
import NewConversation from "./new-conversation.tsx";
import { Images, plainText } from "./chat-content.tsx";
import { socialApi } from "../ui/social-primitives.tsx";
import { publicPath } from "../../lib/public-urls.ts";
import { rideTimeLabel } from "../../lib/ride-announcement.ts";
import { streamUserId } from "../../lib/chat-config.ts";

/** The draft of a question about a ride: title, agreed time and the public
 * address — no meeting place, people or answers. */
function rideContext(ride: RideDto) {
  const when =
    ride.status === "planned" && ride.scheduledAt
      ? " (" + rideTimeLabel(ride.scheduledAt, ride.recurrenceTimezone) + ")"
      : "";
  return `Вопрос о покатушке «${ride.title}»${when}: ${new URL(publicPath("ride", ride), location.origin).href}\n`;
}

const MessengerContext = createContext<MessengerActions | null>(null);
declare module "stream-chat" {
  interface CustomChannelData {
    name?: string;
  }
}
const actions = ["edit", "delete", "flag", "react", "reply", "quote"];
function participants(channel: StreamChannel, me: string | undefined) {
  return Object.values(channel.state.members)
    .filter((m) => m.user_id !== me)
    .map((m) => m.user)
    .filter((person): person is NonNullable<typeof person> => !!person);
}
function titleFor(channel: StreamChannel, me: string | undefined) {
  return (
    channel.data?.name ||
    participants(channel, me)
      .map((p) => p.name || "Велосипедист")
      .join(", ") ||
    "Диалог"
  );
}
function ChannelAvatar({
  channel,
  me,
}: {
  channel: StreamChannel;
  me?: string;
}) {
  return channel.id?.startsWith("group_") ? (
    <span className="chat-group-avatar" aria-hidden="true">
      <Users size={22} />
    </span>
  ) : (
    <Avatar
      person={{
        ...participants(channel, me)[0],
        avatar: participants(channel, me)[0]?.image,
      }}
    />
  );
}
function ConversationRow({
  channel,
  active,
  unread,
  lastMessage,
  onSelect,
  messageDeliveryStatus,
}: ChannelListItemUIProps) {
  const { client } = useChatContext();
  const title = titleFor(channel, client.userID);
  const date = lastMessage?.created_at
    ? new Date(lastMessage.created_at)
    : null;
  const today = date && date.toDateString() === new Date().toDateString();
  const time =
    date && Number.isFinite(date.getTime())
      ? date.toLocaleString(
          "ru-RU",
          today
            ? { hour: "2-digit", minute: "2-digit" }
            : { day: "numeric", month: "short" },
        )
      : "";
  const preview = !lastMessage
    ? "Начните переписку"
    : lastMessage.deleted_at
      ? "Сообщение удалено"
      : lastMessage.text ||
        (lastMessage.attachments?.length ? "Изображение" : "Сообщение");
  const own = lastMessage?.user?.id === client.userID;
  return (
    <button
      type="button"
      className="chat-channel"
      aria-pressed={active}
      onClick={onSelect}
    >
      <ChannelAvatar channel={channel} me={client.userID} />
      <span className="chat-channel-copy">
        <span className="chat-channel-top">
          <strong>{title}</strong>
          {time && <time dateTime={date!.toISOString()}>{time}</time>}
        </span>
        <span className="chat-channel-bottom">
          <span className="chat-preview">
            {own && "Вы: "}
            {preview}
          </span>
          {own && messageDeliveryStatus === "read" && (
            <CheckCheck size={15} aria-label="Прочитано" />
          )}
          {(unread ?? 0) > 0 && (
            <span
              className="chat-unread"
              aria-label={`${unread} непрочитанных`}
            >
              {(unread ?? 0) > 99 ? "99+" : unread}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}
function EmptyConversations() {
  const { newChat } = useContext(MessengerContext)!;
  return (
    <div className="chat-state">
      <MessagesSquare size={30} aria-hidden="true" />
      <h3>Пока нет диалогов</h3>
      <p>Найдите знакомого велосипедиста и напишите первым.</p>
      <button className="button secondary" onClick={newChat}>
        Найти собеседника
      </button>
    </div>
  );
}
function ConversationList({
  error,
  loading,
  children,
}: PropsWithChildren<ChannelListUIProps>) {
  const { retryList } = useContext(MessengerContext)!;
  if (error)
    return (
      <div className="chat-state" role="alert">
        <p>Не удалось загрузить диалоги.</p>
        <button className="button secondary" onClick={retryList}>
          Повторить загрузку
        </button>
      </div>
    );
  if (loading)
    return (
      <div className="chat-state" role="status">
        Загружаем диалоги…
      </div>
    );
  return <div className="chat-channel-items">{children}</div>;
}
const components: Partial<ComponentContextValue> = {
  // Stream v14 accepts renderer overrides through ComponentProvider, not Channel.
  Attachment: Images,
  ChannelListHeader: () => null,
  ChannelListUI: ConversationList,
  ChannelListItemUI: ConversationRow,
};
function ConversationHeader() {
  const { channel, members } = useChannelStateContext();
  const { client } = useChatContext();
  const { back } = useContext(MessengerContext)!;
  const [details, setDetails] = useState(false);
  const title = titleFor(channel, client.userID);
  const users = Object.values(members || channel.state.members)
    .map((m) => m.user)
    .filter((person): person is NonNullable<typeof person> => !!person);
  const group = channel.id?.startsWith("group_");
  const other = users.find((u) => u.id !== client.userID);
  return (
    <>
      <header className="chat-conversation-header">
        <CompactIconButton
          className="chat-back"
          label="К списку диалогов"
          onClick={back}
        >
          <ArrowLeft size={20} />
        </CompactIconButton>
        <ChannelAvatar channel={channel} me={client.userID} />
        <div className="chat-header-copy">
          <h2>{title}</h2>
          <p>
            {group
              ? `Участников: ${users.length}`
              : other?.deactivated_at || other?.banned
                ? "Пользователь недоступен"
                : other?.online
                  ? "В сети"
                  : "Личный диалог"}
          </p>
        </div>
        <CompactIconButton
          label="Участники и информация"
          onClick={() => setDetails(true)}
        >
          <Info size={20} />
        </CompactIconButton>
      </header>
      <CompactDialog
        open={details}
        onClose={() => setDetails(false)}
        title={group ? "Участники группы" : "О диалоге"}
        className="chat-details"
      >
        <h3>{title}</h3>
        <ul className="chat-people-list">
          {users.map((p) => (
            <li className="chat-person" key={p.id}>
              <Avatar person={{ ...p, avatar: p.image }} />
              <span className="chat-person-copy">
                <strong>
                  {p.name || "Велосипедист"}
                  {p.id === client.userID ? " (вы)" : ""}
                </strong>
                <span>
                  {p.deactivated_at || p.banned
                    ? "Недоступен"
                    : p.online
                      ? "В сети"
                      : "Участник"}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <p className="chat-hint">
          Изображения JPG, PNG и WebP до 5 МБ. Пожаловаться можно в меню
          сообщения.
        </p>
      </CompactDialog>
    </>
  );
}
export default function Conversations({ client }: { client: StreamChat }) {
  const { channel, setActiveChannel } = useChatContext();
  const params = useSearchParams();
  const router = useRouter();
  const target = params.get("to");
  const cid = params.get("channel");
  // «Спросить организатора» (#235): a ride the viewer can open, as context.
  const rideShare = /^[0-9a-f-]{36}$/i.test(params.get("ride") || "")
    ? params.get("ride")
    : null;
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const newButton = useRef<HTMLButtonElement>(null);
  const wasConversation = useRef(false);
  const filters = useMemo(
    () => ({ type: "colabike", members: { $in: [client.userID!] } }),
    [client],
  );
  const sort = useMemo<ChannelSort>(() => ({ last_message_at: -1 }), []);
  const options = useMemo(() => ({ limit: 20, state: true, watch: true }), []);
  useEffect(() => {
    let active = true;
    setError("");
    if (!target && !cid) {
      setBusy(false);
      setActiveChannel(undefined);
      if (wasConversation.current) newButton.current?.focus();
      wasConversation.current = false;
      return;
    }
    wasConversation.current = true;
    setBusy(true);
    (async () => {
      const nextCid = target
        ? (
            await chatApi<{ cid: string }>("channels", {
              kind: "dm",
              members: [target],
            })
          ).cid
        : cid;
      if (!/^colabike:(dm_[a-f0-9]{40}|group_[a-f0-9]{32})$/.test(nextCid!))
        throw new Error("Диалог недоступен");
      const next = client.channel("colabike", nextCid!.split(":")[1]);
      await next.watch();
      if (!next.state.members[client.userID!])
        throw new Error("Диалог недоступен");
      if (!active) return;
      setActiveChannel(next);
      if (target) {
        setRevision((n) => n + 1);
        router.replace(
          "/messages?channel=" +
            encodeURIComponent(nextCid!) +
            (rideShare ? "&ride=" + rideShare : ""),
          { scroll: false },
        );
      }
    })()
      .catch(() => {
        if (active) {
          setActiveChannel(undefined);
          setError(
            "Не удалось открыть диалог. Собеседник может быть недоступен.",
          );
        }
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
    // rideShare only travels with `to`; it does not reopen the channel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, cid, client, setActiveChannel, router, attempt]);
  // The ride is read again with this viewer's access; only its title, date
  // and public address go into the draft, and only for its own organizer.
  // Nothing is sent without the person pressing «Отправить».
  useEffect(() => {
    if (!rideShare || !cid || !channel || channel.cid !== cid || target) return;
    let active = true;
    socialApi<{ ride: RideDto }>("rides/public/" + rideShare)
      .then(({ ride }) => {
        if (!active) return;
        const organizer = ride.author?.id && streamUserId(ride.author.id);
        const composer = channel.messageComposer?.textComposer;
        if (
          organizer &&
          organizer !== client.userID &&
          channel.state.members[organizer] &&
          composer &&
          !composer.text.trim()
        )
          composer.setText(rideContext(ride));
      })
      .catch(() => {})
      .finally(() => {
        if (active)
          router.replace("/messages?channel=" + encodeURIComponent(cid), {
            scroll: false,
          });
      });
    return () => {
      active = false;
    };
  }, [rideShare, cid, channel, target, client, router]);
  const select = (nextCid: string) =>
    router.push("/messages?channel=" + encodeURIComponent(nextCid), {
      scroll: false,
    });
  const back = () => {
    router.push("/messages", { scroll: false });
  };
  async function exportMessages() {
    setExportError("");
    setExporting(true);
    try {
      const data = await chatApi("export", {});
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "colabike-chat.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setExportError(errorMessage(e));
    } finally {
      setExporting(false);
    }
  }
  return (
    <MessengerContext.Provider
      value={{
        newChat: () => setCreating(true),
        retryList: () => setRevision((n) => n + 1),
        back,
      }}
    >
      <ComponentProvider value={components}>
        {error && (
          <div className="chat-error" role="alert">
            <span>{error}</span>
            <button
              className="button secondary"
              onClick={() => setAttempt((n) => n + 1)}
            >
              Повторить
            </button>
            <button
              className="button secondary"
              onClick={() => {
                setError("");
                back();
              }}
            >
              К диалогам
            </button>
          </div>
        )}
        <div className="chat-panels" data-conversation={!!(cid || target)}>
          <aside className="chat-channels" aria-label="Диалоги">
            <div className="chat-list-heading">
              <div>
                <h2>Диалоги</h2>
                <p>Личные сообщения и группы</p>
              </div>
              <button
                ref={newButton}
                className="icon"
                title="Новое сообщение"
                aria-label="Новое сообщение"
                aria-haspopup="dialog"
                onClick={() => setCreating(true)}
              >
                <Plus size={20} />
              </button>
            </div>
            <div className="chat-list-scroll">
              <ChannelList
                key={revision}
                filters={filters}
                sort={sort}
                options={options}
                setActiveChannelOnMount={false}
                EmptyStateIndicator={EmptyConversations}
                channelRenderFilterFn={(list) =>
                  list.filter(
                    (c) =>
                      c.type === "colabike" && c.state.members[client.userID!],
                  )
                }
                renderChannels={(list) =>
                  list.map((c) => (
                    <ChannelListItem
                      key={c.cid}
                      channel={c}
                      onSelect={() => select(c.cid)}
                    />
                  ))
                }
              />
            </div>
            <button
              className="chat-export"
              disabled={exporting}
              onClick={exportMessages}
            >
              <Download size={16} />
              {exporting ? "Готовим файл…" : "Скачать мои сообщения"}
            </button>
            {exportError && (
              <p role="alert" className="chat-error">
                {exportError}
              </p>
            )}
          </aside>
          <section
            className="chat-conversation"
            aria-label="Переписка"
            aria-busy={busy}
          >
            {busy ? (
              <div className="chat-state" role="status">
                Открываем диалог…
              </div>
            ) : channel ? (
              <Channel key={channel.cid}>
                <Window>
                  <ConversationHeader />
                  <MessageList
                    messageActions={actions}
                    renderText={plainText}
                  />
                  <MessageComposer
                    audioRecordingEnabled={false}
                    preventClearingOnUnmount
                    maxRows={6}
                    additionalTextareaProps={{
                      placeholder: "Написать сообщение…",
                    }}
                  />
                </Window>
                <Thread
                  messageActions={actions}
                  additionalMessageListProps={{ renderText: plainText }}
                  additionalParentMessageProps={{ renderText: plainText }}
                  additionalMessageComposerProps={{
                    audioRecordingEnabled: false,
                    preventClearingOnUnmount: true,
                    additionalTextareaProps: {
                      placeholder: "Ответить в ветке…",
                    },
                  }}
                />
              </Channel>
            ) : (
              <div className="chat-welcome">
                <span className="chat-welcome-icon">
                  <MessagesSquare size={36} />
                </span>
                <h2>Хорошая поездка начинается с разговора</h2>
                <p>
                  Обсудите маршрут, спросите о велосипеде или соберите друзей на
                  покатушку.
                </p>
                <button className="button" onClick={() => setCreating(true)}>
                  <Plus size={17} />
                  Новое сообщение
                </button>
              </div>
            )}
          </section>
        </div>
        {creating && (
          <NewConversation
            onClose={() => {
              setCreating(false);
              newButton.current?.focus();
            }}
            onCreated={(nextCid: string) => {
              setCreating(false);
              setRevision((n) => n + 1);
              select(nextCid);
            }}
          />
        )}
      </ComponentProvider>
    </MessengerContext.Provider>
  );
}
