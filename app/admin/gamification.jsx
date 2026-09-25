"use client";
import { useConfirmation } from "../ui/confirmation.jsx";
import { useEffect, useState } from "react";
import { socialApi } from "../ui/social-primitives.jsx";
import AchievementArt from "../ui/achievement-art.jsx";
import { Medal, Plus, RefreshCw, Save, Trash2, Trophy } from "../ui/icons.jsx";
import AssetPicker from "./asset-picker.jsx";
import { publicPath } from "../../lib/public-urls.js";
import {
  gameMetrics,
  metricByKey,
  metricGroups,
} from "../../lib/game-metrics.js";
import { ruleInput } from "../../lib/game-rule-validation.js";
import { categories } from "../../lib/catalog.js";
import {
  gameDescriptionLimit,
  ruleCondition,
} from "../../lib/gamification-presentation.js";

// Awards and records are rules (#106): a metric from the catalog, a
// condition (award) or a direction (record), filters, a name, a description
// and an illustration. The key never changes: award history refers to it.
const inputFields = [
  "key",
  "kind",
  "metric",
  "comparison",
  "threshold",
  "direction",
  "category",
  "minDistanceKm",
  "keywords",
  "name",
  "description",
  "imageId",
  "enabled",
];
const toInput = (rule) =>
  Object.fromEntries(inputFields.map((field) => [field, rule[field]]));
const sameRules = (a, b) =>
  JSON.stringify(a.map(toInput)) === JSON.stringify(b.map(toInput));
// The first problem of a rule, in the words of the server's check.
function ruleProblem(rule) {
  const result = ruleInput.safeParse(toInput(rule));
  return result.success ? "" : result.error.issues[0].message;
}

