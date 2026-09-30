"use client";
import { useEffect, useState } from "react";
import { socialApi } from "../ui/social-primitives.jsx";
import { gameImagePromptLimit } from "../../lib/game-prompt-validation.ts";

export default function GameImagePrompt() {
  const [prompt, setPrompt] = useState(null);
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const dirty = prompt !== null && prompt !== saved;
  useEffect(() => {
    let active = true;
    socialApi("game/admin/image-prompt")
      .then((data) => {
        if (active) {
          setPrompt(data.prompt);
          setSaved(data.prompt);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const preventLeave = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventLeave);
    return () => window.removeEventListener("beforeunload", preventLeave);
  }, [dirty]);
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const data = await socialApi("game/admin/image-prompt", "PUT", {
        prompt,
      });
      setPrompt(data.prompt);
      setSaved(data.prompt);
      setMessage(data.prompt ? "Гайд сохранён" : "Гайд удалён");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="game-image-prompt">
      <summary>Гайд для иллюстраций наград</summary>
      <p className="help">
        Сохраните стиль и требования к новым изображениям. Текст виден только
        администраторам. Иллюстрации загружаются в редакторе наград ниже.
      </p>
      {prompt === null ? (
        <p role="status">{error || "Загружаем гайд…"}</p>
      ) : (
        <form onSubmit={save}>
          <fieldset disabled={busy}>
            <legend className="sr-only">Гайд для иллюстраций</legend>
            {!saved && <p className="help">Гайд пока не задан.</p>}
            <label className="field" htmlFor="game-image-prompt">
              Prompt / гайд для генерации изображений
            </label>
            <textarea
              id="game-image-prompt"
              rows={6}
              value={prompt}
              maxLength={gameImagePromptLimit}
              aria-describedby="game-image-prompt-help"
              onChange={(e) => {
                setPrompt(e.target.value);
                setMessage("");
              }}
            />
            <p id="game-image-prompt-help" className="help">
              {prompt.length}/{gameImagePromptLimit} символов. Сохранение меняет
              только этот текст.
            </p>
            <div className="game-admin-save">
              <button className="button" disabled={busy || !dirty}>
                Сохранить гайд
              </button>
              <button
                className="button secondary"
                type="button"
                disabled={busy || !dirty}
                onClick={() => {
                  setPrompt(saved);
                  setError("");
                  setMessage("");
                }}
              >
                Отменить изменения гайда
              </button>
            </div>
          </fieldset>
          {message && <p role="status">{message}</p>}
          {error && <p role="alert">{error}</p>}
        </form>
      )}
    </details>
  );
}
