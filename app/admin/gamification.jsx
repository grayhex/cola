"use client";
import { useConfirmation } from "../ui/confirmation.jsx";
import { useEffect, useState } from "react";
import { socialApi } from "../ui/social-primitives.jsx";
import { Trophy, Medal } from "../ui/icons.jsx";
import {
  recordDefinitions,
  achievements,
} from "../../lib/gamification-definitions.js";
import AssetPicker from "./asset-picker.jsx";
import GameDescriptionEditor from "./game-description-editor.jsx";

export default function Gamification() {
  const [ask, confirmation] = useConfirmation();
  const [value, setValue] = useState(null),
    [savedValue, setSavedValue] = useState(null),
    [assets, setAssets] = useState([]),
    [bikes, setBikes] = useState([]),
    [page, setPage] = useState(1),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const dirty = value && JSON.stringify(value) !== JSON.stringify(savedValue);

  useEffect(() => {
    let active = true;
    Promise.all([socialApi("game/admin/settings"), socialApi("admin/assets")])
      .then(([v, media]) => {
        if (!active) return;
        setValue(v);
        setSavedValue(v);
        setAssets(media.assets);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  // Paging/moderation must not reload settings and discard an unsaved upload.
  useEffect(() => {
    let active = true;
    socialApi("game/admin/bikes?page=" + page)
      .then((b) => {
        if (active) setBikes(b.bikes);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [page]);
  useEffect(() => {
    if (!dirty) return;
    const preventLeave = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventLeave);
    return () => {
      window.removeEventListener("beforeunload", preventLeave);
    };
  }, [dirty]);

  async function run(fn, success = "Сохранено") {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await fn();
      setMessage(success);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function setEntry(field, key, entry) {
    setValue((v) => ({ ...v, [field]: { ...v[field], [key]: entry } }));
  }
  function upload(field, key, file) {
    return run(async () => {
      if (file.size > 10 * 1024 * 1024)
        throw new Error("Максимальный размер 10 МБ");
      const response = await fetch(
        "/api/admin/assets?name=" + encodeURIComponent(file.name),
        {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Не удалось загрузить иллюстрацию");
      setAssets((items) => [
        data,
        ...items.filter((item) => item.id !== data.id),
      ]);
      setEntry(field, key, data.id);
    }, "Иллюстрация загружена. Нажмите «Сохранить правила и иллюстрации».");
  }
  function illustration(definition, field, Fallback) {
    const kind = field === "recordImages" ? "record" : "achievement";
    const descriptionField =
      kind === "record" ? "recordDescriptions" : "achievementDescriptions";
    return (
      <>
        <AssetPicker
          label={definition.name}
          help={
            definition.description ||
            (definition.group === "Community"
              ? "Голос сообщества"
              : definition.group)
          }
          assets={assets}
          value={value[field]?.[definition.key] || null}
          busy={busy}
          emptyLabel="Общая иконка"
          Fallback={Fallback}
          previewClassName="icon transparent"
          onChange={(id) => setEntry(field, definition.key, id)}
          onUpload={(file) => upload(field, definition.key, file)}
        />
        <GameDescriptionEditor
          definition={definition}
          kind={kind}
          value={value[descriptionField]?.[definition.key]}
          onChange={(text) => setEntry(descriptionField, definition.key, text)}
        />
      </>
    );
  }
  if (!value) return <p role="status">{error || "Загружаем…"}</p>;
  return (
    <section className="social-panel game-admin">
      {confirmation}
      <h2>Награды и рекорды</h2>
      <p className="help">
        Валюта площадки: RUB. Иллюстрации и описания меняют оформление, но не
        правила получения наград. Описания сохраняются вместе с иллюстрациями.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const next = await socialApi("game/admin/settings", "PUT", value);
            setValue(next);
            setSavedValue(next);
          });
        }}
      >
        <fieldset disabled={busy}>
          <legend className="sr-only">
            Правила, описания и иллюстрации достижений
          </legend>
          <div className="game-setting-grid">
            {[
              ["minimumCompleteness", "Минимальная заполненность, %", 0, 100],
              [
                "budgetMinimum",
                "Бюджетный рекорд: цена строго выше, ₽",
                1,
                1e9,
              ],
              ["weightMinimum", "Минимальный вес, кг", 1, 100],
              ["weightMaximum", "Максимальный вес, кг", 1, 200],
            ].map(([key, label, min, max]) => (
              <label className="field" key={key}>
                <span>{label}</span>
                <input
                  required
                  type="number"
                  step="0.01"
                  min={min}
                  max={max}
                  value={value[key]}
                  onChange={(e) =>
                    setValue((v) => ({ ...v, [key]: Number(e.target.value) }))
                  }
                />
              </label>
            ))}
          </div>
          <label className="admin-toggle">
            <span>Реакции сообщества</span>
            <input
              type="checkbox"
              checked={value.reactionsEnabled}
              onChange={(e) =>
                setValue((v) => ({ ...v, reactionsEnabled: e.target.checked }))
              }
            />
          </label>
          <section
            className="game-art-settings"
            aria-labelledby="record-art-title"
          >
            <h3 id="record-art-title">
              Иллюстрации рекордов · {recordDefinitions.length}
            </h3>
            <p className="help">
              Загрузите PNG, WebP или JPEG до 10 МБ либо выберите из медиатеки.
              Прозрачные изображения отображаются без обрезки. Сброс возвращает
              общую иконку сайта.
            </p>
            <div className="game-art-grid">
              {recordDefinitions.map((r) => (
                <div
                  className="game-art-slot"
                  key={r.key}
                  data-record-setting={r.key}
                >
                  {illustration(r, "recordImages", Trophy)}
                  <label className="admin-toggle">
                    <span>Показывать рекорд</span>
                    <input
                      type="checkbox"
                      aria-label={"Показывать «" + r.name + "»"}
                      checked={value.enabledRecords.includes(r.key)}
                      onChange={(e) =>
                        setValue((v) => ({
                          ...v,
                          enabledRecords: e.target.checked
                            ? [...v.enabledRecords, r.key]
                            : v.enabledRecords.filter((k) => k !== r.key),
                        }))
                      }
                    />
                  </label>
                </div>
              ))}
            </div>
          </section>
          <section
            className="game-art-settings"
            aria-labelledby="achievement-art-title"
          >
            <h3 id="achievement-art-title">
              Иллюстрации достижений · {achievements.length}
            </h3>
            <p className="help">
              Для полученных и будущих наград в личном кабинете, профиле и
              карточке велосипеда. Условия получения остаются прежними.
            </p>
            <div className="game-art-grid">
              {achievements.map((a) => (
                <div
                  className="game-art-slot"
                  key={a.key}
                  data-achievement-setting={a.key}
                >
                  {illustration(a, "achievementImages", Medal)}
                </div>
              ))}
            </div>
          </section>
          <div className="game-admin-save">
            <button className="button" disabled={busy || !dirty}>
              Сохранить правила и иллюстрации
            </button>
            <span className="help">
              {dirty ? "Есть несохранённые изменения" : "Изменения сохранены"}
            </span>
          </div>
        </fieldset>
      </form>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p role="status">{message}</p>
      <h3>Участие велосипедов</h3>
      <p className="help">
        Исключение не снимает велосипед с публикации. Действие и причина
        записываются в аудит.
      </p>
      {bikes.map((b) => (
        <div className="game-moderation" key={b.id}>
          <a href={"/b/" + b.share_id}>{b.name}</a>
          <span>{b.leaderboard_excluded ? "Исключён" : "Участвует"}</span>
          <button
            disabled={busy}
            type="button"
            className="quiet"
            onClick={async () => {
              const reason = await ask(
                "Укажите причину изменения участия велосипеда в рейтинге.",
                {
                  title: "Участие в рейтинге",
                  input: { label: "Причина изменения участия", minLength: 3 },
                  confirmLabel: "Сохранить",
                },
              );
              if (reason)
                run(async () => {
                  await socialApi("game/admin/bikes/" + b.id, "PATCH", {
                    excluded: !b.leaderboard_excluded,
                    reason,
                  });
                  setBikes(
                    (await socialApi("game/admin/bikes?page=" + page)).bikes,
                  );
                });
            }}
          >
            {b.leaderboard_excluded ? "Вернуть" : "Исключить"}
          </button>
        </div>
      ))}
      <div className="form-actions">
        <button
          type="button"
          disabled={busy || page === 1}
          onClick={() => setPage((p) => p - 1)}
        >
          Назад
        </button>
        <span>{page}</span>
        <button
          type="button"
          disabled={busy || bikes.length < 25}
          onClick={() => setPage((p) => p + 1)}
        >
          Далее
        </button>
      </div>
    </section>
  );
}
