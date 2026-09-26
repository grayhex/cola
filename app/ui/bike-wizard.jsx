"use client";
import { useConfirmation } from "./confirmation.jsx";
import ClassificationFields from "./bike-classification.jsx";
import { FormerBikeField } from "./bike-fields.jsx";
import fieldStyles from "./bike-fields.module.css";
import SiteIcon from "./site-icon.jsx";
import {
  emptyClassification,
  compatibilityCategory,
} from "../../lib/bike-classification.js";
import { parseBikeSearch } from "../../lib/bike-search-input.js";
import { useCallback, useMemo, useEffect, useRef, useState } from "react";
import {
  Bike,
  LoaderCircle,
  Check,
  Plus,
  Trash2,
  Link,
  Pencil,
} from "./icons.jsx";
import { useSite } from "./site-provider.jsx";
import CompactCombo from "./compact-combo.jsx";
import PartIcon from "./part-icon.jsx";
import { factoryComponent } from "../../lib/factory-components.js";
import { groupedComponents } from "../../lib/garage-layout.js";
import { bicycleName, draftId } from "../../lib/wizard-options.js";
import { bikeInput, componentInput } from "../../lib/validation.js";
import { resolveWithTrace } from "../../lib/resolver-stream.js";
import ResolverTimeline from "./resolver-timeline.jsx";
const steps = ["Поиск комплектации", "Компоненты", "Детали и фото"];
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
export default function BikeWizard({ onCreated, onBusy, onDirtyChange }) {
  const { catalog, settings } = useSite();
  const [ask, confirmation] = useConfirmation();
  const [searchText, setSearchText] = useState("");
  const [step, setStep] = useState(0),
    [bike, setBike] = useState({
      brand: "",
      model: "",
      trim: "",
      year: "",
      name: "",
      category: "",
      classification: { ...emptyClassification },
      description: "",
      color: "",
      size: "",
      weight: "",
      price: "",
      mileage: 0,
      manufacturer_url: "",
      is_public: false,
      is_former: false,
      show_bike_price: false,
      show_component_prices: false,
      show_accessory_prices: false,
    });
  const [parts, setParts] = useState([]),
    [manualMode, setManualMode] = useState(false),
    [identityConfirmed, setIdentityConfirmed] = useState(false),
    [trace, setTrace] = useState([]),
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
  const query = useMemo(
    () => ({
      brand: bike.brand.trim(),
      model: bike.model.trim(),
      trim: bike.trim.trim() || null,
      year: bike.year === "" ? null : Number(bike.year),
    }),
    [bike.brand, bike.model, bike.trim, bike.year],
  );
  const acceptedIdentity = useRef(""),
    requestId = useRef(null),
    resolveAbort = useRef(),
    photoAbort = useRef(),
    heading = useRef(),
    fileRefs = useRef([]),
    alive = useRef(true),
    completed = useRef(false);
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
  const dirty = !!(
    searchText ||
    bike.name ||
    bike.brand ||
    bike.model ||
    bike.trim ||
    bike.year ||
    bike.description ||
    bike.color ||
    bike.size ||
    bike.weight ||
    bike.price ||
    bike.mileage ||
    bike.manufacturer_url ||
    bike.is_public ||
    bike.is_former ||
    bike.show_bike_price ||
    bike.show_component_prices ||
    bike.show_accessory_prices ||
    bike.classification.category ||
    bike.classification.subtype ||
    bike.classification.suspension ||
    bike.classification.construction ||
    bike.classification.electric ||
    bike.classification.fatbike ||
    bike.classification.uses.length ||
    parts.length ||
    files.length ||
    chosen.length ||
    url
  );
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    const warn = (e) => {
      if (!completed.current && dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const update = (k, v) => setBike((b) => ({ ...b, [k]: v }));
  async function resolve(sourceUrl = "", candidateId, identity = query) {
    if (
      parts.length &&
      !(await ask("Повторный поиск заменит черновик комплектации. Продолжить?"))
    )
      return;
    setBike((previous) => ({
      ...previous,
      ...identity,
      trim: identity.trim || "",
      year: identity.year == null ? "" : String(identity.year),
    }));
    acceptedIdentity.current = JSON.stringify(identity);
    resolveAbort.current?.abort();
    const controller = new AbortController();
    resolveAbort.current = controller;
    setResolving(true);
    setTrace([]);
    setError("");
    setMessage(
      sourceUrl
        ? "Читаем страницу магазина…"
        : "Ищем комплектацию: сначала производитель, затем подходящие магазины…",
    );
    try {
      const d = await resolveWithTrace(
        {
          ...identity,
          ...(sourceUrl
            ? { sourceUrl }
            : candidateId
              ? { candidateId }
              : { chooseCandidates: true }),
        },
        AbortSignal.any([controller.signal, AbortSignal.timeout(95000)]),
        (event) => {
          if (!controller.signal.aborted && alive.current)
            setTrace((events) => [...events, event]);
        },
      );
      if (controller.signal.aborted || !alive.current) return;
      if (
        d.status === "resolved" &&
        d.warnings?.includes("identity_mismatch")
      ) {
        const accepted = await ask(
          `Источник описывает «${d.bike.canonicalName}»${d.sourceYear ? ` (${d.sourceYear})` : ""}. Вы указали «${identity.brand} ${identity.model} ${identity.trim || ""} ${identity.year || ""}». Модель или год отличаются. Использовать эту комплектацию?`,
        );
        if (!accepted) {
          setMessage(
            "Импорт отменён. Выберите другую страницу или заполните вручную.",
          );
          return;
        }
        setIdentityConfirmed(true);
      } else setIdentityConfirmed(false);
      setResult(d);
      setMessage(
        d.status === "resolved"
          ? d.quality?.level === "partial"
            ? "Найдена часть комплектации. Проверьте и дополните её на следующем шаге."
            : "Комплектация найдена. На следующем шаге её можно изменить."
          : {
              dns_failed:
                "Не удалось определить адрес сайта (DNS). Попробуйте другой источник.",
              http_403:
                "Сайт отклонил автоматический запрос. Попробуйте страницу магазина.",
              access_challenge:
                "Сайт требует проверку посетителя. Попробуйте другой источник.",
              timeout:
                "Сайт не ответил вовремя. Повторите поиск или выберите другой источник.",
            }[d.reason] ||
              failures[d.status] ||
              "Нужно уточнить вариант модели.",
      );
      if (d.status === "resolved") {
        if (identity.year == null && d.sourceYear)
          update("year", String(d.sourceYear));
        setManualMode(false);
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
          ({
            dns_failed: "Не удалось определить адрес сайта (DNS).",
            http_403: "Сайт отклонил автоматический запрос (HTTP 403).",
            access_challenge: "Сайт требует проверку посетителя.",
          }[d.reason] ||
            failures[d.status] ||
            "Не удалось распознать страницу.") +
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
  async function search(sourceUrl = "") {
    const identity = parseBikeSearch(searchText, catalog.models);
    if (!identity) {
      setError(
        "Введите марку и модель. Год и комплектацию можно добавить, если знаете.",
      );
      return;
    }
    await resolve(sourceUrl, undefined, identity);
  }
  const searchPhotos = useCallback(async () => {
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
        setPhotos(d.photos.slice(0, 3));
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
  }, [query, result, url]);
  useEffect(() => {
    if (
      step === 2 &&
      photos === null &&
      !photoBusy &&
      query.brand &&
      query.model
    )
      searchPhotos();
  }, [step, photos, photoBusy, query.brand, query.model, searchPhotos]);
  const groups = groupedComponents(parts, catalog.componentGroups);
  function addPart(group, chosenCategory) {
    const category =
      chosenCategory || group.categories[0] || catalog.partCategories.build[0];
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
  async function next() {
    setError("");
    if (step === 0) {
      const identity = parseBikeSearch(searchText, catalog.models);
      if (searchText.trim() && !identity) {
        setError(
          "Введите марку и модель или очистите поиск для ручного заполнения.",
        );
        return;
      }
      if (identity) {
        const nextKey = JSON.stringify(identity);
        if (acceptedIdentity.current && acceptedIdentity.current !== nextKey) {
          if (
            parts.length &&
            !(await ask(
              "Идентификация изменилась. Сбросить предыдущую комплектацию и найденные фото?",
            ))
          )
            return;
          setParts([]);
          setResult(null);
          setChosen([]);
          setPhotos(null);
          photoAbort.current?.abort();
          setPhotoBusy(false);
          setIdentityConfirmed(false);
        }
        if (!acceptedIdentity.current || acceptedIdentity.current !== nextKey)
          setBike((previous) => ({
            ...previous,
            ...identity,
            trim: identity.trim || "",
            year: identity.year == null ? "" : String(identity.year),
          }));
        acceptedIdentity.current = nextKey;
      }
    }
    if (step === 1) {
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
    setStep((s) => Math.min(2, s + 1));
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
    if (
      !savedId &&
      (!fields.classification.category || !Number.isInteger(fields.year))
    ) {
      setError(
        "Выберите категорию велосипеда и укажите год на последнем шаге.",
      );
      return;
    }
    if (!savedId && !bikeInput.safeParse(fields).success) {
      setError(
        "Проверьте дополнительные поля: вес должен быть больше нуля, пробег — целым неотрицательным числом, стоимость — неотрицательной, ссылка — HTTP/HTTPS.",
      );
      return;
    }
    let confirmed = identityConfirmed;
    if (
      !savedId &&
      result?.status === "resolved" &&
      (result.sourceYear || result.query?.year) &&
      (result.sourceYear || result.query?.year) !== fields.year
    ) {
      confirmed = await ask(
        `Год источника ${result.sourceYear || result.query?.year} отличается от года велосипеда ${fields.year}. Использовать эту комплектацию?`,
      );
      if (!confirmed) return;
    }
    setSaving(true);
    setError("");
    let id = savedId;
    try {
      if (!id) {
        const data = await api("wizard", {
          requestId: requestId.current,
          identityConfirmed: confirmed,
          previewId: result?.status === "resolved" ? result.previewId : null,
          bike: fields,
          components: parts.map((part) => {
            const component = {
              ...part,
              price: part.price === "" ? null : part.price,
            };
            delete component.id;
            return component;
          }),
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
      completed.current = true;
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
        if (step < 2) next();
        else save();
      }}
    >
      <nav aria-label="Шаги добавления" className="wizard-steps">
        {steps.map((s, i) => (
          <button
            type="button"
            key={s}
            aria-label={`Шаг ${i + 1}: ${s}`}
            aria-current={step === i ? "step" : undefined}
            disabled={i > step || resolving || saving || !!savedId}
            onClick={() => setStep(i)}
          >
            <span>{i < step ? <Check size={14} /> : i + 1}</span>
            <small>{["Поиск", "Сборка", "Детали"][i]}</small>
          </button>
        ))}
      </nav>
      <progress
        className="wizard-progress"
        value={step + 1}
        max={3}
        aria-label={`Шаг ${step + 1} из 3`}
      />
      <h3 ref={heading} tabIndex={-1}>
        {steps[step]} <small>{step + 1} / 3</small>
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
              Введите марку и модель одной строкой. Год и комплектация уточняют
              поиск, но не обязательны. Или продолжите вручную.
            </p>
            <label className="field">
              <span>
                <SiteIcon name="search" /> Модель, год и комплектация
              </span>
              <input
                aria-label="Модель, год и комплектация"
                value={searchText}
                disabled={resolving}
                maxLength={240}
                className={fieldStyles.modelInput}
                onChange={(e) => setSearchText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    search();
                  }
                }}
              />
            </label>
            <label className="field">
              <span>Название в гараже · необязательно</span>
              <input
                value={bike.name}
                maxLength={100}
                onChange={(e) => update("name", e.target.value)}
              />
            </label>
            <p className="wizard-identity">
              {[query.brand, query.model, query.trim, query.year]
                .filter(Boolean)
                .join(" ")}
            </p>
            <p role="status">{message}</p>
            <ResolverTimeline events={trace} running={resolving} />
            {resolving ? (
              <>
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
                      {result.quality && (
                        <small>
                          {result.quality.recognizedComponents} из{" "}
                          {result.quality.totalFields} характеристик распознаны
                        </small>
                      )}
                      <small>
                        <a
                          href={result.source.url}
                          aria-label="Источник комплектации"
                          target="_blank"
                          rel="noreferrer"
                        >
                          {result.source.manufacturer} ·{" "}
                          {result.source.adapter === "manual-url"
                            ? "страница по ссылке"
                            : result.source.adapter === "retailer-search"
                              ? "найденный магазин"
                              : "официальный источник"}
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
                {result?.status === "ambiguous" && (
                  <p className="help">
                    Нашли варианты модели. Выберите свою комплектацию: название,
                    год и источник помогут их различить. Если год не
                    подтверждён, сверьте его перед импортом.
                  </p>
                )}
                {result?.status === "ambiguous" &&
                  result.candidates.map((c) => (
                    <button
                      type="button"
                      className="wizard-candidate"
                      key={c.candidateId}
                      disabled={
                        resolving ||
                        (!c.selectable &&
                          c.year !== null &&
                          query.year != null &&
                          c.year !== query.year)
                      }
                      onClick={() =>
                        c.selectable
                          ? resolve(c.url)
                          : resolve("", c.candidateId)
                      }
                    >
                      {c.thumbnailId ? (
                        <img
                          src={"/api/bikes/photo-candidates/" + c.thumbnailId}
                          alt=""
                          loading="lazy"
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                      ) : (
                        <Bike size={28} />
                      )}
                      <span>
                        <strong>{c.canonicalName}</strong>
                        <small>
                          {c.year || "Год не подтверждён"} ·{" "}
                          {c.sourceHost || new URL(c.url).hostname}
                        </small>
                        <small>Выбрать комплектацию →</small>
                      </span>
                    </button>
                  ))}
                <div className="wizard-choice-actions">
                  <button
                    type="button"
                    className="button secondary"
                    disabled={!searchText.trim()}
                    onClick={() => search()}
                  >
                    <SiteIcon name="search" />
                    {result || message
                      ? "Повторить автоматический поиск и парсинг"
                      : "Найти комплектацию"}
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => setManualMode((v) => !v)}
                  >
                    <Link size={18} />
                    {settings.wizardLinkLabel ||
                      "Распознать по странице магазина"}
                  </button>
                  <button type="button" className="button secondary" onClick={next}>
                    <Pencil size={18} />
                    {settings.wizardManualLabel || "Заполнить вручную"}
                  </button>
                </div>
                {manualMode && (
                  <section
                    className="wizard-manual"
                    aria-label="Распознавание по ссылке"
                  >
                    <h4>Комплектация по вашей ссылке</h4>
                    <p className="help">
                      Вставьте ссылку на товар с таблицей характеристик. Если
                      страница не распознаётся, попробуйте другой магазин. Все
                      публичные сайты доступны, кроме запрещённых
                      администратором.
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
                      onClick={() => search(url)}
                    >
                      Распознать страницу
                    </button>
                  </section>
                )}
              </>
            )}
          </>
        )}
        {step === 1 && (
          <>
            {!!result?.unknownFields?.length && (
              <details className="resolver-review">
                <summary>
                  Проверить характеристики · {result.unknownFields.length}
                </summary>
                <dl>
                  {result.unknownFields.map((f, i) => (
                    <div key={i}>
                      <dt>{f.label}</dt>
                      <dd>{f.value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="help">
                  Эти строки сохранены в источнике. При необходимости добавьте
                  компонент в подходящую группу.
                </p>
              </details>
            )}
            {!!result?.suggestedMetadata &&
              Object.keys(result.suggestedMetadata).length > 0 && (
                <details className="resolver-review">
                  <summary>Данные велосипеда из источника</summary>
                  <dl>
                    {Object.entries(result.suggestedMetadata).map(
                      ([key, value]) => (
                        <div key={key}>
                          <dt>
                            {{
                              weight: "Вес, кг",
                              weightText: "Вес в источнике",
                              sizes: "Размеры",
                              wheelSize: "Колёса",
                              color: "Цвет",
                              manufacturerProductId: "Артикул",
                            }[key] || key}
                          </dt>
                          <dd>{value}</dd>
                        </div>
                      ),
                    )}
                  </dl>
                  <button
                    type="button"
                    className="quiet"
                    onClick={() =>
                      setBike((b) => ({
                        ...b,
                        ...(result.suggestedMetadata.weight && !b.weight
                          ? { weight: result.suggestedMetadata.weight }
                          : {}),
                        ...(result.suggestedMetadata.color && !b.color
                          ? {
                              color: String(
                                result.suggestedMetadata.color,
                              ).slice(0, 50),
                            }
                          : {}),
                      }))
                    }
                  >
                    Использовать вес и цвет в пустых полях
                  </button>
                </details>
              )}
            <p className="help">
              Проверьте найденные компоненты или добавьте свои по группам. Можно
              оставить комплектацию пустой и дополнить позже.
            </p>
            <details className="wizard-add-picker" open={!parts.length}>
              <summary>Добавить компонент</summary>
              <div className="wizard-group-add">
                {[
                  "Групсет",
                  "Тормоза",
                  "Покрышки",
                  "Вилка",
                  "Седло",
                  "Руль",
                  "Педали",
                ].map((category) => {
                  const g = catalog.componentGroups.find((g) =>
                    g.categories.includes(category),
                  ) || {
                    id: "other",
                    icon: "wrench",
                    name: category,
                    categories: [category],
                  };
                  return (
                    <button
                      type="button"
                      className="quiet"
                      key={category}
                      onClick={() => addPart(g, category)}
                    >
                      <PartIcon name={g.icon} size={16} />
                      <Plus size={12} />
                      {category === "Групсет" ? "Трансмиссия" : category}
                    </button>
                  );
                })}
              </div>
            </details>
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
        {step === 2 && (
          <>
            <FormerBikeField value={bike.is_former}
              onChange={(value) => update("is_former", value)} />
            <ClassificationFields
              value={bike.classification}
              onChange={(classification) =>
                setBike((v) => ({
                  ...v,
                  classification,
                  category: compatibilityCategory(classification),
                }))
              }
            />
            <div className="form-grid">
              <label className="field">
                <span>
                  <SiteIcon name="date" /> Год
                </span>
                <input
                  aria-label="Год"
                  type="number"
                  min="1900"
                  max="2100"
                  required
                  value={bike.year}
                  onChange={(e) => update("year", e.target.value)}
                />
              </label>
              <label className="field">
                <span>
                  <SiteIcon name="bike" /> Марка
                </span>
                <input
                  aria-label="Марка"
                  maxLength={60}
                  value={bike.brand}
                  onChange={(e) => {
                    update("brand", e.target.value);
                    setResult(null);
                  }}
                />
              </label>
              <label className="field">
                <span>Модель</span>
                <input
                  maxLength={100}
                  value={bike.model}
                  onChange={(e) => {
                    update("model", e.target.value);
                    setResult(null);
                  }}
                />
              </label>
              <label className="field">
                <span>Комплектация / версия</span>
                <input
                  maxLength={100}
                  value={bike.trim}
                  onChange={(e) => {
                    update("trim", e.target.value);
                    setResult(null);
                  }}
                />
              </label>
            </div>
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
                      {catalog.categories[bike.category] || "Велосипед"} ·
                      стандартное изображение пока не загружено
                    </div>
                  )}
                  <small>
                    Стандартное изображение · замените своим или выберите
                    найденное
                  </small>
                </div>
              )}
              <p className="help">
                Выберите до 3 фото вашей модели или загрузите свои.
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
                      onError={() => {
                        setPhotos((a) => a.filter((x) => x.id !== p.id));
                        setChosen((a) => a.filter((id) => id !== p.id));
                      }}
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
                <span>
                  Или загрузите свои · JPEG, PNG, WebP · до 10 МБ · от 600 × 400
                </span>
                <input
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp"
                  onChange={async (e) => {
                    const input = e.target;
                    const added = Array.from(input.files);
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
                      input.value = "";
                      return;
                    }
                    try {
                      for (const file of added) {
                        const bitmap = await createImageBitmap(file);
                        const valid =
                          Math.min(bitmap.width, bitmap.height) >= 400 &&
                          Math.max(bitmap.width, bitmap.height) >= 600;
                        bitmap.close();
                        if (!valid)
                          throw new Error(
                            "Фото слишком маленькое: минимум 600 × 400 пикселей",
                          );
                      }
                    } catch (err) {
                      setError(err.message || "Не удалось прочитать фото");
                      input.value = "";
                      return;
                    }
                    if (!alive.current) return;
                    setError("");
                    setFiles((a) => [
                      ...a,
                      ...added.map((file) => ({
                        id: draftId(),
                        file,
                        preview: URL.createObjectURL(file),
                      })),
                    ]);
                    input.value = "";
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
            <div className="wizard-suggestions">
              {result?.suggestedMetadata?.weight && (
                <button
                  type="button"
                  className="quiet"
                  onClick={() =>
                    update("weight", result.suggestedMetadata.weight)
                  }
                >
                  Вес из источника: {result.suggestedMetadata.weight} кг
                </button>
              )}
              {(result?.suggestedMetadata?.manufacturerUrl ||
                (result?.source &&
                  result.source.adapter !== "manual-url" &&
                  result.source.adapter !== "retailer-search")) && (
                <button
                  type="button"
                  className="quiet"
                  onClick={() =>
                    update(
                      "manufacturer_url",
                      result.suggestedMetadata?.manufacturerUrl ||
                        result.source.url,
                    )
                  }
                >
                  Использовать страницу производителя
                </button>
              )}
            </div>
            <div className="form-grid">
              {[
                ["color", "Цвет"],
                ["size", "Ростовка"],
              ].map(([k, label]) => (
                <CompactCombo
                  key={k}
                  label={label}
                  value={bike[k]}
                  onChange={(v) => update(k, v)}
                  maxLength={k === "size" ? 30 : 50}
                  options={
                    k === "size"
                      ? catalog.sizes || ["XS", "S", "M", "L", "XL"]
                      : [result?.suggestedMetadata?.color].filter(Boolean)
                  }
                />
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
            <details className="wizard-optional">
              <summary>Описание · необязательно</summary>
              <label className="field">
                <span>О велосипеде</span>
                <textarea
                  maxLength={2000}
                  value={bike.description}
                  onChange={(e) => update("description", e.target.value)}
                />
              </label>
            </details>
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
                <label className="setting-row" key={k}>
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
          onClick={() => {
            completed.current = true;
            onCreated(savedId);
          }}
        >
          Открыть сохранённый велосипед без оставшихся фото
        </button>
      )}
      {confirmation}
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
          {step === 2
            ? savedId
              ? "Повторить загрузку фото"
              : "Сохранить велосипед"
            : "Далее"}
        </button>
      </div>
    </form>
  );
}
