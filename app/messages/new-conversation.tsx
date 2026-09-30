"use client";
import { useEffect, useRef, useState } from "react";
import { CompactDialog } from "../ui/compact-ui.tsx";
import { Avatar } from "../ui/avatar.tsx";
import { Check, Search, Send, Users, X } from "../ui/icons.tsx";
import { chatApi } from "./chat-api.ts";

export default function NewConversation({ onClose, onCreated }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState({ query: null, people: [], error: "" });
  const [selected, setSelected] = useState([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const input = useRef(null);
  const active = useRef(true);
  const term = query.trim();
  const short = term && term.replace(/^@/, "").length < 2;
  const loading = !short && result.query !== term;
  useEffect(() => {
    input.current?.focus();
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (short) return;
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        chatApi(
          "people?q=" + encodeURIComponent(term),
          undefined,
          controller.signal,
        )
          .then((data) => {
            if (!controller.signal.aborted)
              setResult({ query: term, people: data.people, error: "" });
          })
          .catch((e) => {
            if (!controller.signal.aborted)
              setResult({ query: term, people: [], error: e.message });
          });
      },
      term ? 250 : 0,
    );
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [term, short, retry]);
  function toggle(person) {
    setError("");
    setSelected((current) =>
      current.some((p) => p.id === person.id)
        ? current.filter((p) => p.id !== person.id)
        : current.length < 7
          ? [...current, person]
          : current,
    );
  }
  async function create(event) {
    event.preventDefault();
    if (busy || !selected.length) return;
    setBusy(true);
    setError("");
    try {
      const { cid } = await chatApi("channels", {
        kind: selected.length === 1 ? "dm" : "group",
        members: selected.map((p) => p.id),
        ...(selected.length > 1 ? { name } : {}),
      });
      if (active.current) onCreated(cid);
    } catch (e) {
      if (active.current) setError(e.message);
    } finally {
      if (active.current) setBusy(false);
    }
  }
  return (
    <CompactDialog
      open
      onClose={onClose}
      title="Новое сообщение"
      className="chat-selector"
    >
      <form onSubmit={create} aria-busy={busy}>
        <p className="chat-hint">
          Выберите собеседника или нескольких участников для группы.
        </p>
        <label className="chat-search">
          <Search size={18} aria-hidden="true" />
          <input
            ref={input}
            aria-label="Имя или username"
            placeholder="Найти по имени или @username"
            value={query}
            maxLength={81}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {selected.length > 0 && (
          <ul className="chat-selected" aria-label="Выбранные участники">
            {selected.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => toggle(p)}
                  aria-label={"Убрать " + p.name}
                >
                  <Avatar person={p} size="small" />
                  <span>{p.name}</span>
                  <X size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="chat-people" aria-busy={loading}>
          <p className="chat-eyebrow">
            {term ? "Результаты поиска" : "Ваши подписки"}
          </p>
          {short ? (
            <p role="status" className="chat-hint">
              Введите хотя бы 2 символа.
            </p>
          ) : loading ? (
            <p role="status" className="chat-hint">
              Ищем пользователей…
            </p>
          ) : result.error ? (
            <div role="alert" className="chat-state">
              <p>{result.error}</p>
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setResult({ query: null, people: [], error: "" });
                  setRetry((n) => n + 1);
                }}
              >
                Повторить поиск
              </button>
            </div>
          ) : result.people.length === 0 ? (
            <p role="status" className="chat-hint">
              {term
                ? "Никого не нашли. Попробуйте другое имя или username."
                : "Найдите человека по имени или @username. Здесь появятся люди, на которых вы подписаны."}
            </p>
          ) : (
            <ul
              aria-label="Найденные пользователи"
              className="chat-people-list"
            >
              {result.people.map((p) => {
                const chosen = selected.some((s) => s.id === p.id);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="chat-person"
                      aria-pressed={chosen}
                      disabled={busy || (!chosen && selected.length >= 7)}
                      onClick={() => toggle(p)}
                    >
                      <Avatar person={p} />
                      <span className="chat-person-copy">
                        <strong>{p.name}</strong>
                        <span>@{p.username}</span>
                      </span>
                      <span className="chat-person-check" aria-hidden="true">
                        {chosen && <Check size={16} />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {selected.length > 1 && (
          <label className="chat-group-name">
            <span>
              <Users size={16} aria-hidden="true" /> Название группы
            </span>
            <input
              required
              value={name}
              maxLength={80}
              placeholder="Например, субботняя покатушка"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        )}
        {error && (
          <p role="alert" className="chat-error">
            {error} Можно изменить выбранных участников и повторить.
          </p>
        )}
        <div className="chat-selector-footer">
          <span className="chat-hint">
            {selected.length
              ? `${selected.length + 1} из 8 участников с вами`
              : "Личный диалог или группа до 8 человек"}
          </span>
          <button
            className="button"
            disabled={
              busy || !selected.length || (selected.length > 1 && !name.trim())
            }
          >
            <Send size={16} aria-hidden="true" />
            {busy
              ? "Создаём…"
              : selected.length > 1
                ? "Создать группу"
                : "Начать переписку"}
          </button>
        </div>
      </form>
    </CompactDialog>
  );
}
