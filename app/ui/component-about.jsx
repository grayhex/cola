"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Pencil } from "lucide-react";
import { CompactDialog } from "./compact-ui.jsx";
import { socialApi } from "./social-primitives.jsx";
import { productCategories } from "../../lib/component-products.js";
import styles from "./component-about.module.css";

/** The edit of a catalog model for administrators (#264): the existing admin
 * endpoint, a compact window like the photo actions. */
function ComponentEditor({ model, open, onClose, focusDescription }) {
  const router = useRouter();
  const description = useRef(null);
  const [form, setForm] = useState(() => ({
      category: model.category,
      brand: model.brand || "",
      name: model.name,
      description: model.description || "",
    })),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  // «Добавить описание» lands in the text field once the window has opened
  // (showModal focuses its first field).
  useEffect(() => {
    if (!open || !focusDescription) return;
    const frame = requestAnimationFrame(() => description.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, focusDescription]);
  async function save(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await socialApi(
        "admin/component-models/" + model.id,
        "PATCH",
        { ...form, archived: model.archived, version: model.version },
      );
      onClose();
      // A new name or type moves the page; the old address still redirects.
      if (result.path && result.path !== model.path) router.push(result.path);
      else router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <CompactDialog
      open={open}
      onClose={onClose}
      title="Редактировать компонент"
    >
      {open && (
        <form className={styles.editor} onSubmit={save}>
          <label className="field">
            <span>Тип</span>
            <select
              value={form.category}
              onChange={(e) => set("category", e.target.value)}
              disabled={busy}
            >
              {productCategories.map((category) => (
                <option key={category}>{category}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Бренд</span>
            <input
              value={form.brand}
              maxLength={100}
              onChange={(e) => set("brand", e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="field">
            <span>Модель</span>
            <input
              value={form.name}
              maxLength={150}
              required
              onChange={(e) => set("name", e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="field">
            <span>Описание</span>
            <textarea
              ref={description}
              value={form.description}
              maxLength={2000}
              rows={6}
              placeholder="Для чего модель, чем отличается, на что смотреть при выборе."
              onChange={(e) => set("description", e.target.value)}
              disabled={busy}
            />
            <small>Обычный текст, до 2000 знаков; пустая строка — абзац.</small>
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              className="button secondary small"
              onClick={onClose}
              disabled={busy}
            >
              Отмена
            </button>
            <button className="button small" disabled={busy} aria-busy={busy}>
              {busy ? "Сохраняем…" : "Сохранить"}
            </button>
          </div>
        </form>
      )}
    </CompactDialog>
  );
}

/**
 * The left half of a component page (#264): the model's description, or a
 * clear empty state — an administrator gets the editor right there.
 * @param {{ model: any, canEdit: boolean, children: (edit: { button: any }) => any }} props
 */
export default function ComponentAbout({ model, canEdit, children }) {
  const [editing, setEditing] = useState(null);
  const text = (model.description || "").trim();
  const edit = (focusDescription = false) => setEditing({ focusDescription });
  const button = canEdit ? (
    <button
      type="button"
      className="button secondary small"
      aria-haspopup="dialog"
      aria-expanded={!!editing}
      onClick={() => edit()}
    >
      <Pencil size={16} />
      Редактировать
    </button>
  ) : null;
  const about = (
    <section className={styles.about} aria-labelledby="component-about">
      <h2 id="component-about">Описание</h2>
      {text ? (
        <div className={styles.text}>
          {text.split(/\n\s*\n/).map((paragraph, i) => (
            <p key={i}>{paragraph}</p>
          ))}
        </div>
      ) : canEdit ? (
        <div className={styles.empty}>
          <FileText size={20} aria-hidden="true" />
          <p>Описания пока нет. Расскажите, что это за модель.</p>
          <button
            type="button"
            className="button secondary small"
            aria-haspopup="dialog"
            onClick={() => edit(true)}
          >
            <Pencil size={16} />
            Добавить описание
          </button>
        </div>
      ) : (
        <p className={styles.none}>
          Описания пока нет. Ниже — сборки владельцев и их записи о модели.
        </p>
      )}
    </section>
  );
  return (
    <>
      {children({ button, about })}
      {canEdit && (
        <ComponentEditor
          key={editing ? model.version + ":open" : model.version}
          model={model}
          open={!!editing}
          focusDescription={!!editing?.focusDescription}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
