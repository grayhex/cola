"use client";
import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Check, Plus, Trash2 } from "lucide-react";
import { useSite } from "./site-provider.jsx";
import CompactCombo from "./compact-combo.jsx";
import PartIcon from "./part-icon.jsx";
import { factoryComponent } from "../../lib/factory-components.js";
import { groupedComponents } from "../../lib/garage-layout.js";
import { bicycleName, draftId } from "../../lib/wizard-options.js";
import { bikeInput, componentInput } from "../../lib/validation.js";
const steps = ["Модель", "Поиск комплектации", "Компоненты", "Детали и фото"];
const failures = {
  unsupported_brand: "Этот производитель пока не поддерживается.",
  not_found: "Комплектация не найдена.",
  upstream_unavailable: "Сервис или сайт производителя недоступен.",
  parse_error: "Не удалось прочитать комплектацию страницы.",
};
async function api(path, body, signal) {
  const r = await fetch("/api/bikes/" + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "Не удалось выполнить запрос");
  return d;
}
function Progress({ text }) {
  return (
    <div className="resolver-progress" role="status">
      <span>
        <LoaderCircle size={16} className="resolver-spinner" />
        {text}
      </span>
      <div className="resolver-track" role="progressbar" aria-label={text}>
        <i />
      </div>
    </div>
  );
}
export default function BikeWizard({ onCreated, onBusy }) {
  const { catalog, settings } = useSite();
  const [step, setStep] = useState(0),
    [bike, setBike] = useState({
      brand: "",
      model: "",
      trim: "",
      year: "",
      name: "",
      category: "gravel",
      description: "",
      color: "",
      size: "",
      weight: "",
      price: "",
      mileage: 0,
      manufacturer_url: "",
      is_public: false,
      show_bike_price: false,
      show_component_prices: false,
      show_accessory_prices: false,
    });
  const [parts, setParts] = useState([]),
    [result, setResult] = useState(null),
    [url, setUrl] = useState(""),
    [message, setMessage] = useState(""),
    [resolving, setResolving] = useState(false),
    [error, setError] = useState(""),
    [photos, setPhotos] = useState(null),
    [chosen, setChosen] = useState([]),
    [files, setFiles] = useState([]),
    [photoBusy, setPhotoBusy] = useState(false),
    [photoError, setPhotoError] = useState(""),
    [saving, setSaving] = useState(false),
    [savedId, setSavedId] = useState(null),
    [openGroup, setOpenGroup] = useState(null);
  const query = {
      brand: bike.brand.trim(),
      model: bike.model.trim(),
      trim: bike.trim.trim() || null,
      year: Number(bike.year),
    },
    key = JSON.stringify(query);
  const started = useRef(""),
    acceptedIdentity = useRef(""),
    requestId = useRef(null),
    resolveAbort = useRef(),
    photoAbort = useRef(),
    heading = useRef(),
    fileRefs = useRef([]),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    requestId.current ||= draftId();
    return () => {
      alive.current = false;
      resolveAbort.current?.abort();
      photoAbort.current?.abort();
      fileRefs.current.forEach((f) => URL.revokeObjectURL(f.preview));
    };
  }, []);
  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  useEffect(() => {
    fileRefs.current = files;
  }, [files]);
  useEffect(() => {
    onBusy?.(saving);
    return () => onBusy?.(false);
  }, [saving, onBusy]);
  useEffect(() => {
    const warn = (e) => {
      if (bike.brand || parts.length) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [bike.brand, parts.length]);
  const update = (k, v) => setBike((b) => ({ ...b, [k]: v }));
  async function resolve(sourceUrl = "", candidateId) {
    if (
      parts.length &&
      !window.confirm(
        "Повторный поиск заменит черновик комплектации. Продолжить?",
      )
    )
      return;
    resolveAbort.current?.abort();
    const controller = new AbortController();
    resolveAbort.current = controller;
    setResolving(true);
    setError("");
    setMessage(
      sourceUrl
        ? "Читаем страницу магазина…"
        : "Производитель поддерживается. Ищем заводскую комплектацию…",
    );
    try {
      const d = await api(
        "resolve",
        {
          ...query,
          ...(sourceUrl ? { sourceUrl } : candidateId ? { candidateId } : {}),
        },
        AbortSignal.any([controller.signal, AbortSignal.timeout(95000)]),
      );
      if (controller.signal.aborted || !alive.current) return;
      setResult(d);
      setMessage(
        d.status === "resolved"
          ? "Комплектация найдена. На следующем шаге её можно изменить."
          : failures[d.status] || "Нужно уточнить вариант модели.",
      );
      if (d.status === "resolved") {
        photoAbort.current?.abort();
        setPhotoBusy(false);
        setParts(
          d.components.map((c) => ({
            ...factoryComponent(c),
            id: draftId(),
            url: "",
            group_id:
              catalog.componentGroups.find((g) =>
                g.categories.includes(factoryComponent(c).category),
              )?.id || "",
          })),
        );
        setPhotos(null);
        setChosen([]);
        setOpenGroup(null);
      } else if (sourceUrl)
        setMessage(
          (failures[d.status] || "Не удалось распознать страницу.") +
            " Попробуйте другую страницу магазина или заполните компоненты вручную.",
        );
    } catch (e) {
      if (!controller.signal.aborted) {
        setMessage(
          "Не удалось выполнить поиск. Попробуйте ссылку на другую страницу магазина или продолжите вручную.",
        );
        setResult(null);
      }
    } finally {
      if (resolveAbort.current === controller) {
        setResolving(false);
      }
    }
  }
  useEffect(() => {
    if (step !== 1 || started.current === key) return;
    started.current = key;
    let cancelled = false;
    const controller = new AbortController();
    resolveAbort.current = controller;
    setMessage("Проверяем поддержку производителя…");
    setResolving(true);
    api("resolver-brands", undefined, controller.signal)
      .then((config) => {
        if (cancelled || controller.signal.aborted) return;
        setResolving(false);
        const supported = config.brands?.some(
          (b) =>
            b.enabled && b.name.toLowerCase() === query.brand.toLowerCase(),
        );
        if (supported) resolve();
        else
          setMessage(
            "Этот производитель пока не поддерживается или отключён. Укажите страницу магазина — попробуем прочитать её комплектацию.",
          );
      })
      .catch(() => {
        if (!cancelled && !controller.signal.aborted) {
          setResolving(false);
          setMessage(
            "Парсер недоступен. Можно попробовать позже или заполнить компоненты вручную.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [step, key]);
  async function searchPhotos() {
    photoAbort.current?.abort();
    const controller = new AbortController();
    photoAbort.current = controller;
    setPhotoBusy(true);
    setPhotoError("");
    try {
      const d = await api(
        "photo-search",
        {
          ...query,
          ...(result?.status === "resolved"
            ? { sourceUrl: result.source.url }
            : /^https?:\/\//i.test(url)
              ? { sourceUrl: url }
              : {}),
        },
        AbortSignal.any([controller.signal, AbortSignal.timeout(95000)]),
      );
      if (!controller.signal.aborted && alive.current) {
        setPhotos(d.photos);
        setChosen([]);
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        setPhotos([]);
        setPhotoError(
          "Фотографии не найдены или источник недоступен. Загрузите свои фото либо повторите поиск.",
        );
      }
    } finally {
      if (photoAbort.current === controller) setPhotoBusy(false);
    }
  }
  useEffect(() => {
    if (step === 3 && photos === null && !photoBusy) searchPhotos();
  }, [step]);
  const groups = groupedComponents(parts, catalog.componentGroups);
  function addPart(group) {
    const category = group.categories[0] || catalog.partCategories.build[0];
    setParts((p) => [
      ...p,
      {
        id: draftId(),
        category,
        name: "",
        notes: "",
        price: null,
        url: "",
        group_id: group.id,
        section: catalog.partCategories.accessories.includes(category)
          ? "accessories"
          : "build",
      },
    ]);
    setOpenGroup(group.id);
  }
  function edit(id, k, v) {
    setParts((p) => p.map((c) => (c.id === id ? { ...c, [k]: v } : c)));
  }
  function next() {
    setError("");
    if (step === 0) {
      if (
        !query.brand ||
        !query.model ||
        !Number.isInteger(query.year) ||
        query.year < 1900 ||
        query.year > 2100
      ) {
        setError("Укажите производителя, модель и корректный год.");
        return;
      }
      if (acceptedIdentity.current && acceptedIdentity.current !== key) {
        if (
          parts.length &&
          !window.confirm(
            "Идентификация изменилась. Сбросить предыдущую комплектацию и найденные фото?",
          )
        )
          return;
        setParts([]);
        photoAbort.current?.abort();
        setPhotoBusy(false);
        setResult(null);
        setPhotos(null);
        setChosen([]);
        setUrl("");
        started.current = "";
      }
      acceptedIdentity.current = key;
    }
    if (step === 2) {
      const invalid = parts.find((p) => !componentInput.safeParse(p).success);
      if (invalid) {
        setOpenGroup(
          groups.find((g) => g.components.some((p) => p.id === invalid.id))?.id,
        );
        setError(
          "Проверьте название, категорию, стоимость и ссылку компонента: " +
            (invalid.name || invalid.category) +
            ". Пустую строку можно удалить.",
        );
        return;
      }
    }
    setStep((s) => Math.min(3, s + 1));
  }
  async function save() {
    const fields = {
      ...bike,
      name: bicycleName(bike),
      brand: query.brand,
      model: query.model,
      trim: query.trim || "",
      year: query.year,
      price: bike.price === "" ? null : Number(bike.price),
      weight: bike.weight === "" ? null : Number(bike.weight),
      mileage: Number(bike.mileage),
    };
    if (!savedId && !bikeInput.safeParse(fields).success) {
      setError(
        "Проверьте дополнительные поля: вес должен быть больше нуля, пробег — целым неотрицательным числом, стоимость — неотрицательной, ссылка — HTTP/HTTPS.",
      );
      return;
    }
    setSaving(true);
    setError("");
    let id = savedId;
    try {
      if (!id) {
        const data = await api("wizard", {
          requestId: requestId.current,
          previewId: result?.status === "resolved" ? result.previewId : null,
          bike: fields,
          components: parts.map(({ id, ...p }) => ({
            ...p,
            price: p.price === "" ? null : p.price,
          })),
        });
        id = data.id;
        setSavedId(id);
      }
      if (chosen.length) {
        await api(id + "/photos/import", { ids: chosen });
        setChosen([]);
      }
      for (const item of files) {
        const r = await fetch("/api/bikes/" + id + "/photos", {
          method: "POST",
          headers: { "Content-Type": item.file.type },
          body: item.file,
        });
        if (!r.ok) {
          const d = await r.json();
          throw new Error(d.error || "Не удалось загрузить фото");
        }
        URL.revokeObjectURL(item.preview);
        setFiles((f) => f.filter((x) => x.id !== item.id));
      }
      await onCreated(id);
    } catch (e) {
      setError((id ? "Велосипед уже сохранён. " : "") + e.message);
    } finally {
      if (alive.current) setSaving(false);
    }
  }
  return (
    <form
      noValidate
      className="bike-wizard"
      onSubmit={(e) => {
        e.preventDefault();
        if (step < 3) next();
        else save();
      }}
    >
      <nav aria-label="Шаги добавления" className="wizard-steps">
        {steps.map((s, i) => (
          <button
            type="button"
            key={s}
            aria-current={step === i ? "step" : undefined}
            disabled={i > step || resolving || saving || !!savedId}
            onClick={() => setStep(i)}
          >
            <span>{i < step ? <Check size={14} /> : i + 1}</span>
            <small>{s}</small>
          </button>
        ))}
      </nav>
      <progress
        className="wizard-progress"
        value={step + 1}
        max={4}
        aria-label={`Шаг ${step + 1} из 4`}
      />
      <h3 ref={heading} tabIndex={-1}>
        {steps[step]} <small>{step + 1} / 4</small>
      </h3>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <fieldset disabled={saving || !!savedId} className="wizard-content">
        {step === 0 && (
          <>
            <p className="help">
              Сначала определим модель и заводскую комплектацию. Обязательны
              производитель, модель и год.
            </p>
            <label className="field">
              <span>Тип велосипеда</span>
              <select
                value={bike.category}
                onChange={(e) => update("category", e.target.value)}
              >
                {Object.entries(catalog.categories).map(([k, v]) => (
                  <option value={k} key={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-grid">
              <CompactCombo
                label="Производитель"
                value={bike.brand}
                onChange={(v) => update("brand", v)}
                options={[
                  ...new Set(
                    Object.values(catalog.models).flatMap(Object.keys),
                  ),
                ]}
                required
                maxLength={60}
              />
              <CompactCombo
                label="Модель"
                value={bike.model}
                onChange={(v) => update("model", v)}
                options={Object.entries(catalog.models[bike.category]||{}).filter(([brand])=>brand.toLowerCase()===bike.brand.trim().toLowerCase()).flatMap(([,models])=>models)}
                required
                maxLength={100}
              />
              <label className="field">
                <span>Год</span>
                <input
                  required
                  type="number"
                  min={1900}
                  max={2100}
                  value={bike.year}
                  onChange={(e) => update("year", e.target.value)}
                />
              </label>
              <label className="field">
                <span>Комплектация / версия</span>
                <input
                  maxLength={100}
                  value={bike.trim}
                  onChange={(e) => update("trim", e.target.value)}
                  placeholder="SL / CF SLX 8 AXS"
                />
              </label>
            </div>
            <div className="wizard-optional">
              <label className="field">
                <span>Название в гараже · необязательно</span>
                <input
                  maxLength={100}
                  value={bike.name}
                  placeholder=""
                  onChange={(e) => update("name", e.target.value)}
                />
              </label>
              <p className="help">
                Можно оставить пустым — используем название модели.
              </p>
            </div>
          </>
        )}
        {step === 1 && (
          <>
            <p className="wizard-identity">
              {[query.brand, query.model, query.trim, query.year]
                .filter(Boolean)
                .join(" ")}
            </p>
            <p role="status">{message}</p>
            {resolving ? (
              <>
                <Progress text="Идентификация и парсинг…" />
                <button
                  type="button"
                  className="quiet"
                  onClick={() => {
                    resolveAbort.current?.abort();
                    setResolving(false);
                    setMessage("Поиск остановлен. Можно заполнить вручную.");
                  }}
                >
                  Остановить поиск
                </button>
              </>
            ) : (
              <>
                {result?.status === "resolved" && (
                  <div className="wizard-found">
                    <Check size={18} />
                    <span>
                      {result.components.length} компонентов ·{" "}
                      {result.bike.canonicalName}
                      <small>
                        <a
                          href={result.source.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Источник комплектации
                        </a>
                      </small>
                    </span>
                  </div>
                )}
                {result?.manualSelection && (
                  <p className="help">
                    Сверьте год и версию модели. Ссылка выбрана вручную;
                    автоматическое совпадение не подтверждено.
                  </p>
                )}
                {result?.status === "ambiguous" &&
                  result.candidates.map((c) => (
                    <button
                      type="button"
                      className="wizard-candidate"
                      key={c.candidateId}
                      disabled={c.year !== query.year}
                      onClick={() => resolve("", c.candidateId)}
                    >
                      {c.canonicalName} · {c.year || "год не подтверждён"}
                    </button>
                  ))}
                <details open={result?.status !== "resolved"}>
                  <summary>Распознать по странице магазина</summary>
                  <p className="help">
                    Вставьте ссылку на товар с таблицей характеристик. Если
                    страница не распознаётся, попробуйте другой магазин. Все
                    публичные сайты доступны, кроме запрещённых администратором.
                  </p>
                  <label className="field">
                    <span>Страница велосипеда</span>
                    <input
                      type="url"
                      value={url}
                      maxLength={2048}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://…"
                    />
                  </label>
                  <button
                    className="button secondary"
                    type="button"
                    disabled={!/^https?:\/\//i.test(url)}
                    onClick={() => resolve(url)}
                  >
                    Распознать страницу
                  </button>
                </details>
                <button
                  type="button"
                  className="quiet"
                  onClick={() => {
                    setResult(null);
                    setStep(2);
                  }}
                >
                  Заполнить без парсера
                </button>
              </>
            )}
          </>
        )}
        {step === 2 && (
          <>
            <p className="help">
              Проверьте найденные компоненты или добавьте свои по группам. Можно
              оставить комплектацию пустой и дополнить позже.
            </p>
            <div className="wizard-group-add">
              {catalog.componentGroups.map((g) => (
                <button
                  type="button"
                  className="quiet"
                  key={g.id}
                  onClick={() => addPart(g)}
                >
                  <PartIcon name={g.icon} size={16} />
                  <Plus size={12} />
                  {g.name}
                </button>
              ))}
            </div>
            {groups.map((g) => (
              <details
                key={g.id}
                open={
                  openGroup === g.id || (!openGroup && groups[0]?.id === g.id)
                }
                onToggle={(e) => {
                  if (e.currentTarget.open) setOpenGroup(g.id);
                }}
                className="wizard-part-group"
              >
                <summary>
                  <PartIcon name={g.icon} size={18} />
                  {g.name}
                  <small>{g.components.length}</small>
                </summary>
                {g.components.map((p) => (
                  <div key={p.id} className="wizard-part">
                    <CompactCombo
                      label="Категория"
                      value={p.category}
                      onChange={(v) => edit(p.id, "category", v)}
                      options={[
                        ...catalog.partCategories.build,
                        ...catalog.partCategories.accessories,
                      ]}
                      required
                      maxLength={60}
                    />
                    <CompactCombo
                      label="Компонент"
                      value={p.name}
                      onChange={(v) => edit(p.id, "name", v)}
                      options={catalog.parts[p.category] || []}
                      required
                    />
                    <button
                      type="button"
                      className="icon danger"
                      aria-label={"Удалить " + (p.name || p.category)}
                      onClick={() =>
                        setParts((a) => a.filter((x) => x.id !== p.id))
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                    <details className="wizard-part-extra">
                      <summary>Ещё: заметка, стоимость, ссылка</summary>
                      <label className="field">
                        <span>Примечание</span>
                        <input
                          maxLength={500}
                          value={p.notes}
                          onChange={(e) => edit(p.id, "notes", e.target.value)}
                        />
                      </label>
                      <label className="field">
                        <span>Стоимость, ₽</span>
                        <input
                          type="number"
                          min={0}
                          max={999999999}
                          step="0.01"
                          value={p.price ?? ""}
                          onChange={(e) =>
                            edit(
                              p.id,
                              "price",
                              e.target.value === ""
                                ? null
                                : Number(e.target.value),
                            )
                          }
                        />
                      </label>
                      <label className="field">
                        <span>Ссылка</span>
                        <input
                          type="url"
                          value={p.url}
                          onChange={(e) => edit(p.id, "url", e.target.value)}
                        />
                      </label>
                      <label className="field">
                        <span>Раздел</span>
                        <select
                          value={p.section}
                          onChange={(e) =>
                            edit(p.id, "section", e.target.value)
                          }
                        >
                          <option value="build">Комплектация</option>
                          <option value="accessories">Аксессуары</option>
                        </select>
                      </label>
                    </details>
                  </div>
                ))}
              </details>
            ))}
          </>
        )}
        {step === 3 && (
          <>
            <section>
              <h4>Фотографии</h4>
              {!files.length && !chosen.length && (
                <div className="wizard-stock-preview">
                  {settings[bike.category + "ImageId"] ? (
                    <img
                      src={"/api/assets/" + settings[bike.category + "ImageId"]}
                      alt={
                        "Стоковое изображение: " +
                        catalog.categories[bike.category]
                      }
                    />
                  ) : (
                    <div className="stock-empty">
                      {catalog.categories[bike.category]} · стандартное
                      изображение пока не загружено
                    </div>
                  )}
                  <small>
                    Стандартное изображение · замените своим или выберите
                    найденное
                  </small>
                </div>
              )}
              <p className="help">
                Ищем автоматически по модели или найденной странице. Проверьте,
                что на фото ваш велосипед; выберите до 3 изображений.
              </p>
              {photoBusy && <Progress text="Ищем фотографии…" />}
              {photoError && <p role="status">{photoError}</p>}
              {photos?.length === 0 && !photoBusy && (
                <p className="help">
                  Подходящих фото нет — можно загрузить свои.
                </p>
              )}
              <div className="photo-candidates">
                {photos?.map((p) => (
                  <label key={p.id}>
                    <input
                      type="checkbox"
                      disabled={
                        (!chosen.includes(p.id) &&
                          (chosen.length >= 3 ||
                            chosen.length + files.length >= 12)) ||
                        photoBusy
                      }
                      checked={chosen.includes(p.id)}
                      onChange={(e) =>
                        setChosen((a) =>
                          e.target.checked
                            ? [...a, p.id]
                            : a.filter((id) => id !== p.id),
                        )
                      }
                    />
                    <img
                      src={"/api/bikes/photo-candidates/" + p.id}
                      alt="Вариант фотографии велосипеда"
                    />
                    <a href={p.sourceUrl} target="_blank" rel="noreferrer">
                      Источник
                    </a>
                  </label>
                ))}
              </div>
              <button
                type="button"
                className="quiet"
                disabled={photoBusy}
                onClick={searchPhotos}
              >
                Повторить поиск фото
              </button>
              <label className="field">
                <span>Или загрузите свои · JPEG, PNG, WebP · до 10 МБ</span>
                <input
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const added = Array.from(e.target.files);
                    if (
                      added.some(
                        (f) =>
                          f.size > 10 * 1024 * 1024 ||
                          !["image/jpeg", "image/png", "image/webp"].includes(
                            f.type,
                          ),
                      ) ||
                      files.length + chosen.length + added.length > 12
                    ) {
                      setError(
                        "Допустимо до 12 фото JPEG/PNG/WebP, каждое до 10 МБ.",
                      );
                      e.target.value = "";
                      return;
                    }
                    setFiles((a) => [
                      ...a,
                      ...added.map((file) => ({
                        id: draftId(),
                        file,
                        preview: URL.createObjectURL(file),
                      })),
                    ]);
                    e.target.value = "";
                  }}
                />
              </label>
              <div className="wizard-local-photos">
                {files.map((f) => (
                  <div key={f.id}>
                    <img src={f.preview} alt={f.file.name} />
                    <button
                      type="button"
                      className="quiet"
                      aria-label={"Убрать " + f.file.name}
                      onClick={() => {
                        URL.revokeObjectURL(f.preview);
                        setFiles((a) => a.filter((x) => x.id !== f.id));
                      }}
                    >
                      Убрать
                    </button>
                  </div>
                ))}
              </div>
            </section>
            <div className="form-grid">
              {[
                ["color", "Цвет"],
                ["size", "Ростовка"],
              ].map(([k, label]) => (
                <label className="field" key={k}>
                  <span>{label}</span>
                  <input
                    maxLength={k === "size" ? 30 : 60}
                    value={bike[k]}
                    onChange={(e) => update(k, e.target.value)}
                  />
                </label>
              ))}
              {[
                ["price", "Стоимость, ₽", 999999999],
                ["mileage", "Текущий пробег, км", 10000000],
                ["weight", "Вес, кг", 100],
              ].map(([k, label, max]) => (
                <label className="field" key={k}>
                  <span>{label}</span>
                  <input
                    type="number"
                    min={k === "weight" ? 0.01 : 0}
                    max={max}
                    step={k === "mileage" ? 1 : 0.01}
                    value={bike[k]}
                    onChange={(e) => update(k, e.target.value)}
                  />
                </label>
              ))}
            </div>
            <label className="field">
              <span>О велосипеде</span>
              <textarea
                maxLength={2000}
                value={bike.description}
                onChange={(e) => update("description", e.target.value)}
              />
            </label>
            <label className="field">
              <span>Сайт производителя</span>
              <input
                type="url"
                maxLength={2048}
                value={bike.manufacturer_url}
                onChange={(e) => update("manufacturer_url", e.target.value)}
              />
            </label>
            <div className="wizard-privacy">
              {[
                ["is_public", "Опубликовать на общей витрине"],
                ["show_bike_price", "Показывать стоимость велосипеда"],
                ["show_component_prices", "Показывать стоимость компонентов"],
                ["show_accessory_prices", "Показывать стоимость аксессуаров"],
              ].map(([k, label]) => (
                <label className="admin-toggle" key={k}>
                  {label}
                  <input
                    type="checkbox"
                    checked={bike[k]}
                    onChange={(e) => update(k, e.target.checked)}
                  />
                </label>
              ))}
              <p className="help">
                По умолчанию велосипед приватный. Включённые цены будут видны по
                витрине и по публичной ссылке.
              </p>
            </div>
          </>
        )}
      </fieldset>
      {saving && <Progress text="Сохраняем велосипед и фотографии…" />}
      {!!savedId && !saving && (
        <button
          type="button"
          className="quiet"
          onClick={() => onCreated(savedId)}
        >
          Открыть сохранённый велосипед без оставшихся фото
        </button>
      )}
      <div className="wizard-actions">
        <button
          type="button"
          className="button secondary"
          disabled={!step || resolving || saving || !!savedId}
          onClick={() => {
            setError("");
            setStep((s) => s - 1);
          }}
        >
          Назад
        </button>
        <button className="button" disabled={resolving || saving}>
          {step === 3
            ? savedId
              ? "Повторить загрузку фото"
              : "Сохранить велосипед"
            : "Далее"}
        </button>
      </div>
    </form>
  );
}
