"use client";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { StreamChat } from "stream-chat";
import {
  Chat,
  Channel,
  ChannelHeader,
  ChannelList,
  MessageComposer,
  MessageList,
  Streami18n,
  Thread,
  Window,
  useChatContext,
} from "stream-chat-react";
import "stream-chat-react/dist/css/index.css";
import "./chat.css";
import { useSite } from "../ui/site-provider.jsx";
import SmallImage from "../ui/small-image.jsx";
import { CHAT_FILE_BYTES } from "../../lib/chat-config.js";

async function api(action, data) {
  const response = await fetch("/api/chat/" + action, {
    method: data === undefined ? "GET" : "POST",
    cache: "no-store",
    headers: data === undefined ? {} : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Не удалось открыть сообщения");
  return result;
}
function safeImage(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" &&
      /^[a-z0-9-]+\.stream-io-cdn\.com$/.test(u.hostname)
      ? u.href
      : null;
  } catch {
    return null;
  }
}
// Render only vendor-hosted images. Untrusted attachments cannot embed arbitrary
// tracking pixels, documents, video players or HTML from a third-party domain.
function Images({ attachments = [] }) {
  return attachments.map((file, i) => {
    const url =
      file.type === "image" && safeImage(file.image_url || file.asset_url);
    return url ? (
      <a
        key={i}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Открыть изображение"
      >
        <SmallImage
          src={url}
          alt={file.title || "Изображение в сообщении"}
          className="chat-image"
        />
      </a>
    ) : (
      <span key={i}>Вложение недоступно</span>
    );
  });
}
function plainText(text = "") {
  return (
    <span className="chat-text">
      {text.split(/(https?:\/\/[^\s<>]+)/g).map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer nofollow"
          >
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </span>
  );
}
const actions = ["edit", "delete", "flag", "react", "reply", "quote"];
function Conversations({ client, target }) {
  const { channel, setActiveChannel } = useChatContext();
  const [showConversation, setShowConversation] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [people, setPeople] = useState([]),
    [selected, setSelected] = useState([]),
    [name, setName] = useState(""),
    [creating, setCreating] = useState(false);
  const filters = useMemo(
    () => ({ type: "colabike", members: { $in: [client.userID] } }),
    [client],
  );
  const sort = useMemo(() => ({ last_message_at: -1 }), []);
  const options = useMemo(() => ({ limit: 20, state: true, watch: true }), []);
  useEffect(() => {
    if (!target) return;
    let active = true;
    setBusy(true);
    api("channels", { kind: "dm", members: [target] })
      .then(async ({ cid }) => {
        const [type, id] = cid.split(":");
        const next = client.channel(type, id);
        await next.watch();
        if (active) {
          setActiveChannel(next);
          setShowConversation(true);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [target, client, setActiveChannel]);
  useEffect(() => {
    let active = true;
    if (query.trim().length < 2) {
      setPeople([]);
      return;
    }
    const timer = setTimeout(
      () =>
        api("people?q=" + encodeURIComponent(query.trim()))
          .then((d) => {
            if (active) setPeople(d.people);
          })
          .catch(() => {
            if (active) setError("Не удалось найти участников");
          }),
      300,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);
  async function create(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { cid } = await api("channels", {
        kind: selected.length === 1 ? "dm" : "group",
        members: selected.map((p) => p.id),
        ...(selected.length > 1 ? { name } : {}),
      });
      const [type, id] = cid.split(":");
      const next = client.channel(type, id);
      await next.watch();
      setActiveChannel(next);
      setShowConversation(true);
      setCreating(false);
      setSelected([]);
      setQuery("");
      setName("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function exportMessages() {
    setError("");
    setBusy(true);
    try {
      const data = await api("export", {}),
        url = URL.createObjectURL(
          new Blob([JSON.stringify(data, null, 2)], {
            type: "application/json",
          }),
        );
      const link = document.createElement("a");
      link.href = url;
      link.download = "colabike-chat.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="chat-toolbar">
        <button
          className="button secondary"
          onClick={() => {
            setCreating(!creating);
            setError("");
          }}
        >
          Новый диалог или группа
        </button>
        <button
          className="button secondary"
          disabled={busy}
          onClick={exportMessages}
        >
          Скачать мои сообщения
        </button>
      </div>
      <p className="muted">
        Личные диалоги и группы до 8 участников. Изображения JPG, PNG, WebP до 5
        МБ. Пожаловаться на сообщение можно в его меню.
      </p>
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">Подождите…</p>}
      {creating && (
        <form className="chat-create" onSubmit={create}>
          <label>
            Имя или username участника
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              maxLength={80}
            />
          </label>
          <ul aria-label="Найденные пользователи">
            {people
              .filter((p) => !selected.some((s) => s.id === p.id))
              .map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={selected.length >= 7}
                    onClick={() => {
                      setSelected([...selected, p]);
                      setQuery("");
                    }}
                  >
                    {p.name} {p.username ? "@" + p.username : ""}
                  </button>
                </li>
              ))}
          </ul>
          <ul aria-label="Выбранные участники">
            {selected.map((p) => (
              <li key={p.id}>
                {p.name}{" "}
                <button
                  type="button"
                  onClick={() =>
                    setSelected(selected.filter((s) => s.id !== p.id))
                  }
                  aria-label={"Убрать " + p.name}
                >
                  Убрать
                </button>
              </li>
            ))}
          </ul>
          {selected.length > 1 && (
            <label>
              Название группы
              <input
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          )}
          <button className="button" disabled={busy || !selected.length}>
            Начать переписку
          </button>
        </form>
      )}
      <div className="chat-panels" data-conversation={showConversation}>
        <aside className="chat-channels" aria-label="Диалоги">
          <ChannelList
            filters={filters}
            sort={sort}
            options={options}
            setActiveChannelOnMount={false}
            allowNewMessagesFromUnfilteredChannels={false}
            renderChannels={(channels) =>
              channels.map((c) => (
                <button
                  className="chat-channel"
                  aria-pressed={channel?.cid === c.cid}
                  key={c.cid}
                  onClick={() => {
                    setActiveChannel(c);
                    setShowConversation(true);
                  }}
                >
                  {c.data?.name ||
                    Object.values(c.state.members)
                      .filter((m) => m.user_id !== client.userID)
                      .map((m) => m.user?.name || "Велосипедист")
                      .join(", ") ||
                    "Диалог"}
                  {c.countUnread() > 0 && (
                    <span> · {c.countUnread()} новых</span>
                  )}
                </button>
              ))
            }
          />
        </aside>
        <section className="chat-conversation" aria-label="Переписка">
          <button
            className="button secondary chat-back"
            onClick={() => setShowConversation(false)}
          >
            К списку диалогов
          </button>
          {channel ? (
            <Channel Attachment={Images}>
              <Window>
                <ChannelHeader />
                <MessageList messageActions={actions} renderText={plainText} />
                <MessageComposer audioRecordingEnabled={false} />
              </Window>
              <Thread
                messageActions={actions}
                additionalMessageListProps={{ renderText: plainText }}
                additionalParentMessageProps={{ renderText: plainText }}
                additionalMessageComposerProps={{
                  audioRecordingEnabled: false,
                }}
              />
            </Channel>
          ) : (
            <p>Выберите диалог или начните новый.</p>
          )}
        </section>
      </div>
    </>
  );
}
export default function StreamMessages() {
  const { resolvedTheme } = useSite(),
    params = useSearchParams();
  const [client, setClient] = useState(null),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0),
    [offline, setOffline] = useState(false);
  const i18n = useMemo(
    () => new Streami18n({ language: "ru", logger: () => {} }),
    [],
  );
  useEffect(() => {
    let active = true,
      sdk,
      subscription;
    setError("");
    setClient(null);
    const connected = api("token", {})
      .then(async (data) => {
        if (!active) return;
        sdk = new StreamChat(data.apiKey, { logger: () => {}, timeout: 10000 });
        sdk.setMessageComposerSetupFunction(({ composer }) =>
          composer.updateConfig({
            attachments: {
              acceptedFiles: ["image/jpeg", "image/png", "image/webp"],
              maxNumberOfFilesPerMessage: 4,
              fileUploadFilter: (file) =>
                ["image/jpeg", "image/png", "image/webp"].includes(
                  file.mime_type,
                ) && file.file_size <= CHAT_FILE_BYTES,
            },
            linkPreviews: { enabled: false },
            location: { enabled: false },
          }),
        );
        let first = data.token;
        await sdk.connectUser(data.user, async () => {
          if (first) {
            const token = first;
            first = null;
            return token;
          }
          const next = await api("token", {});
          if (next.user.id !== data.user.id) throw new Error("Войдите заново");
          return next.token;
        });
        if (!active) return;
        subscription = sdk.on((event) => {
          if (event.type === "connection.changed") setOffline(!event.online);
          if (event.total_unread_count !== undefined)
            window.dispatchEvent(
              new CustomEvent("cola:chat-unread", {
                detail: event.total_unread_count,
              }),
            );
        });
        setClient(sdk);
      })
      .catch(() => {
        if (active)
          setError(
            "Не удалось подключить сообщения. Попробуйте ещё раз позже.",
          );
      });
    return () => {
      active = false;
      subscription?.unsubscribe();
      connected.finally(() => sdk?.disconnectUser()).catch(() => {});
    };
  }, [attempt]);
  if (error)
    return (
      <div role="alert">
        <p>{error}</p>
        <button
          className="button secondary"
          onClick={() => setAttempt(attempt + 1)}
        >
          Повторить
        </button>
      </div>
    );
  if (!client) return <p role="status">Подключаем сообщения…</p>;
  return (
    <div className="cola-chat">
      {offline && <p role="status">Связь прервалась. Переподключаемся…</p>}
      <Chat
        client={client}
        i18nInstance={i18n}
        theme={
          resolvedTheme === "dark"
            ? "str-chat__theme-dark"
            : "str-chat__theme-light"
        }
      >
        <Conversations client={client} target={params.get("to")} />
      </Chat>
    </div>
  );
}
