"use client";
import type { issueChatToken } from "../../lib/chat.ts";
type ChatTokenDto = Awaited<ReturnType<typeof issueChatToken>>;
import { useEffect, useMemo, useState } from "react";
import { StreamChat, type LocalUploadAttachment } from "stream-chat";
import { Chat, Streami18n } from "stream-chat-react";
import "stream-chat-react/dist/css/index.css";
import "./chat.css";
import { useSite } from "../ui/site-provider.tsx";
import { CHAT_FILE_BYTES } from "../../lib/chat-config.ts";
import { chatApi as api } from "./chat-api.ts";
import Conversations from "./conversations.tsx";
export default function StreamMessages() {
  const { resolvedTheme } = useSite();
  const [client, setClient] = useState<StreamChat | null>(null),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0),
    [offline, setOffline] = useState(false);
  const i18n = useMemo(
    () => new Streami18n({ language: "ru", logger: () => {} }),
    [],
  );
  useEffect(() => {
    let active = true,
      sdk: StreamChat | undefined,
      subscription: { unsubscribe: () => void } | undefined;
    setError("");
    setClient(null);
    setOffline(false);
    const connected = api<ChatTokenDto>("token", {})
      .then(async (data) => {
        if (!active) return;
        if (!data.apiKey) throw new Error("Чат недоступен");
        sdk = new StreamChat(data.apiKey, { logger: () => {}, timeout: 10000 });
        sdk.setMessageComposerSetupFunction(({ composer }) =>
          composer.updateConfig({
            attachments: {
              acceptedFiles: ["image/jpeg", "image/png", "image/webp"],
              maxNumberOfFilesPerMessage: 4,
              fileUploadFilter: (file: Partial<LocalUploadAttachment>) =>
                ["image/jpeg", "image/png", "image/webp"].includes(
                  file.mime_type || "",
                ) &&
                file.file_size !== undefined &&
                Number(file.file_size) <= CHAT_FILE_BYTES,
            },
            linkPreviews: { enabled: false },
            location: { enabled: false },
          }),
        );
        let first: string | null = data.token;
        await sdk.connectUser(data.user, async () => {
          if (first) {
            const token = first;
            first = null;
            return token;
          }
          const next = await api<ChatTokenDto>("token", {});
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
        <Conversations client={client} />
      </Chat>
    </div>
  );
}
