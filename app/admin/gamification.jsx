"use client";
import { useEffect, useState } from "react";
import { socialApi } from "../ui/social-primitives.jsx";
import { recordDefinitions } from "../../lib/gamification-definitions.js";
export default function Gamification() {
  const [value, setValue] = useState(null),
    [bikes, setBikes] = useState([]),
    [page, setPage] = useState(1),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function load() {
    const [v, b] = await Promise.all([
      socialApi("game/admin/settings"),
      socialApi("game/admin/bikes?page=" + page),
    ]);
    setValue(v);
    setBikes(b.bikes);
  }
  useEffect(() => {
    load().catch((e) => setMessage(e.message));
  }, [page]);
  async function run(fn) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
      setMessage("Сохранено");
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!value) return <p role="status">{message || "Загружаем…"}</p>;
  return (
    <section className="social-panel">
      <h2>Правила Hall of Fame</h2>
      <p>Валюта площадки: RUB (рубли). Конвертации и смешивания валют нет.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(() => socialApi("game/admin/settings", "PUT", value));
        }}
      >
        <div className="game-setting-grid">
          {[
            ["minimumCompleteness", "Минимальная заполненность, %", 0, 100],
            ["budgetMinimum", "Бюджетный рекорд: цена строго выше, ₽", 1, 1e9],
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
                  setValue({ ...value, [key]: Number(e.target.value) })
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
              setValue({ ...value, reactionsEnabled: e.target.checked })
            }
          />
        </label>
        {recordDefinitions.map((r) => (
          <label className="admin-toggle" key={r.key}>
            <span>{r.name}</span>
            <input
              type="checkbox"
              checked={value.enabledRecords.includes(r.key)}
              onChange={(e) =>
                setValue({
                  ...value,
                  enabledRecords: e.target.checked
                    ? [...value.enabledRecords, r.key]
                    : value.enabledRecords.filter((k) => k !== r.key),
                })
              }
            />
          </label>
        ))}
        <button className="button" disabled={busy}>
          Сохранить правила
        </button>
      </form>
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
            className="quiet"
            onClick={() => {
              const reason = window.prompt(
                "Причина изменения участия (минимум 3 символа)",
              );
              if (reason)
                run(async () => {
                  await socialApi("game/admin/bikes/" + b.id, "PATCH", {
                    excluded: !b.leaderboard_excluded,
                    reason,
                  });
                  await load();
                });
            }}
          >
            {b.leaderboard_excluded ? "Вернуть" : "Исключить"}
          </button>
        </div>
      ))}
      <div className="form-actions">
        <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
          Назад
        </button>
        <span>{page}</span>
        <button
          disabled={bikes.length < 25}
          onClick={() => setPage((p) => p + 1)}
        >
          Далее
        </button>
      </div>
    </section>
  );
}
