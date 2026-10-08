"use client";
import type {
  ApiError,
  BikePhotoCandidate,
  Classification,
  ComponentInput,
  SiteCatalog,
} from "../../lib/contracts.ts";
import type { BikeDraft } from "./garage/types.ts";
import type { ResolveResult } from "../../lib/bike-resolver-client.ts";
import type { TraceEvent } from "../../lib/resolver-stream.ts";
type WizardBike = Required<
  Omit<
    BikeDraft,
    | "classification"
    | "mileage"
    | "factory_spec"
    | "trim"
    | "purposes"
    | "importFactory"
    | "factoryCandidateId"
    | "factorySourceUrl"
    | "initializeCurrent"
  >
> & { classification: Classification; mileage: number | string; trim: string };
type WizardPart = Omit<ComponentInput, "price"> & {
  id: string;
  price: number | string | null;
};
type UploadFile = { id: string; file: File; preview: string };
import { errorMessage } from "../../lib/errors.ts";
import {
  checkPhotoFile,
  photoLimitText,
  photoTooSmall,
  photoUnreadable,
  photosPerBike,
  sendBikePhoto,
  tooManyPhotos,
  type PhotoProblem,
} from "../../lib/photo-upload.ts";
import PhotoProblems from "./photo-problems.tsx";
import PhotoControl from "./photo-control.tsx";
import { thumbnailOf } from "./photo-thumbnail.ts";
import EmailPolicyAction from "./email-policy-action.tsx";
import { useConfirmation } from "./confirmation.tsx";
import ClassificationFields from "./bike-classification.tsx";
import {
  FormerBikeField,
  PriceVisibilityField,
  PrivacyField,
} from "./bike-fields.tsx";
import fieldStyles from "./bike-fields.module.css";
import SiteIcon from "./site-icon.tsx";
import {
  emptyClassification,
  compatibilityCategory,
} from "../../lib/bike-classification.ts";
import { parseBikeSearch } from "../../lib/bike-search-input.ts";
import {
  useCallback,
  useMemo,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { LoaderCircle, Check, Plus, Trash2 } from "./icons.tsx";
import { useSite } from "./site-provider.tsx";
import CompactCombo from "./compact-combo.tsx";
import PartIcon from "./part-icon.tsx";
import { factoryEntries } from "../../lib/factory-components.ts";
import { groupedComponents } from "../../lib/garage-layout.ts";
import { bicycleName, draftId } from "../../lib/wizard-options.ts";
import { bikeInput, componentInput } from "../../lib/validation.ts";
import { resolveWithTrace } from "../../lib/resolver-stream.ts";
import ResolverTimeline from "./resolver-timeline.tsx";
import {
  ResolverCandidateCard,
  ResolverSearchReport,
  officialSource,
  sourceLabel,
} from "./resolver-candidates.tsx";
// #370: search first, then what the bike is (with photos), then its parts —
// the bike is created after the last step. Search is optional: «Продолжить
// вручную» leaves the first step from any state of it.
const steps = ["Поиск", "Сведения и фото", "Комплектация"];
const stepWords = ["Поиск", "Сведения", "Сборка"];
// Fields of the bike that the second step checks, by the key of the input.
const detailLabels: Record<string, string> = {
  brand: "Марка",
  model: "Модель",
  year: "Год",
  trim: "Комплектация / версия",
  name: "Своё название",
  description: "Описание",
  color: "Цвет",
  size: "Ростовка",
  weight: "Вес",
  mileage: "Текущий пробег",
  price: "Стоимость",
  manufacturer_url: "Сайт производителя",
};
const detailHints: Record<string, string> = {
  weight: "вес должен быть больше нуля",
  mileage: "пробег — целое неотрицательное число",
  price: "стоимость — неотрицательное число",
  manufacturer_url: "ссылка должна начинаться с http:// или https://",
};
// The id of the control to bring into view when its key is the first wrong one.
const detailIds: Record<string, string> = {
  brand: "wizard-brand",
  model: "wizard-model",
  year: "wizard-year",
  trim: "wizard-trim",
  name: "wizard-name",
  description: "wizard-description",
  weight: "wizard-weight",
  mileage: "wizard-mileage",
  price: "wizard-price",
  manufacturer_url: "wizard-manufacturer",
};
const failures: Record<string, string> = {
  unsupported_brand:
    "Автоподбор сейчас недоступен для этой марки. Вставьте ссылку на страницу магазина или заполните комплектацию вручную.",
  not_found:
    "Комплектация не найдена в проверенных источниках. Уточните название или вставьте ссылку на страницу магазина.",
  upstream_unavailable:
    "Часть источников недоступна. Повторите поиск позже или вставьте ссылку на страницу.",
  parse_error: "Не удалось прочитать комплектацию страницы.",
};
async function api<T = unknown>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const r = await fetch("/api/bikes/" + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  // A proxy in front of the server may answer in HTML, or not at all.
  const text = await r.text();
  let d: (T & Partial<ApiError>) | null;
  try {
    d = JSON.parse(text);
  } catch {
    d = null;
  }
  if (!r.ok)
    throw new Error(
      d?.error ||
        (r.status === 413
          ? "Запрос слишком большой для сервера."
          : "Не удалось выполнить запрос"),
    );
  if (!d) throw new Error("Сервер ответил не так, как ожидалось. Повторите.");
  return d;
}
function Progress({ text }: { text: string }) {
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
export default function BikeWizard({
  onCreated,
  onBusy,
  onDirtyChange,
}: {
  onCreated: (id: string) => Promise<void> | void;
  onBusy?: (busy: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { catalog, settings } = useSite();
  const [ask, confirmation] = useConfirmation();
  const [searchText, setSearchText] = useState("");
  const [step, setStep] = useState(0),
    [bike, setBike] = useState<WizardBike>({
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
      is_public: true,
      is_former: false,
      show_bike_price: false,
      show_component_prices: false,
      show_accessory_prices: false,
    });
  const [parts, setParts] = useState<WizardPart[]>([]),
    [manualMode, setManualMode] = useState(false),
    [identityConfirmed, setIdentityConfirmed] = useState(false),
    [trace, setTrace] = useState<TraceEvent[]>([]),
    [result, setResult] = useState<
      (ResolveResult & { previewId?: string }) | null
    >(null),
    [url, setUrl] = useState(""),
    [message, setMessage] = useState(""),
    [resolving, setResolving] = useState(false),
    [error, setError] = useState(""),
    [photos, setPhotos] = useState<BikePhotoCandidate[] | null>(null),
    [chosen, setChosen] = useState<string[]>([]),
    [files, setFiles] = useState<UploadFile[]>([]),
    [photoBusy, setPhotoBusy] = useState(false),
    [photoError, setPhotoError] = useState(""),
    [photoProblems, setPhotoProblems] = useState<PhotoProblem[]>([]),
    // The photo the control acts on, and the one chosen as the cover: keys of
    // the draft («found:…», «local:…»), so a choice does not depend on the order
    // the photos are sent in (#370). Without a choice the first one leads.
    [selectedPhoto, setSelectedPhoto] = useState<string | null>(null),
    [coverPhoto, setCoverPhoto] = useState<string | null>(null),
    // The request the shown result answers (the typed identity and the link):
    // it counts as «found» only while the fields still say the same.
    [resultKey, setResultKey] = useState(""),
    // Optional fields that hold an input stay open when it is the one to fix.
    [openName, setOpenName] = useState(false),
    [openDescription, setOpenDescription] = useState(false),
    [saving, setSaving] = useState(false),
    [savedId, setSavedId] = useState<string | null>(null),
    [openGroup, setOpenGroup] = useState<string | null | undefined>(null);
  const query = useMemo(
    () => ({
      brand: bike.brand.trim(),
      model: bike.model.trim(),
      trim: bike.trim.trim() || null,
      year: bike.year === "" ? null : Number(bike.year),
    }),
    [bike.brand, bike.model, bike.trim, bike.year],
  );
  // Everything that will go to the bike as a photo: the found ones chosen above,
  // then the files added by hand.
  const draftPhotos = [
    ...chosen.map((id) => ({
      key: "found:" + id,
      kind: "found" as const,
    })),
    ...files.map((f) => ({
      key: "local:" + f.id,
      kind: "local" as const,
    })),
  ];
  const selectedDraft =
    draftPhotos.find((p) => p.key === selectedPhoto) || draftPhotos[0] || null;
  const coverDraft =
    draftPhotos.find((p) => p.key === coverPhoto) || draftPhotos[0] || null;
  // The name a photo of the draft goes by: the file's own, or «found». Read
  // from the file where it is shown, not carried in the list of pictures.
  const draftLabel = (key: string) =>
    files.find((f) => "local:" + f.id === key)?.file.name ?? "Найденное фото";
  // One thumbnail of the draft; the picture is given by the caller, which knows
  // where it comes from (a found photo's address, or a chosen file).
  const draftThumb = (
    key: string,
    kind: "found" | "local",
    i: number,
    picture: ReactNode,
  ) => (
    <li key={key} data-kind={kind}>
      <button
        type="button"
        className={"thumb" + (key === selectedDraft?.key ? " active" : "")}
        aria-label={`Фото ${i + 1}: ${draftLabel(key)}${key === coverDraft?.key ? ", обложка" : ""}`}
        aria-current={key === selectedDraft?.key ? "true" : undefined}
        onClick={() => setSelectedPhoto(key)}
      >
        {picture}
        {key === coverDraft?.key && (
          <span className="photo-cover-mark">Обложка</span>
        )}
      </button>
    </li>
  );
  const acceptedIdentity = useRef(""),
    requestId = useRef<string | null>(null),
    resolveAbort = useRef<AbortController | null>(null),
    photoAbort = useRef<AbortController | null>(null),
    heading = useRef<HTMLHeadingElement | null>(null),
    fileInput = useRef<HTMLInputElement | null>(null),
    // What the saved bike holds of the draft: draft key → photo id, in the
    // order the server took them; the cover is set from here once they are in.
    savedPhotos = useRef(new Map<string, string>()),
    firstSaved = useRef<string | null>(null),
    wantedCover = useRef<string | null>(null),
    coverSet = useRef<string | null>(null),
    alive = useRef(true),
    completed = useRef(false);
  useEffect(() => {
    alive.current = true;
    requestId.current ||= draftId();
    return () => {
      alive.current = false;
      resolveAbort.current?.abort();
      photoAbort.current?.abort();
    };
  }, []);
  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  // The reasons a photo was refused are shown where the files are chosen, which
  // may be out of sight when a save has just run.
  useEffect(() => {
    if (photoProblems.length)
      document
        .getElementById("wizard-photo-problems")
        ?.scrollIntoView({ block: "nearest" });
  }, [photoProblems]);
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
    !bike.is_public ||
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
    const warn = (e: BeforeUnloadEvent) => {
      if (!completed.current && dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const update = <K extends keyof WizardBike>(k: K, v: WizardBike[K]) =>
    setBike((b) => ({ ...b, [k]: v }));
  // Search is optional (#370): the first step is left by «Далее» when what
  // was typed has been found, and by «Продолжить вручную» in every other
  // state — nothing typed, a failed or a cancelled search, variants none of
  // which fits. The link in the field takes part in «what was typed».
  const typedUrl = url.trim();
  // A link that stands in the field keeps its form open.
  const urlOpen = manualMode || !!typedUrl;
  const typedIdentity = parseBikeSearch(searchText, catalog.models);
  const typedKey = JSON.stringify(typedIdentity) + "|" + typedUrl;
  // After the bike is saved its fields are no longer edited here: what is left
  // is a retry of the photos that did not go.
  const locked = saving || !!savedId;
  // The name a bike gets without one of its own.
  const autoName = bicycleName({
    name: "",
    brand: query.brand,
    model: query.model,
    trim: query.trim || "",
    year: query.year ?? "",
  });
  const answers = result?.status === "resolved" && resultKey === typedKey;
  // While a repeat of that very request runs, its answer is not in yet: the
  // one way on is by hand, which stops it — «Далее» would leave it running to
  // overwrite the draft later.
  const found = answers && !resolving;
  // What stands under the step after a search that found nothing.
  const hint =
    resolving || step !== 0 || !searchText.trim() || found
      ? ""
      : result?.status === "ambiguous"
        ? "Ни один вариант не подходит? Нажмите «Продолжить вручную» и заполните сведения сами."
        : result
          ? "Автоматически комплектацию найти не удалось. Нажмите «Продолжить вручную» и заполните сведения сами."
          : "";
  async function resolve(
    sourceUrl = "",
    candidateId?: string,
    identity = query,
    variant = !!candidateId,
  ) {
    if (
      parts.length &&
      !(await ask("Повторный поиск заменит черновик комплектации. Продолжить?"))
    )
      return;
    // A search by the query replaces a link pasted before it; choosing one of
    // its variants does not.
    if (!sourceUrl && !variant) setUrl("");
    const identityKey = JSON.stringify(identity);
    const otherBike =
      !!acceptedIdentity.current && acceptedIdentity.current !== identityKey;
    // Choosing a variant stays a part of the request that offered it.
    const key = variant ? resultKey : identityKey + "|" + sourceUrl;
    setBike((previous) => ({
      ...previous,
      ...identity,
      trim: identity.trim || "",
      year: identity.year == null ? "" : String(identity.year),
    }));
    acceptedIdentity.current = identityKey;
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
        // A manual continue while the question was open drops the answer: it
        // must not overwrite what is typed by hand.
        if (controller.signal.aborted || !alive.current) return;
        if (!accepted) {
          setMessage(
            variant
              ? "Импорт отменён. Выберите другой вариант или измените запрос."
              : "Импорт отменён. Попробуйте другую страницу магазина.",
          );
          // Refusing a page is an answer to the search: nothing is found.
          if (!variant) setResult(null);
          return;
        }
        setIdentityConfirmed(true);
      } else setIdentityConfirmed(false);
      setResult(d);
      setResultKey(key);
      setMessage(
        d.status === "resolved"
          ? d.warnings?.includes("multiple_builds")
            ? `Страница предлагает несколько комплектаций; взята «${d.bike.canonicalName}». Проверьте компоненты на третьем шаге или выберите другой вариант.`
            : d.quality?.level === "partial"
              ? "Найдена часть комплектации. Проверьте и дополните её на третьем шаге."
              : "Комплектация найдена: сведения попадут на второй шаг, компоненты — на третий."
          : (
              {
                dns_failed:
                  "Не удалось определить адрес сайта (DNS). Попробуйте другой источник.",
                http_403:
                  "Сайт отклонил автоматический запрос. Попробуйте страницу магазина.",
                access_challenge:
                  "Сайт требует проверку посетителя. Попробуйте другой источник.",
                timeout:
                  "Сайт не ответил вовремя. Повторите поиск или выберите другой источник.",
                candidate_expired:
                  "Результаты поиска устарели. Повторите поиск и выберите вариант заново.",
                not_complete_bike:
                  "Эта страница описывает не готовый велосипед (рама, деталь или аксессуар).",
              } as Record<string, string>
            )[("reason" in d ? d.reason : undefined) || ""] ||
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
          factoryEntries(d).map(({ value: c }) => ({
            ...c,
            id: draftId(),
            url: "",
            group_id:
              catalog.componentGroups.find((g) =>
                g.categories.includes(c.category),
              )?.id || "",
          })),
        );
        setPhotos(null);
        setChosen([]);
        setOpenGroup(null);
      } else {
        // What was found for another bike is not a draft of this one.
        if (otherBike) {
          setParts([]);
          setChosen([]);
          setPhotos(null);
          photoAbort.current?.abort();
          setPhotoBusy(false);
        }
        if (sourceUrl)
          setMessage(
            ((
              {
                dns_failed: "Не удалось определить адрес сайта (DNS).",
                http_403: "Сайт отклонил автоматический запрос (HTTP 403).",
                access_challenge: "Сайт требует проверку посетителя.",
              } as Record<string, string>
            )[("reason" in d ? d.reason : undefined) || ""] ||
              failures[d.status] ||
              "Не удалось распознать страницу.") +
              " Попробуйте другую страницу магазина или заполните компоненты вручную.",
          );
      }
    } catch (e) {
      if (!controller.signal.aborted && alive.current) {
        setMessage(
          "Не удалось выполнить поиск. Попробуйте ссылку на другую страницу магазина или продолжите вручную.",
        );
        setResult(null);
      }
    } finally {
      if (resolveAbort.current === controller) setResolving(false);
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
      const d = await api<{ photos: BikePhotoCandidate[] }>(
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
  // Photos are looked up once, on the way into «Сведения и фото», for what
  // the search step left in the fields. Typing a brand or a model there does
  // not start a lookup on every key: «Повторить поиск фото» does it on demand.
  useEffect(() => {
    if (step === 1 && photos === null && !photoBusy)
      if (query.brand && query.model) void searchPhotos();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on entering the step only
  }, [step]);
  const groups = groupedComponents(parts, catalog.componentGroups);
  function addPart(
    group: SiteCatalog["componentGroups"][number],
    chosenCategory?: string,
  ) {
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
  function edit<K extends keyof WizardPart>(
    id: string,
    k: K,
    v: WizardPart[K],
  ) {
    setParts((p) => p.map((c) => (c.id === id ? { ...c, [k]: v } : c)));
  }
  // What the bike's own fields must satisfy to save: the identity the server
  // builds a name from, the category and the year, then the shared schema.
  // The first wrong field, with the optional blocks that hold it opened.
  function bikeFields() {
    return {
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
  }
  function detailsProblem(): { message: string; key?: string } | null {
    const fields = bikeFields();
    if (!fields.brand || !fields.model)
      return {
        message: "Укажите марку и модель.",
        key: fields.brand ? "model" : "brand",
      };
    if (!Number.isInteger(fields.year))
      return { message: "Укажите год выпуска.", key: "year" };
    if (!fields.classification.category)
      return { message: "Выберите категорию велосипеда.", key: "category" };
    const parsed = bikeInput.safeParse(fields);
    if (parsed.success) return null;
    const key = String(parsed.error.issues[0]?.path[0] ?? "");
    const label = detailLabels[key];
    return {
      key,
      message: label
        ? `Проверьте поле «${label}»${detailHints[key] ? ": " + detailHints[key] : ""}.`
        : "Проверьте сведения о велосипеде: вес должен быть больше нуля, пробег — целым неотрицательным числом, стоимость — неотрицательной, ссылка — HTTP/HTTPS.",
    };
  }
  // The problem is shown at the step it belongs to: the optional blocks that
  // hold the field are opened and the field itself takes the focus.
  function showDetailsProblem(problem: { message: string; key?: string }) {
    setStep(1);
    setError(problem.message);
    if (problem.key === "name") setOpenName(true);
    if (problem.key === "description") setOpenDescription(true);
    const id =
      problem.key === "category"
        ? "wizard-category"
        : problem.key && detailIds[problem.key];
    if (id) requestAnimationFrame(() => document.getElementById(id)?.focus());
  }
  // «Продолжить вручную»: leaves the search from any state. A search that is
  // still running is stopped, and an answer that comes late is dropped by the
  // checks in resolve(): what is typed by hand is not overwritten.
  // Photo candidates belong to the identity they were looked up for: when it
  // is edited, the lookup in flight is stopped and what came back is let go
  // (a late answer for the old bike must not be chosen for the new one). A new
  // lookup starts only when asked for, so typing does not search on every key.
  function dropPhotoCandidates() {
    if (photos?.length || photoBusy)
      setPhotoError(
        "Марка или модель изменились: повторите поиск фото для них.",
      );
    photoAbort.current?.abort();
    setPhotoBusy(false);
    setPhotos(null);
    setChosen([]);
  }
  function continueManually() {
    resolveAbort.current?.abort();
    setResolving(false);
    setTrace([]);
    setMessage("");
    setError("");
    // What was typed fills the identity when it can be read; an empty or an
    // unreadable line leaves the fields as they are.
    const identity = parseBikeSearch(searchText, catalog.models);
    if (identity)
      setBike((previous) => ({
        ...previous,
        ...identity,
        trim: identity.trim || "",
        year: identity.year == null ? "" : String(identity.year),
      }));
    // A found bike of another request would be sent with a bike it does not
    // describe (its preview), so it is let go; the variants that were offered
    // and the parts stay, for going back and for the person to edit.
    if (result?.status === "resolved" && !answers) {
      setResult(null);
      setIdentityConfirmed(false);
    }
    // Photo candidates found for another bike are not offered for this one.
    if (
      identity &&
      (identity.brand !== query.brand ||
        identity.model !== query.model ||
        (identity.trim ?? null) !== query.trim)
    )
      dropPhotoCandidates();
    setStep(1);
  }
  function next() {
    setError("");
    if (step === 0) {
      if (found) setStep(1);
      else continueManually();
      return;
    }
    if (step === 1) {
      const problem = detailsProblem();
      if (problem) {
        showDetailsProblem(problem);
        return;
      }
      setStep(2);
      return;
    }
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
    void save();
  }
  // Each chosen file is looked at on its own: the ones that pass are kept, the
  // others are named with the reason, beside the input.
  async function addPhotos(input: HTMLInputElement) {
    const added = Array.from(input.files || []);
    // The same file can be chosen again straight away (#366).
    input.value = "";
    if (!added.length) return;
    const problems: PhotoProblem[] = [],
      accepted: { file: File; preview: string }[] = [];
    let room = photosPerBike - files.length - chosen.length;
    for (const file of added) {
      const refused = checkPhotoFile(file);
      if (refused) {
        problems.push(refused);
        continue;
      }
      if (room <= 0) {
        problems.push(tooManyPhotos(file.name));
        continue;
      }
      let preview = "";
      try {
        const bitmap = await createImageBitmap(file);
        const valid =
          Math.min(bitmap.width, bitmap.height) >= 400 &&
          Math.max(bitmap.width, bitmap.height) >= 600;
        if (valid) preview = thumbnailOf(bitmap);
        bitmap.close();
        if (!valid) {
          problems.push(photoTooSmall(file.name));
          continue;
        }
      } catch {
        problems.push(photoUnreadable(file.name));
        continue;
      }
      room -= 1;
      accepted.push({ file, preview });
    }
    if (!alive.current) return;
    setPhotoProblems(problems);
    if (accepted.length)
      setFiles((a) => [
        ...a,
        ...accepted.map(({ file, preview }) => ({
          id: draftId(),
          file,
          preview,
        })),
      ]);
  }
  // The control's delete: a found photo goes back to the offers, a file is
  // let go. The draft only: nothing was sent yet.
  function removeDraftPhoto(key: string) {
    if (key.startsWith("found:"))
      setChosen((a) => a.filter((id) => "found:" + id !== key));
    else {
      setFiles((a) => a.filter((f) => "local:" + f.id !== key));
    }
    if (coverPhoto === key) setCoverPhoto(null);
    if (selectedPhoto === key) setSelectedPhoto(null);
  }
  async function save() {
    const fields = bikeFields();
    // The second step checks these before the third opens; a change that got
    // past it is shown where the field is.
    const problem = savedId ? null : detailsProblem();
    if (problem) {
      showDetailsProblem(problem);
      return;
    }
    let confirmed = identityConfirmed;
    if (
      !savedId &&
      result?.status === "resolved" &&
      (result.sourceYear || result.query?.year) &&
      (result.sourceYear || result.query?.year) !== fields.year
    ) {
      confirmed = !!(await ask(
        `Год источника ${result.sourceYear || result.query?.year} отличается от года велосипеда ${fields.year}. Использовать эту комплектацию?`,
      ));
      if (!confirmed) return;
    }
    setSaving(true);
    setError("");
    let id = savedId;
    try {
      if (!id) {
        const data = await api<{ id: string }>("wizard", {
          requestId: requestId.current,
          identityConfirmed: confirmed,
          previewId: result?.status === "resolved" ? result.previewId : null,
          bike: fields,
          components: parts.map((part) => {
            const component: Omit<WizardPart, "id"> & { id?: string } = {
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
      // The cover is the photo the person chose, or the first of the draft:
      // fixed once, so a retry does not move it.
      wantedCover.current ??= coverDraft?.key ?? "";
      if (chosen.length) {
        const imported = await api<{ ids?: string[] }>(id + "/photos/import", {
          ids: chosen,
        });
        chosen.forEach((candidate, i) => {
          const photo = imported.ids?.[i];
          if (!photo) return;
          savedPhotos.current.set("found:" + candidate, photo);
          firstSaved.current ??= photo;
        });
        setChosen([]);
      }
      // The bike exists from here on: a photo that fails stays in the queue,
      // beside its reason, and the next attempt sends only what is left.
      const refused: PhotoProblem[] = [];
      for (const item of files) {
        const sent = await sendBikePhoto(id, item.file);
        if (sent.ok) {
          if (sent.id) {
            savedPhotos.current.set("local:" + item.id, sent.id);
            firstSaved.current ??= sent.id;
          }
          setFiles((f) => f.filter((x) => x.id !== item.id));
        } else {
          refused.push(sent.problem);
          // A file the server will never take is not worth another try.
          if (!sent.retryable) {
            setFiles((f) => f.filter((x) => x.id !== item.id));
          }
        }
      }
      if (refused.length) {
        setPhotoProblems(refused);
        // The photos are on the second step: the person lands on them, with
        // the bike already saved, and a retry sends what is left to it.
        setStep(1);
        setError(
          "Велосипед сохранён, но не все фото загружены. Причины — рядом с выбором файлов; уберите лишние или повторите загрузку.",
        );
        return;
      }
      // The first photo the server took is the cover by itself; another one
      // chosen in the draft is made the cover now that it is in.
      const cover = savedPhotos.current.get(wantedCover.current || "");
      if (cover && cover !== firstSaved.current && coverSet.current !== cover) {
        const response = await fetch(`/api/bikes/${id}/photos/${cover}`, {
          method: "PATCH",
        });
        if (!response.ok) {
          setStep(1);
          setError(
            "Велосипед сохранён, но обложку выбрать не удалось. Нажмите «Повторить загрузку фото» или назначьте обложку на странице велосипеда.",
          );
          return;
        }
        coverSet.current = cover;
      }
      completed.current = true;
      await onCreated(id!);
    } catch (e) {
      setError((id ? "Велосипед уже сохранён. " : "") + errorMessage(e));
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
        if (savedId) void save();
        else next();
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
            <small>{stepWords[i]}</small>
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
          <EmailPolicyAction message={error} />
        </p>
      )}
      <fieldset disabled={saving} className="wizard-content">
        {step === 0 && (
          <div className="wizard-search">
            <p className="help">
              Введите марку и модель одной строкой. Год и комплектация уточняют
              поиск, но не обязательны. Поиск необязателен: можно сразу
              продолжить вручную.
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
                    setMessage(
                      "Поиск остановлен. Запустите его снова, чтобы продолжить.",
                    );
                  }}
                >
                  <SiteIcon name="no" />
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
                          {sourceLabel(result.source)}
                        </a>
                      </small>
                    </span>
                  </div>
                )}
                {result?.status === "resolved" && result.manualSelection && (
                  <p className="help">
                    Сверьте год и версию модели. Ссылка выбрана вручную;
                    автоматическое совпадение не подтверждено.
                  </p>
                )}
                {result?.status === "ambiguous" && (
                  <p className="help">
                    Нашли варианты модели. Выберите свою комплектацию: название,
                    год, навеска и источник помогут их различить. Если год не
                    указан на странице, сверьте его перед импортом. Один выбор —
                    один источник: детали разных страниц не смешиваются.
                  </p>
                )}
                {result?.status === "ambiguous" &&
                  result.candidates.map((c) => (
                    <ResolverCandidateCard
                      key={c.candidateId || c.url}
                      candidate={c}
                      requestedYear={query.year}
                      disabled={
                        resolving ||
                        (!c.selectable &&
                          c.year !== null &&
                          query.year != null &&
                          c.year !== query.year)
                      }
                      onChoose={(choice) =>
                        // By id when there is one: the service remembers which
                        // page it offered.
                        choice.candidateId
                          ? resolve("", choice.candidateId)
                          : resolve(choice.url, undefined, query, true)
                      }
                    />
                  ))}
                {result && result.status !== "resolved" && (
                  <ResolverSearchReport search={result.search} />
                )}
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
                    aria-expanded={urlOpen}
                    aria-controls="wizard-url-search"
                    onClick={() => setManualMode((v) => !v)}
                  >
                    <SiteIcon name="link" size={18} />
                    {settings.wizardLinkLabel ||
                      "Распознать по странице магазина"}
                  </button>
                </div>
                {urlOpen && (
                  <section
                    id="wizard-url-search"
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
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            if (/^https?:\/\//i.test(typedUrl))
                              search(typedUrl);
                          }
                        }}
                        placeholder="https://…"
                      />
                    </label>
                    <button
                      className="button secondary"
                      type="button"
                      disabled={
                        !/^https?:\/\//i.test(typedUrl) || !searchText.trim()
                      }
                      onClick={() => search(typedUrl)}
                    >
                      <SiteIcon name="search" />
                      Распознать страницу
                    </button>
                  </section>
                )}
                {hint && (
                  <p id="wizard-gate" className="help wizard-gate">
                    {hint}
                  </p>
                )}
              </>
            )}
          </div>
        )}
        {step === 1 && (
          <div className="wizard-details">
            <fieldset className="wizard-card" disabled={locked}>
              <legend>Велосипед</legend>
              <div className="wizard-pair">
                <label className="field">
                  <span>
                    <SiteIcon name="bike" /> Марка
                  </span>
                  <input
                    id="wizard-brand"
                    aria-label="Марка"
                    maxLength={60}
                    value={bike.brand}
                    onChange={(e) => {
                      update("brand", e.target.value);
                      setResult(null);
                      dropPhotoCandidates();
                    }}
                  />
                </label>
                <label className="field">
                  <span>Модель</span>
                  <input
                    id="wizard-model"
                    maxLength={100}
                    value={bike.model}
                    onChange={(e) => {
                      update("model", e.target.value);
                      setResult(null);
                      dropPhotoCandidates();
                    }}
                  />
                </label>
              </div>
              <div className="wizard-pair">
                <label className="field">
                  <span>
                    <SiteIcon name="date" /> Год
                  </span>
                  <input
                    id="wizard-year"
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
                  <span>Комплектация / версия</span>
                  <input
                    id="wizard-trim"
                    maxLength={100}
                    value={bike.trim}
                    onChange={(e) => {
                      update("trim", e.target.value);
                      setResult(null);
                      dropPhotoCandidates();
                    }}
                  />
                </label>
              </div>
              <ClassificationFields
                categoryId="wizard-category"
                value={bike.classification}
                onChange={(classification) =>
                  setBike((v) => ({
                    ...v,
                    classification,
                    category: compatibilityCategory(classification),
                  }))
                }
              />
            </fieldset>
            <fieldset className="wizard-card" disabled={locked}>
              <legend>Характеристики</legend>
              <div className="wizard-pair">
                {(
                  [
                    ["color", "Цвет"],
                    ["size", "Ростовка"],
                  ] as const
                ).map(([k, label]) => (
                  <CompactCombo
                    key={k}
                    label={label}
                    value={bike[k]}
                    onChange={(v) => update(k, v)}
                    maxLength={k === "size" ? 30 : 50}
                    options={
                      k === "size"
                        ? catalog.sizes || ["XS", "S", "M", "L", "XL"]
                        : result?.status === "resolved" &&
                            result.suggestedMetadata?.color
                          ? [result.suggestedMetadata.color]
                          : []
                    }
                  />
                ))}
              </div>
              <div className="wizard-pair">
                {(
                  [
                    ["weight", "Вес, кг", 100],
                    ["mileage", "Текущий пробег, км", 10000000],
                  ] as const
                ).map(([k, label, max]) => (
                  <label className="field" key={k}>
                    <span>{label}</span>
                    <input
                      id={"wizard-" + k}
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
                <span>Стоимость, ₽</span>
                <input
                  id="wizard-price"
                  type="number"
                  min={0}
                  max={999999999}
                  step={0.01}
                  value={bike.price}
                  onChange={(e) => update("price", e.target.value)}
                />
              </label>
              <label className="field">
                <span>Сайт производителя</span>
                <input
                  id="wizard-manufacturer"
                  type="url"
                  maxLength={2048}
                  value={bike.manufacturer_url}
                  onChange={(e) => update("manufacturer_url", e.target.value)}
                />
              </label>
              <div className="wizard-suggestions">
                {result?.status === "resolved" &&
                  result.suggestedMetadata?.weight && (
                    <button
                      type="button"
                      className="quiet"
                      onClick={() =>
                        update("weight", result.suggestedMetadata!.weight!)
                      }
                    >
                      Вес из источника: {result.suggestedMetadata.weight} кг
                    </button>
                  )}
                {result?.status === "resolved" &&
                  (result.suggestedMetadata?.manufacturerUrl ||
                    (result.source && officialSource(result.source))) && (
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
            </fieldset>
            <section
              className="wizard-card wizard-photos"
              aria-labelledby="wizard-photos-title"
            >
              <h4 id="wizard-photos-title">Фотографии</h4>
              {!files.length && !chosen.length && (
                <div className="wizard-stock-preview">
                  {settings[
                    (bike.category + "ImageId") as
                      "mtbImageId" | "roadImageId" | "gravelImageId"
                  ] ? (
                    <img
                      src={
                        "/api/assets/" +
                        settings[
                          (bike.category + "ImageId") as
                            "mtbImageId" | "roadImageId" | "gravelImageId"
                        ]
                      }
                      alt={
                        "Стоковое изображение: " +
                        (catalog.categories as Record<string, string>)[
                          bike.category
                        ]
                      }
                    />
                  ) : (
                    <div className="stock-empty">
                      {(catalog.categories as Record<string, string>)[
                        bike.category
                      ] || "Велосипед"}{" "}
                      · стандартное изображение пока не загружено
                    </div>
                  )}
                  <small>
                    Стандартное изображение · замените своим или выберите
                    найденное
                  </small>
                </div>
              )}
              <p className="help">
                Выберите до 3 фото вашей модели или добавьте свои.
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
                        setPhotos((a) => a!.filter((x) => x.id !== p.id));
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
                <SiteIcon name="reset" />
                Повторить поиск фото
              </button>
              {draftPhotos.length > 0 && (
                <ul
                  className="wizard-draft-photos"
                  aria-label="Фотографии нового велосипеда"
                >
                  {chosen.map((id, i) =>
                    draftThumb(
                      "found:" + id,
                      "found",
                      i,
                      <img src={"/api/bikes/photo-candidates/" + id} alt="" />,
                    ),
                  )}
                  {files.map((f, i) =>
                    draftThumb(
                      "local:" + f.id,
                      "local",
                      chosen.length + i,
                      <img src={f.preview} alt="" />,
                    ),
                  )}
                </ul>
              )}
              <PhotoControl
                selected={
                  selectedDraft
                    ? {
                        position:
                          draftPhotos.findIndex(
                            (p) => p.key === selectedDraft.key,
                          ) + 1,
                        total: draftPhotos.length,
                        isCover: selectedDraft.key === coverDraft?.key,
                      }
                    : null
                }
                busy={photoBusy || saving}
                onAdd={() => fileInput.current?.click()}
                onCover={() =>
                  selectedDraft && setCoverPhoto(selectedDraft.key)
                }
                onDelete={() =>
                  selectedDraft && removeDraftPhoto(selectedDraft.key)
                }
              />
              <input
                ref={fileInput}
                type="file"
                multiple
                className="visually-hidden"
                tabIndex={-1}
                aria-label="Файлы фотографий"
                accept="image/jpeg,image/png,image/webp"
                aria-invalid={photoProblems.length ? true : undefined}
                aria-describedby={
                  photoProblems.length ? "wizard-photo-problems" : undefined
                }
                onChange={(e) => addPhotos(e.target)}
              />
              <small className="help">
                JPEG, PNG, WebP · до {photoLimitText} · от 600 × 400
              </small>
              <PhotoProblems
                id="wizard-photo-problems"
                problems={photoProblems}
                onDismiss={() => setPhotoProblems([])}
              />
            </section>
            <fieldset className="wizard-card wizard-settings" disabled={locked}>
              <legend>Приватность и показ</legend>
              <PrivacyField
                isPublic={bike.is_public}
                onChange={(value) => update("is_public", value)}
              />
              <PriceVisibilityField
                value={bike}
                onChange={(value) => setBike((b) => ({ ...b, ...value }))}
              />
              <FormerBikeField
                compact
                value={bike.is_former}
                onChange={(value) => update("is_former", value)}
              />
              <p className="help">
                Публичный велосипед виден на общей витрине, «Только я» оставляет
                его только для вас. Цены публикуются лишь с вашего разрешения;
                показ можно менять, не удаляя цены.
              </p>
              <details
                className="wizard-optional"
                open={openName}
                onToggle={(e) => setOpenName(e.currentTarget.open)}
              >
                <summary>Своё название</summary>
                <label className="field">
                  <span>Название в гараже · необязательно</span>
                  <input
                    id="wizard-name"
                    value={bike.name}
                    maxLength={100}
                    onChange={(e) => update("name", e.target.value)}
                  />
                </label>
                <p className="help">
                  Без своего названия велосипед называется «
                  {autoName || "марка, модель, версия, год"}».
                </p>
              </details>
              <details
                className="wizard-optional"
                open={openDescription}
                onToggle={(e) => setOpenDescription(e.currentTarget.open)}
              >
                <summary>Описание · необязательно</summary>
                <label className="field">
                  <span>О велосипеде</span>
                  <textarea
                    id="wizard-description"
                    maxLength={2000}
                    value={bike.description}
                    onChange={(e) => update("description", e.target.value)}
                  />
                </label>
              </details>
            </fieldset>
          </div>
        )}
        {step === 2 && (
          <>
            {result?.status === "resolved" &&
              !!result.unknownFields?.length && (
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
            {result?.status === "resolved" &&
              !!result.suggestedMetadata &&
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
                        ...(result.suggestedMetadata!.weight && !b.weight
                          ? { weight: result.suggestedMetadata!.weight }
                          : {}),
                        ...(result.suggestedMetadata!.color && !b.color
                          ? {
                              color: String(
                                result.suggestedMetadata!.color,
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
              {parts.length
                ? "Проверьте найденные компоненты или добавьте свои по группам. Можно оставить комплектацию пустой и дополнить позже."
                : "Добавьте компоненты по группам или оставьте комплектацию пустой и дополните её позже. Велосипед сохранится и так."}
            </p>
            <details className="wizard-add-picker" open={!parts.length}>
              <summary>
                <SiteIcon name="addPart" /> Добавить компонент
              </summary>
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
            <div className="wizard-groups">
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
                            onChange={(e) =>
                              edit(p.id, "notes", e.target.value)
                            }
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
                              edit(
                                p.id,
                                "section",
                                e.target.value as WizardPart["section"],
                              )
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
          <SiteIcon name="bike" />
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
          <SiteIcon name="back" />
          Назад
        </button>
        <button
          className="button"
          disabled={saving || (resolving && step !== 0)}
          aria-describedby={hint ? "wizard-gate" : undefined}
        >
          {step === 2 || savedId ? (
            <>
              <SiteIcon
                name={
                  savedId
                    ? files.length || chosen.length
                      ? "reset"
                      : "bike"
                    : "save"
                }
              />
              {savedId
                ? files.length || chosen.length
                  ? "Повторить загрузку фото"
                  : "Открыть велосипед"
                : "Сохранить велосипед"}
            </>
          ) : step === 0 && !found ? (
            <>
              <SiteIcon name="next" />
              Продолжить вручную
            </>
          ) : (
            <>
              Далее
              <SiteIcon name="next" />
            </>
          )}
        </button>
      </div>
    </form>
  );
}