function newRule(kind) {
  const key =
    "rule_" +
    Array.from(crypto.getRandomValues(new Uint8Array(5)), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  return {
    key,
    kind,
    subject: "ride",
    metric: "ride_distance",
    comparison: "gte",
    threshold: kind === "award" ? 100 : null,
    direction: kind === "record" ? "max" : null,
    category: null,
    minDistanceKm: null,
    keywords: [],
    name: "",
    description: "",
    imageId: null,
    enabled: true,
    builtin: false,
    awarded: 0,
    added: true,
  };
}
// A new metric keeps only the filters it supports.
function withMetric(rule, key) {
  const metric = metricByKey[key];
  return {
    ...rule,
    metric: key,
    subject: metric.subject,
    category: metric.filters.includes("category") ? rule.category : null,
    minDistanceKm: metric.filters.includes("minDistanceKm")
      ? rule.minDistanceKm
      : null,
    keywords: metric.filters.includes("keywords") ? rule.keywords : [],
  };
}
const numberOrNull = (text) => (text === "" ? null : Number(text));

function RuleEditor({ rule, assets, busy, onChange, onRemove, onUpload }) {
  const metric = metricByKey[rule.metric];
  const [keywords, setKeywords] = useState(rule.keywords.join(", "));
  const problem = ruleProblem(rule);
  const title = rule.name.trim() || "Без названия";
  const set = (patch) => onChange({ ...rule, ...patch });
  return (
    <details
      className="game-rule"
      data-rule={rule.key}
      data-kind={rule.kind}
      open={rule.added || undefined}
    >
      <summary>
        <AchievementArt
          imageId={rule.imageId}
          kind={rule.kind === "award" ? "achievement" : "record"}
          size={32}
        />
        <span className="game-rule-title">
          <strong>{title}</strong>
          <small>{ruleCondition(rule, categories)}</small>
        </span>
        <span className="game-rule-state">
          {problem && (
            <span className="badge" data-tone="danger">
              Ошибка
            </span>
          )}
          {rule.kind === "award" && (
            <span className="badge mono" title="Сколько человек получили">
              {rule.awarded}
            </span>
          )}
          <span
            className="badge"
            data-tone={rule.enabled ? "success" : undefined}
          >
            {rule.enabled ? "Включено" : "Выключено"}
          </span>
        </span>
      </summary>
      <div className="game-rule-body">
        <div className="game-rule-grid">
          <label className="field">
            <span>Название</span>
            <input
              value={rule.name}
              maxLength={60}
              onChange={(e) => set({ name: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Метрика</span>
            <select
              value={rule.metric}
              onChange={(e) => onChange(withMetric(rule, e.target.value))}
            >
              {metricGroups.map((group) => {
                const options = gameMetrics.filter(
                  (m) => m.group === group.id && m[rule.kind],
                );
                return options.length ? (
                  <optgroup key={group.id} label={group.name}>
                    {options.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label}
                      </option>
                    ))}
                  </optgroup>
                ) : null;
              })}
            </select>
          </label>
          {rule.kind === "award" ? (
            <>
              <label className="field">
                <span>Условие</span>
                <select
                  value={rule.comparison}
                  onChange={(e) => set({ comparison: e.target.value })}
                >
                  <option value="gte">Не меньше порога</option>
                  <option value="lte">Не больше порога</option>
                </select>
              </label>
              <label className="field">
                <span>Порог{metric.unit ? ", " + metric.unit : ""}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={metric.max}
                  step={metric.step}
                  value={rule.threshold ?? ""}
                  onChange={(e) =>
                    set({ threshold: numberOrNull(e.target.value) })
                  }
                />
              </label>
            </>
          ) : (
            <label className="field">
              <span>Рекорд держит</span>
              <select
                value={rule.direction}
                onChange={(e) => set({ direction: e.target.value })}
              >
                <option value="max">Наибольшее значение</option>
                <option value="min">Наименьшее значение</option>
              </select>
            </label>
          )}
          {metric.filters.includes("category") && (
            <label className="field">
              <span>Тип велосипеда</span>
              <select
                value={rule.category || ""}
                onChange={(e) => set({ category: e.target.value || null })}
              >
                <option value="">Любой</option>
                {Object.entries(categories).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {metric.filters.includes("minDistanceKm") && (
            <label className="field">
              <span>Только покатушки от, км</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={10000}
                step={0.1}
                value={rule.minDistanceKm ?? ""}
                onChange={(e) =>
                  set({ minDistanceKm: numberOrNull(e.target.value) })
                }
              />
            </label>
          )}
          {metric.filters.includes("keywords") && (
            <label className="field">
              <span>Слова в названии детали, через запятую</span>
              <input
                value={keywords}
                placeholder="Di2, AXS, eTap"
                onChange={(e) => {
                  setKeywords(e.target.value);
                  set({
                    keywords: e.target.value
                      .split(",")
                      .map((word) => word.trim())
                      .filter(Boolean),
                  });
                }}
              />
            </label>
          )}
        </div>
        <label className="field">
          <span>Короткое описание</span>
          <textarea
            rows={2}
            maxLength={gameDescriptionLimit}
            value={rule.description}
            onChange={(e) => set({ description: e.target.value })}
          />
          <small>
            {rule.description.length}/{gameDescriptionLimit} · видно на странице
            рекордов и в подсказке награды
          </small>
        </label>
        <AssetPicker
          label={"Иллюстрация «" + title + "»"}
          help={rule.kind === "award" ? "Награда" : "Рекорд"}
          assets={assets}
          value={rule.imageId}
          busy={busy}
          emptyLabel="Общая иконка"
          Fallback={rule.kind === "award" ? Medal : Trophy}
          previewClassName="icon transparent"
          onChange={(imageId) => set({ imageId })}
          onUpload={onUpload}
        />
        {problem && <p className="error">{problem}</p>}
        <div className="game-rule-actions">
          <label className="setting-row">
            <span>
              Включено
              <small>
                {rule.kind === "award"
                  ? "Выключенную награду не выдают и не показывают; полученные сохраняются."
                  : "Выключенный рекорд не показывается."}
              </small>
            </span>
            <input
              type="checkbox"
              role="switch"
              className="toggle"
              aria-label={"Включить «" + title + "»"}
              checked={rule.enabled}
              onChange={(e) => set({ enabled: e.target.checked })}
            />
          </label>
          <small className="game-rule-key">
            Ключ {rule.key}
            {rule.builtin ? " · встроенное" : ""}
            {rule.kind === "award" ? " · получили: " + rule.awarded : ""}
          </small>
          {!rule.builtin && !rule.awarded && (
            <button
              type="button"
              className="quiet danger"
              disabled={busy}
              onClick={onRemove}
            >
              <Trash2 size={15} />
              Удалить
            </button>
          )}
        </div>
      </div>
    </details>
  );
}

export default function Gamification() {
  const [ask, confirmation] = useConfirmation();
  const [settings, setSettings] = useState(null),
    [savedSettings, setSavedSettings] = useState(null),
    [rules, setRules] = useState(null),
    [savedRules, setSavedRules] = useState(null),
    [assets, setAssets] = useState([]),
    [bikes, setBikes] = useState([]),
    [page, setPage] = useState(1),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    // Editors start over after saving or cancelling: typed keywords too.
    [revision, setRevision] = useState(0);
  const settingsDirty =
    settings && JSON.stringify(settings) !== JSON.stringify(savedSettings);
  const rulesDirty = rules && !sameRules(rules, savedRules);

  useEffect(() => {
    let active = true;
    Promise.all([socialApi("game/admin/rules"), socialApi("admin/assets")])
      .then(([data, media]) => {
        if (!active) return;
        setSettings(data.settings);
        setSavedSettings(data.settings);
        setRules(data.rules);
        setSavedRules(data.rules);
        setAssets(media.assets);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  // Paging and moderation must not reload the rules and drop unsaved edits.
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
    if (!settingsDirty && !rulesDirty) return;
    const preventLeave = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventLeave);
    return () => {
      window.removeEventListener("beforeunload", preventLeave);
    };
  }, [settingsDirty, rulesDirty]);

  async function run(fn, success = "Сохранено") {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const text = await fn();
      setMessage(text || success);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const updateRule = (rule) =>
    setRules((list) => list.map((r) => (r.key === rule.key ? rule : r)));
  function upload(key, file) {
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
      setRules((list) =>
        list.map((r) => (r.key === key ? { ...r, imageId: data.id } : r)),
      );
    }, "Иллюстрация загружена. Нажмите «Сохранить награды и рекорды».");
  }
  function saveRules() {
    const invalid = rules.filter((rule) => ruleProblem(rule));
    if (invalid.length) {
      setMessage("");
      setError(
        "Исправьте: " +
          invalid
            .map((rule) => "«" + (rule.name.trim() || "Без названия") + "»")
            .join(", "),
      );
      return;
    }
    run(async () => {
      const data = await socialApi("game/admin/rules", "PUT", {
        rules: rules.map(toInput),
      });
      setRules(data.rules);
      setSavedRules(data.rules);
      setRevision((n) => n + 1);
    }, "Награды и рекорды сохранены");
  }
  if (!settings || !rules) return <p role="status">{error || "Загружаем…"}</p>;
  const lists = [
    {
      kind: "award",
      title: "Награды",
      add: "Добавить награду",
      help: "Награда остаётся у человека навсегда, даже если условие потом перестало выполняться. Выдаётся сразу при событии; после нового или изменённого правила нажмите «Пересчитать награды».",
    },
    {
      kind: "record",
      title: "Рекорды",
      add: "Добавить рекорд",
      help: "Рекорд держит один велосипед, покатушка или участник, и лидер может смениться. Считается при каждом открытии страницы рекордов.",
    },
  ];
  return (
    <section className="social-panel game-admin">
      {confirmation}
      <h2>Награды и рекорды</h2>
      <p className="help">
        Каждая награда и каждый рекорд — правило из проверенной метрики, условия
        и фильтров. Участвуют только публичные велосипеды и покатушки
        незаблокированных владельцев; цена — только если владелец её показывает,
        максимальная скорость — только если владелец показывает её в покатушке.
      </p>
      <form
        className="game-settings"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const next = await socialApi(
              "game/admin/settings",
              "PUT",
              settings,
            );
            setSettings(next);
            setSavedSettings(next);
          }, "Параметры рейтинга сохранены");
        }}
      >
        <fieldset disabled={busy}>
          <legend>Параметры рейтинга велосипедов</legend>
          <div className="game-setting-grid">
            {[
              ["minimumCompleteness", "Минимальная заполненность, %", 0, 100],
              ["budgetMinimum", "Минимальная цена: строго выше, ₽", 1, 1e9],
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
                  value={settings[key]}
                  onChange={(e) =>
                    setSettings((v) => ({
                      ...v,
                      [key]: Number(e.target.value),
                    }))
                  }
                />
              </label>
            ))}
          </div>
          <label className="setting-row">
            <span>Реакции сообщества</span>
            <input
              type="checkbox"
              role="switch"
              className="toggle"
              checked={settings.reactionsEnabled}
              onChange={(e) =>
                setSettings((v) => ({
                  ...v,
                  reactionsEnabled: e.target.checked,
                }))
              }
            />
          </label>
          <div className="game-admin-save">
            <button className="button" disabled={busy || !settingsDirty}>
              Сохранить параметры
            </button>
          </div>
        </fieldset>
      </form>
      {lists.map((list) => {
        const items = rules.filter((rule) => rule.kind === list.kind);
        return (
          <section
            className="game-rules"
            key={list.kind}
            aria-labelledby={"game-rules-" + list.kind}
            data-rules={list.kind}
          >
            <div className="game-rules-heading">
              <h3 id={"game-rules-" + list.kind}>
                {list.title} · {items.length}
              </h3>
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => setRules((all) => [...all, newRule(list.kind)])}
              >
                <Plus size={16} />
                {list.add}
              </button>
            </div>
            <p className="help">{list.help}</p>
            <div className="game-rule-list">
              {items.map((rule) => (
                <RuleEditor
                  key={rule.key + ":" + revision}
                  rule={rule}
                  assets={assets}
                  busy={busy}
                  onChange={updateRule}
                  onUpload={(file) => upload(rule.key, file)}
                  onRemove={async () => {
                    if (
                      await ask(
                        "Правило «" +
                          (rule.name.trim() || "Без названия") +
                          "» удалится после сохранения.",
                        {
                          title: "Удалить правило?",
                          confirmLabel: "Удалить",
                          danger: true,
                        },
                      )
                    )
                      setRules((all) => all.filter((r) => r.key !== rule.key));
                  }}
                />
              ))}
            </div>
          </section>
        );
      })}
      <div className="admin-save game-rules-save">
        <span>
          {rulesDirty
            ? "Есть несохранённые изменения"
            : "Награды и рекорды сохранены"}
        </span>
        <div>
          <button
            type="button"
            className="quiet"
            disabled={busy || !rulesDirty}
            onClick={() => {
              setRules(savedRules);
              setRevision((n) => n + 1);
              setError("");
            }}
          >
            Отменить изменения
          </button>
          <button
            type="button"
            className="quiet"
            disabled={busy || rulesDirty}
            title={
              rulesDirty
                ? "Сначала сохраните правила"
                : "Выдать награды за то, что уже сделано"
            }
            onClick={() =>
              run(async () => {
                const result = await socialApi(
                  "game/admin/recalculate",
                  "POST",
                );
                return "Пересчитано. Выдано наград: " + result.awarded;
              })
            }
          >
            <RefreshCw size={16} />
            Пересчитать награды
          </button>
          <button
            type="button"
            className="button"
            disabled={busy || !rulesDirty}
            onClick={saveRules}
          >
            <Save size={17} />
            Сохранить награды и рекорды
          </button>
        </div>
      </div>
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
          <a href={publicPath("bike", b)}>{b.name}</a>
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
