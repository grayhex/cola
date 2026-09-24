"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import {
  parseRichText,
  serializeRichText,
  richExtensions,
  richPlainText,
  safeRichLink,
} from "../../lib/rich-text.js";
import RichTextBody from "./rich-text-body.jsx";
import styles from "./prompt-composer.module.css";

// One controlled Markdown contract and one WYSIWYG surface for articles, posts,
// discussions and legal documents. Historical bodies require no migration.
export default function PromptComposer({
  label,
  value = "",
  onChange,
  maxLength = 20000,
  rows = 6,
  required = false,
  disabled = false,
  placeholder,
  photos = [],
  children,
}) {
  const id = useId(),
    root = useRef(null);
  const toolbarSelection = useRef(null);
  const latest = useRef({ onChange, maxLength });
  latest.current = { onChange, maxLength };
  const emitted = useRef(value);
  const [mode, setMode] = useState("write"),
    [message, setMessage] = useState("");
  const [linkOpen, setLinkOpen] = useState(false),
    [link, setLink] = useState("");
  const extensions = useMemo(
    () => [
      ...richExtensions(),
      Extension.create({
        name: "bodyLimit",
        addProseMirrorPlugins() {
          return [
            new Plugin({
              filterTransaction(transaction, state) {
                if (!transaction.docChanged) return true;
                const length = serializeRichText(
                  transaction.doc.toJSON(),
                ).length;
                if (
                  length <= latest.current.maxLength ||
                  length < serializeRichText(state.doc.toJSON()).length
                )
                  return true;
                queueMicrotask(() =>
                  setMessage(
                    `Максимум ${latest.current.maxLength} символов с разметкой. Сократите текст.`,
                  ),
                );
                return false;
              },
            }),
          ];
        },
      }),
    ],
    [],
  );
  const editor = useEditor({
    extensions,
    content: parseRichText(value),
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    editable: !disabled,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": label,
        "aria-multiline": "true",
        "aria-required": String(required),
        "data-placeholder":
          placeholder || "Поделитесь историей, опытом или вопросом…",
      },
    },
    onUpdate({ editor: current }) {
      const body = serializeRichText(current.getJSON());
      emitted.current = body;
      latest.current.onChange(body);
      setMessage("");
    },
  });
  useEffect(() => {
    if (editor && value !== emitted.current) {
      editor.commands.setContent(parseRichText(value), { emitUpdate: false });
      emitted.current = value;
    }
  }, [value, editor]);
  useEffect(() => {
    editor?.setEditable(!disabled, false);
  }, [editor, disabled]);
  useEffect(() => {
    const form = root.current?.closest("form");
    const validate = (event) => {
      if (
        disabled ||
        value.length > maxLength ||
        (required && !richPlainText(value))
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setMessage(
          disabled
            ? "Дождитесь завершения действия."
            : value.length > maxLength
              ? "Текст превышает допустимую длину."
              : "Введите текст.",
        );
        setMode("write");
        editor?.commands.focus();
      }
    };
    form?.addEventListener("submit", validate, true);
    return () => form?.removeEventListener("submit", validate, true);
  }, [editor, disabled, required, value, maxLength]);
  function action(title, text, command, active = false, enabled = true) {
    return (
      <button
        type="button"
        key={title}
        aria-label={title}
        title={title}
        aria-pressed={active}
        disabled={disabled || !editor || !enabled}
        // Keep the logical selection even when mobile Safari moves DOM focus.
        // Do not cancel touch pointerdown: WebKit can suppress its native click.
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const { selection, doc, storedMarks } = editor.state;
          toolbarSelection.current = {
            button: event.currentTarget,
            bookmark: selection.getBookmark(), doc, storedMarks,
          };
          if (event.pointerType === "mouse") event.preventDefault();
        }}
        onPointerCancel={() => { toolbarSelection.current = null; }}
        onKeyDown={() => { toolbarSelection.current = null; }}
        onMouseDown={(event) => {
          if (event.button === 0) event.preventDefault();
        }}
        onClick={(event) => {
          const saved = toolbarSelection.current;
          toolbarSelection.current = null;
          // A delayed click must not restore positions from a replaced document.
          if (saved?.button === event.currentTarget && saved.doc === editor.state.doc) {
            const tr = editor.state.tr.setSelection(saved.bookmark.resolve(saved.doc));
            if (saved.storedMarks) tr.setStoredMarks(saved.storedMarks);
            editor.view.dispatch(tr);
          }
          command();
        }}
      >
        {text}
      </button>
    );
  }
  const modes = [
    ["write", "Написать"],
    ["preview", "Предпросмотр"],
    ["source", "Исходник"],
  ];
  return (
    <div ref={root} className={styles.composer} data-rich-editor={label}>
      <div
        className={styles.toolbar}
        role="tablist"
        aria-label={"Режим редактора: " + label}
      >
        {modes.map(([key, title], index) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`${id}-tab-${index}`}
            aria-selected={mode === key}
            aria-controls={`${id}-panel-${index}`}
            tabIndex={mode === key ? 0 : -1}
            onClick={() => setMode(key)}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? modes.length - 1
                    : (index +
                        (event.key === "ArrowRight" ? 1 : -1) +
                        modes.length) %
                      modes.length;
              setMode(modes[next][0]);
              document.getElementById(`${id}-tab-${next}`)?.focus();
            }}
          >
            {title}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${id}-panel-0`}
        aria-labelledby={`${id}-tab-0`}
        hidden={mode !== "write"}
      >
        <div
          className={styles.formatting}
          role="toolbar"
          aria-label={"Форматирование: " + label}
        >
          <select
            aria-label="Стиль абзаца"
            disabled={disabled || !editor}
            value={
              editor?.isActive("heading")
                ? String(editor.getAttributes("heading").level)
                : "paragraph"
            }
            onChange={(event) =>
              event.target.value === "paragraph"
                ? editor.chain().focus().setParagraph().run()
                : editor
                    .chain()
                    .focus()
                    .setHeading({ level: Number(event.target.value) })
                    .run()
            }
          >
            <option value="paragraph">Абзац</option>
            <option value="1">Заголовок</option>
            <option value="2">Подзаголовок</option>
            <option value="3">Малый заголовок</option>
          </select>
          {action(
            "Полужирный",
            <b>B</b>,
            () => editor.chain().focus().toggleBold().run(),
            editor?.isActive("bold"),
          )}
          {action(
            "Курсив",
            <i>I</i>,
            () => editor.chain().focus().toggleItalic().run(),
            editor?.isActive("italic"),
          )}
          {action(
            "Подчёркнутый",
            <u>U</u>,
            () => editor.chain().focus().toggleUnderline().run(),
            editor?.isActive("underline"),
          )}
          {action(
            "Маркированный список",
            "• ≡",
            () => editor.chain().focus().toggleBulletList().run(),
            editor?.isActive("bulletList"),
          )}
          {action(
            "Нумерованный список",
            "1. ≡",
            () => editor.chain().focus().toggleOrderedList().run(),
            editor?.isActive("orderedList"),
          )}
          {action(
            "Цитата",
            "❞",
            () => editor.chain().focus().toggleBlockquote().run(),
            editor?.isActive("blockquote"),
          )}
          {action(
            "Ссылка",
            "Ссылка",
            () => {
              setLink(editor.getAttributes("link").href || "");
              setLinkOpen(true);
            },
            editor?.isActive("link"),
          )}
          {action(
            "Отменить действие",
            "↶",
            () => editor.chain().focus().undo().run(),
            false,
            editor?.can().undo(),
          )}
          {action(
            "Повторить действие",
            "↷",
            () => editor.chain().focus().redo().run(),
            false,
            editor?.can().redo(),
          )}
          {action("Убрать форматирование", "Tx", () =>
            editor.chain().focus().unsetAllMarks().clearNodes().run(),
          )}
        </div>
        {linkOpen && (
          <div
            className={styles.linkControls}
            role="group"
            aria-label="Настройка ссылки"
          >
            <input
              aria-label="Адрес ссылки"
              type="text"
              inputMode="url"
              placeholder="https://…"
              value={link}
              disabled={disabled}
              onChange={(event) => setLink(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.preventDefault();
                if (event.key === "Escape") {
                  setLinkOpen(false);
                  editor.commands.focus();
                }
              }}
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                const href = safeRichLink(link.trim());
                if (!href) {
                  setMessage(
                    "Введите HTTP/HTTPS-ссылку или путь /страницы без пробелов.",
                  );
                  return;
                }
                editor
                  .chain()
                  .focus()
                  .extendMarkRange("link")
                  .setLink({ href })
                  .run();
                setLinkOpen(false);
                setMessage("");
              }}
            >
              Применить ссылку
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                editor
                  .chain()
                  .focus()
                  .extendMarkRange("link")
                  .unsetLink()
                  .run();
                setLinkOpen(false);
              }}
            >
              Убрать ссылку
            </button>
            <button
              type="button"
              onClick={() => {
                setLinkOpen(false);
                editor.commands.focus();
              }}
            >
              Отмена
            </button>
          </div>
        )}
        <EditorContent
          editor={editor}
          className={styles.richSurface}
          style={{ "--editor-height": Math.max(100, rows * 24) + "px" }}
        />
        {!editor && <p role="status">Загружаем редактор…</p>}
      </div>
      <div
        role="tabpanel"
        id={`${id}-panel-1`}
        aria-labelledby={`${id}-tab-1`}
        hidden={mode !== "preview"}
        className={styles.preview}
        tabIndex={0}
      >
        {value.trim() ? (
          <RichTextBody doc={parseRichText(value)} photos={photos} />
        ) : (
          <span className={styles.empty}>Здесь появится ваш текст</span>
        )}
      </div>
      <div
        role="tabpanel"
        id={`${id}-panel-2`}
        aria-labelledby={`${id}-tab-2`}
        hidden={mode !== "source"}
      >
        <textarea
          aria-label={"Исходник: " + label}
          value={value}
          maxLength={maxLength}
          rows={rows}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      {message && (
        <p className={styles.message} role="alert">
          {message}
        </p>
      )}
      <div className={styles.footer}>
        <small>
          {value.length.toLocaleString("ru-RU")} /{" "}
          {maxLength.toLocaleString("ru-RU")}
        </small>
        {children}
      </div>
    </div>
  );
}
