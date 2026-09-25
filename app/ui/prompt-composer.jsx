"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import { Plugin, Selection } from "@tiptap/pm/state";
import {
  parseRichText,
  serializeRichText,
  richExtensions,
  richPlainText,
  safeRichLink,
  PhotoReference,
} from "../../lib/rich-text.js";
import RichTextBody from "./rich-text-body.jsx";
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Quote,
  Undo2,
  Redo2,
  RemoveFormatting,
} from "./icons.jsx";
import styles from "./prompt-composer.module.css";

// In the editor an illustration shows its picture and an editable caption,
// and can be dragged to another place in the text (#128).
const PhotoInEditor = PhotoReference.extend({
  draggable: true,
  addNodeView() {
    return ({ node: initial, getPos, editor }) => {
      let node = initial;
      const dom = document.createElement("span");
      dom.className = "rich-photo-reference";
      dom.contentEditable = "false";
      dom.dataset.photoReference = node.attrs.id;
      const image = document.createElement("img");
      image.src = "/api/journal/media/" + node.attrs.id + "?width=640";
      image.alt = "";
      image.draggable = false;
      image.addEventListener("error", () => image.remove());
      const caption = document.createElement("input");
      caption.type = "text";
      caption.maxLength = 200;
      caption.placeholder = "Подпись к иллюстрации";
      caption.setAttribute("aria-label", "Подпись к иллюстрации");
      caption.value = node.attrs.alt || "";
      const commit = () => {
        const position = getPos(),
          alt = caption.value.replace(/[[\]\\\r\n]/g, " ").trim();
        if (typeof position !== "number" || alt === node.attrs.alt) return;
        editor.view.dispatch(
          editor.view.state.tr.setNodeMarkup(position, undefined, {
            ...node.attrs,
            alt,
          }),
        );
      };
      caption.addEventListener("change", commit);
      // Enter keeps the caption and returns to the text under the picture:
      // it must not submit the article's form.
      caption.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || event.isComposing) return;
        event.preventDefault();
        commit();
        const position = getPos();
        if (typeof position !== "number") return;
        editor
          .chain()
          .focus()
          .command(({ tr }) => {
            const after = tr.doc.resolve(position).after();
            tr.setSelection(Selection.near(tr.doc.resolve(after), 1));
            return true;
          })
          .run();
      });
      dom.append(image, caption);
      return {
        dom,
        // Typing in the caption belongs to the input, not to the document.
        stopEvent: (event) => event.target === caption,
        ignoreMutation: () => true,
        update(updated) {
          if (updated.type !== node.type || updated.attrs.id !== node.attrs.id)
            return false;
          node = updated;
          if (document.activeElement !== caption)
            caption.value = updated.attrs.alt || "";
          return true;
        },
      };
    };
  },
});

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
  // A ref the page fills in with insertPhoto(id, alt): an illustration goes
  // where the author writes, as a paragraph of its own (#128).
  inserter,
  children,
}) {
  const id = useId(),
    root = useRef(null),
    source = useRef(null);
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
      ...richExtensions().map((extension) =>
        extension.name === "photoReference" ? PhotoInEditor : extension,
      ),
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
    if (!inserter) return;
    inserter.current = (photoId, alt = "") => {
      const markdown = `![${alt}](photo:${photoId})`;
      if (mode === "write" && editor) {
        // The picture lands at the author's cursor as a paragraph of its own,
        // which splits the text around it. It goes after a selection and
        // never replaces the selected text or illustration.
        editor
          .chain()
          .focus()
          .insertContentAt(editor.state.selection.to, {
            type: "paragraph",
            content: [{ type: "photoReference", attrs: { id: photoId, alt } }],
          })
          .run();
        return;
      }
      const area = source.current;
      const at = mode === "source" && area ? area.selectionStart : value.length;
      const before = value.slice(0, at).replace(/\s*$/, ""),
        after = value.slice(at).replace(/^\s*/, "");
      onChange(
        [before, markdown, after].filter(Boolean).join("\n\n") +
          (after ? "" : "\n"),
      );
    };
    return () => {
      inserter.current = null;
    };
  }, [inserter, editor, mode, value, onChange]);
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
            bookmark: selection.getBookmark(),
            doc,
            storedMarks,
          };
          if (event.pointerType === "mouse") event.preventDefault();
        }}
        onPointerCancel={() => {
          toolbarSelection.current = null;
        }}
        onKeyDown={() => {
          toolbarSelection.current = null;
        }}
        onMouseDown={(event) => {
          if (event.button === 0) event.preventDefault();
        }}
        onClick={(event) => {
          const saved = toolbarSelection.current;
          toolbarSelection.current = null;
          // A delayed click must not restore positions from a replaced document.
          if (
            saved?.button === event.currentTarget &&
            saved.doc === editor.state.doc
          ) {
            const tr = editor.state.tr.setSelection(
              saved.bookmark.resolve(saved.doc),
            );
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
            <Bold size={16} aria-hidden="true" />,
            () => editor.chain().focus().toggleBold().run(),
            editor?.isActive("bold"),
          )}
          {action(
            "Курсив",
            <Italic size={16} aria-hidden="true" />,
            () => editor.chain().focus().toggleItalic().run(),
            editor?.isActive("italic"),
          )}
          {action(
            "Подчёркнутый",
            <Underline size={16} aria-hidden="true" />,
            () => editor.chain().focus().toggleUnderline().run(),
            editor?.isActive("underline"),
          )}
          {action(
            "Маркированный список",
            <List size={16} aria-hidden="true" />,
            () => editor.chain().focus().toggleBulletList().run(),
            editor?.isActive("bulletList"),
          )}
          {action(
            "Нумерованный список",
            <ListOrdered size={16} aria-hidden="true" />,
            () => editor.chain().focus().toggleOrderedList().run(),
            editor?.isActive("orderedList"),
          )}
          {action(
            "Цитата",
            <Quote size={16} aria-hidden="true" />,
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
            <Undo2 size={16} aria-hidden="true" />,
            () => editor.chain().focus().undo().run(),
            false,
            editor?.can().undo(),
          )}
          {action(
            "Повторить действие",
            <Redo2 size={16} aria-hidden="true" />,
            () => editor.chain().focus().redo().run(),
            false,
            editor?.can().redo(),
          )}
          {action(
            "Убрать форматирование",
            <RemoveFormatting size={16} aria-hidden="true" />,
            () => editor.chain().focus().unsetAllMarks().clearNodes().run(),
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
          ref={source}
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
