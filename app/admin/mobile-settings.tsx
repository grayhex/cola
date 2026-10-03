"use client";
import type * as React from "react";
import type {
  AdminMobileDto,
  ApiError,
  AssetLibraryDto,
} from "../../lib/contracts.ts";
import type {
  MobileConfirmation,
  MobileSettings,
} from "../../lib/mobile-config.ts";
import type { AssetUpload } from "./types.ts";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { errorMessage } from "../../lib/errors.ts";
import {
  MOBILE_LIMITS,
  changedBlocks,
  confirmationsNeeded,
  defaultLinks,
  featureKeyPattern,
  linkKeys,
  linkLabels,
  mobileFeatures,
  mobileSettingsProblems,
  mobileSettingsSchema,
  normalizeHost,
} from "../../lib/mobile-config.ts";
import { useConfirmation } from "../ui/confirmation.tsx";
import {
  ArrowDown,
  ArrowUp,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from "../ui/icons.tsx";
import AssetPicker from "./asset-picker.tsx";
import { SectionTabs, Select } from "./design-controls.tsx";
import styles from "./mobile-settings.module.css";

// The «Мобильное приложение» section (#338): what the Android app may change
// without a new build. Saving publishes at once; GET /api/v1/app-config is
// the public answer. Kept mounted, so a draft survives switching sections.

type Tab =
  "launch" | "onboarding" | "notice" | "links" | "features" | "versions";
const tabs = [
  ["launch", "Экран запуска"],
  ["onboarding", "Знакомство"],
  ["notice", "Сообщение"],
  ["links", "Ссылки"],
  ["features", "Функции"],
  ["versions", "Версии"],
] as const;
const tabOf = (path: string): Tab =>
  path.startsWith("launch")
    ? "launch"
    : path.startsWith("onboarding")
      ? "onboarding"
      : path.startsWith("notice")
        ? "notice"
        : path.startsWith("features")
          ? "features"
          : path.startsWith("compatibility")
            ? "versions"
            : "links";
const blockNames: Record<string, string> = {
  launch: "экран запуска",
  onboarding: "знакомство",
  notice: "сообщение",
  links: "ссылки",
  externalHosts: "домены",
  features: "функции",
  compatibility: "версии",
};
const kindLabels = {
  promo: "Обычное",
  service: "Служебное",
  maintenance: "Технические работы",
} as const;
const kindCaptions = {
  promo: "Обычное сообщение",
  service: "Служебное сообщение, заметнее обычного",
  maintenance: "Сообщение о технических работах",
} as const;
const knownFeatures = new Set<string>(mobileFeatures.map(({ key }) => key));
const cards = (count: number) => {
  const tens = count % 100,
    ones = count % 10;
  return (
    count +
    (tens > 10 && tens < 20
      ? " карточек"
      : ones === 1
        ? " карточка"
        : ones > 1 && ones < 5
          ? " карточки"
          : " карточек")
  );
};
const asset = (id: string | null, width = 640) =>
  id ? `/api/assets/${id}?width=${width}` : null;

/** Problems by field path: the schema first, then the rules across fields. */
function check(draft: MobileSettings, origin: string) {
  const problems = new Map<string, string>();
  const parsed = mobileSettingsSchema.safeParse(draft);
  if (!parsed.success)
    for (const issue of parsed.error.issues) {
      const path = issue.path.map(String).join(".");
      if (!problems.has(path)) problems.set(path, issue.message);
    }
  const value = parsed.success ? parsed.data : draft;
  for (const { path, message } of mobileSettingsProblems(value, origin))
    if (!problems.has(path)) problems.set(path, message);
  return { problems, value };
}

function TextField({
  label,
  help,
  error,
  value,
  onChange,
  multiline = false,
  rows = 3,
  ...props
}: {
  label: string;
  help?: React.ReactNode;
  error?: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  maxLength?: number;
  placeholder?: string;
  inputMode?: "text" | "url" | "numeric";
  type?: "text" | "number";
  min?: number;
  max?: number;
  rows?: number;
  disabled?: boolean;
}) {
  const id = useId();
  const described =
    [help && id + "-help", error && id + "-error"].filter(Boolean).join(" ") ||
    undefined;
  const shared = {
    id,
    value,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": described,
  };
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea
          {...shared}
          maxLength={props.maxLength}
          placeholder={props.placeholder}
          rows={rows}
          disabled={props.disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          {...shared}
          {...props}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {help && <small id={id + "-help"}>{help}</small>}
      {error && (
        <small className="field-error" id={id + "-error"}>
          {error}
        </small>
      )}
    </div>
  );
}

function Switch({
  label,
  help,
  checked,
  onChange,
  disabled = false,
}: {
  label: React.ReactNode;
  help?: React.ReactNode;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="setting-row">
      <span>
        {label}
        {help && <small>{help}</small>}
      </span>
      <input
        type="checkbox"
        role="switch"
        className="toggle"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

function Published({ children }: { children: React.ReactNode }) {
  return (
    <p className={styles.published}>
      <span className="badge" data-tone="success">
        Сейчас в приложении
      </span>
      {children}
    </p>
  );
}

// Decorative: the form says the same in words, so readers get one label.
function Phone({
  label,
  caption,
  children,
}: {
  label: string;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <figure className={styles.preview}>
      <div className={styles.phone} role="img" aria-label={label}>
        {children}
      </div>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

function Preview({
  tab,
  draft,
  card,
}: {
  tab: Tab;
  draft: MobileSettings;
  card: number;
}) {
  if (tab === "launch") {
    const { launch } = draft;
    return (
      <Phone
        label={
          "Предпросмотр экрана запуска" +
          (launch.title ? ": " + launch.title : "")
        }
        caption={
          launch.enabled
            ? "После системного splash, пока приложение готовится"
            : "Выключен: приложение сразу открывает главный экран"
        }
      >
        <div className={styles.screen} data-mode={launch.contentMode}>
          {launch.assetId ? (
            <img src={asset(launch.assetId) ?? undefined} alt="" />
          ) : (
            <span className={styles.empty}>Нет изображения</span>
          )}
          {launch.title && <p className={styles.launchTitle}>{launch.title}</p>}
        </div>
      </Phone>
    );
  }
  if (tab === "onboarding") {
    const { items } = draft.onboarding;
    const index = Math.min(card, Math.max(items.length - 1, 0));
    const item = items[index];
    return (
      <Phone
        label={
          item
            ? `Предпросмотр карточки ${index + 1} из ${items.length}: ${item.title}`
            : "Предпросмотр знакомства: карточек нет"
        }
        caption={
          draft.onboarding.enabled
            ? "Показывается один раз на редакцию"
            : "Выключено: приложение его не покажет"
        }
      >
        {item ? (
          <div className={styles.slide}>
            <div className={styles.slideImage}>
              {item.assetId && (
                <img src={asset(item.assetId) ?? undefined} alt="" />
              )}
            </div>
            <strong>{item.title || "Заголовок карточки"}</strong>
            {item.body && <p>{item.body}</p>}
            <div className={styles.dots}>
              {items.map((_, i) => (
                <span key={i} data-current={i === index} />
              ))}
            </div>
            <div className={styles.fauxActions}>
              <span>Пропустить</span>
              <span>{index === items.length - 1 ? "Готово" : "Далее"}</span>
            </div>
          </div>
        ) : (
          <div className={styles.screen}>
            <span className={styles.empty}>Добавьте карточку</span>
          </div>
        )}
      </Phone>
    );
  }
  const { notice } = draft;
  return (
    <Phone
      label={
        notice.title
          ? `Предпросмотр сообщения «${notice.title}»`
          : "Предпросмотр сообщения"
      }
      caption={
        notice.enabled
          ? kindCaptions[notice.kind]
          : "Выключено: приложение его не покажет"
      }
    >
      <div className={styles.app}>
        <div className={styles.banner} data-kind={notice.kind}>
          {notice.assetId && (
            <img src={asset(notice.assetId, 160) ?? undefined} alt="" />
          )}
          <div>
            <strong>{notice.title || "Заголовок сообщения"}</strong>
            {notice.body && <p>{notice.body}</p>}
            {notice.actionLabel && (
              <span className={styles.fauxButton}>{notice.actionLabel}</span>
            )}
          </div>
        </div>
        <div className={styles.skeleton} />
        <div className={styles.skeleton} />
        <div className={styles.skeleton} />
      </div>
    </Phone>
  );
}

export default function MobileSettingsEditor({
  active,
  assets,
  onUpload,
  onSaved,
  onDirtyChange,
}: {
  active: boolean;
  assets: AssetLibraryDto;
  onUpload: AssetUpload;
  onSaved?: () => Promise<unknown>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [ask, confirmation] = useConfirmation();
  const [data, setData] = useState<AdminMobileDto | null>(null),
    [draft, setDraft] = useState<MobileSettings | null>(null);
  const [tab, setTab] = useState<Tab>("launch"),
    [card, setCard] = useState(0);
  const [keys, setKeys] = useState<string[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [serverProblems, setServerProblems] = useState<Map<string, string>>(
    () => new Map(),
  );
  // Checked: people who already saw the block see its new edition again.
  const [reshow, setReshow] = useState({ onboarding: true, notice: true });
  const [newHost, setNewHost] = useState(""),
    [newFeature, setNewFeature] = useState("");
  const alive = useRef(true),
    loading = useRef(false),
    counter = useRef(0);
  const editorId = useId();
  const dirty =
    !!draft && !!data && JSON.stringify(draft) !== JSON.stringify(data.value);
  const changed = (() => {
    if (!draft || !data) return [];
    return (Object.keys(blockNames) as (keyof MobileSettings)[]).filter(
      (key) => JSON.stringify(draft[key]) !== JSON.stringify(data.value[key]),
    );
  })();
  const { problems } =
    draft && data
      ? check(draft, data.origin)
      : { problems: new Map<string, string>() };
  const problem = (path: string) =>
    serverProblems.get(path) ?? problems.get(path);
  const blocks =
    draft && data
      ? changedBlocks(data.value, draft)
      : { onboarding: false, notice: false };

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const accept = useCallback((result: AdminMobileDto) => {
    setData(result);
    setDraft(result.value);
    setKeys(
      result.value.onboarding.items.map(() => "card-" + ++counter.current),
    );
    setReshow({ onboarding: true, notice: true });
    setServerProblems(new Map());
  }, []);
  const load = useCallback(async () => {
    if (
      loading.current ||
      (dirty &&
        !(await ask(
          "Отменить несохранённые изменения и загрузить опубликованные настройки приложения?",
        )))
    )
      return;
    loading.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/mobile", { cache: "no-store" });
      const result: AdminMobileDto & Partial<ApiError> = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (alive.current) accept(result);
    } catch (e) {
      if (alive.current)
        setError(
          errorMessage(e) || "Не удалось загрузить настройки приложения",
        );
    } finally {
      loading.current = false;
      if (alive.current) setBusy(false);
    }
  }, [dirty, ask, accept]);
  useEffect(() => {
    if (active && !data && !loading.current) load();
  }, [active, data, load]);

  if (!data || !draft)
    return (
      <section className="admin-panel" aria-label="Мобильное приложение">
        {confirmation}
        {error ? (
          <div className="error" role="alert">
            {error}
          </div>
        ) : (
          <p>Загружаем настройки приложения…</p>
        )}
        <button type="button" className="quiet" disabled={busy} onClick={load}>
          <RefreshCw size={16} />
          Загрузить снова
        </button>
      </section>
    );
  const value = draft;
  const settings = data;

  function edit(change: (before: MobileSettings) => MobileSettings) {
    setDraft((before) => (before ? change(before) : before));
    setNotice("");
  }
  const setLaunch = (change: Partial<MobileSettings["launch"]>) =>
    edit((d) => ({ ...d, launch: { ...d.launch, ...change } }));
  const setNoticeBlock = (change: Partial<MobileSettings["notice"]>) =>
    edit((d) => ({ ...d, notice: { ...d.notice, ...change } }));
  const setCompatibility = (change: Partial<MobileSettings["compatibility"]>) =>
    edit((d) => ({ ...d, compatibility: { ...d.compatibility, ...change } }));
  type Item = MobileSettings["onboarding"]["items"][number];
  const setItems = (items: Item[], nextKeys: string[]) => {
    edit((d) => ({ ...d, onboarding: { ...d.onboarding, items } }));
    setKeys(nextKeys);
  };
  const items = value.onboarding.items;
  function moveItem(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const nextItems = [...items],
      nextKeys = [...keys];
    [nextItems[index], nextItems[target]] = [
      nextItems[target],
      nextItems[index],
    ];
    [nextKeys[index], nextKeys[target]] = [nextKeys[target], nextKeys[index]];
    setItems(nextItems, nextKeys);
    setCard(target);
    // The pressed button moves with its card; at the end of the list it is
    // disabled, so focus goes to the other direction rather than the page.
    const [same, other] = delta < 0 ? ["up", "down"] : ["down", "up"];
    const atEnd = delta < 0 ? target === 0 : target === items.length - 1;
    const direction = atEnd ? other : same;
    const key = nextKeys[target];
    requestAnimationFrame(() =>
      document.getElementById(`${editorId}-${key}-${direction}`)?.focus(),
    );
  }
  const choices = assets.filter((a) => (a.format ?? "image") === "image");
  async function upload(file: File, apply: (id: string) => void) {
    setBusy(true);
    setError("");
    try {
      const uploaded = await onUpload(file);
      if (!uploaded) return;
      if (uploaded.format && uploaded.format !== "image")
        throw new Error(
          "Для приложения нужен PNG, JPEG или WebP: SVG и Rive не поддерживаются.",
        );
      if (alive.current) {
        apply(uploaded.id);
        setNotice(
          "Изображение загружено и выбрано. Приложения получат его после сохранения.",
        );
      }
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function confirmed(key: MobileConfirmation, after: MobileSettings) {
    return key === "hardUpdate"
      ? !!(await ask(
          `Версии приложения ниже ${after.compatibility.minimumSupportedVersionCode} перестанут открываться: человек увидит только экран обновления со ссылкой. Включайте, только если старые версии действительно несовместимы с сервером.`,
          {
            title: "Включить обязательное обновление?",
            confirmLabel: "Включить обязательное обновление",
            danger: true,
          },
        ))
      : !!(await ask(
          "Сообщение о технических работах увидят все пользователи приложения, заметнее обычного. Оно только сообщает: приложение продолжит работать.",
          {
            title: "Опубликовать сообщение о работах?",
            confirmLabel: "Опубликовать сообщение",
            danger: true,
          },
        ));
  }
  async function save() {
    if (busy) return;
    const result = check(value, settings.origin);
    if (result.problems.size) {
      setServerProblems(new Map());
      setError(
        "Исправьте поля: " + [...new Set(result.problems.values())].join("; "),
      );
      setTab(tabOf([...result.problems.keys()][0]));
      return;
    }
    const confirm: Partial<Record<MobileConfirmation, boolean>> = {};
    for (const key of confirmationsNeeded(settings.value, result.value)) {
      if (!(await confirmed(key, result.value))) return;
      confirm[key] = true;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      for (let attempt = 0; ; attempt++) {
        const response = await fetch("/api/admin/mobile", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            value,
            version: settings.version,
            confirm,
            keepRevision: {
              onboarding: !reshow.onboarding,
              notice: !reshow.notice,
            },
          }),
        });
        const saved: AdminMobileDto &
          Partial<ApiError> & {
            code?: string;
            confirm?: MobileConfirmation[];
            problems?: { path: string; message: string }[];
          } = await response.json();
        // The server compares with what is stored now; ask once more if it
        // sees a high-impact change this draft did not.
        if (response.status === 428 && saved.confirm && attempt === 0) {
          for (const key of saved.confirm) {
            if (!(await confirmed(key, result.value))) return;
            confirm[key] = true;
          }
          continue;
        }
        if (!response.ok) {
          setServerProblems(
            new Map((saved.problems ?? []).map((p) => [p.path, p.message])),
          );
          throw new Error(
            saved.error || "Не удалось сохранить настройки приложения.",
          );
        }
        if (!alive.current) return;
        accept(saved);
        setNotice(
          `Опубликовано. Приложения получат версию настроек ${saved.version} при следующей проверке.`,
        );
        try {
          await onSaved?.();
        } catch {
          // The settings are saved; the media library refreshes when opened.
        }
        return;
      }
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  const { published } = settings;
  const updated = new Date(settings.updatedAt).toLocaleString("ru-RU");
  const showPreview = ["launch", "onboarding", "notice"].includes(tab);
  const customFeatures = Object.keys(value.features).filter(
    (key) => !knownFeatures.has(key),
  );
  const hostProblem =
    newHost.trim() && !normalizeHost(newHost)
      ? "Укажите домен без https:// и пути, например rustore.ru"
      : "";
  const featureProblem =
    newFeature && !featureKeyPattern.test(newFeature)
      ? "Латиница и цифры в camelCase, с маленькой буквы, до 40 знаков"
      : newFeature && newFeature in value.features
        ? "Такой ключ уже есть"
        : "";

  return (
    <section
      className={"admin-panel " + styles.panel}
      aria-label="Мобильное приложение"
    >
      {confirmation}
      <div className={styles.heading}>
        <h2>Настройки Android-приложения</h2>
        <button type="button" className="quiet" disabled={busy} onClick={load}>
          <RefreshCw size={16} />
          Обновить
        </button>
      </div>
      <p className={styles.intro}>
        Здесь меняется то, что приложение умеет показывать без новой сборки:
        картинки, тексты, ссылки и доступность уже встроенных функций.
        Сохранение сразу публикует настройки. Версии приложения, которые не
        знают какого-то поля, просто его пропускают. Системный splash и иконка
        остаются в APK.
      </p>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <p className="notice" data-tone="success" role="status">
          {notice}
        </p>
      )}
      <SectionTabs
        label="Настройки приложения"
        items={tabs}
        value={tab}
        onChange={setTab}
      >
        {(current) => (
          <div className={styles.layout} data-preview={showPreview}>
            <div className={styles.form}>
              {current === "launch" && (
                <>
                  <p className="notice" data-tone="info">
                    Это не системный Android SplashScreen: его и иконку задаёт
                    APK. Здесь — короткий экран ColaBike после него, пока
                    приложение готовится. Без сохранённой картинки приложение
                    сразу открывает главный экран.
                  </p>
                  <Published>
                    {published.launch.enabled && published.launch.imageUrl ? (
                      <>
                        <img
                          src={published.launch.imageUrl + "?width=160"}
                          alt=""
                        />
                        показывается
                        {!value.launch.assetId
                          ? " · в черновике изображение снято"
                          : published.launch.imageUrl !==
                              "/api/assets/" + value.launch.assetId
                            ? " · в черновике другое изображение"
                            : ""}
                      </>
                    ) : (
                      "выключен"
                    )}
                  </Published>
                  <Switch
                    label="Показывать экран запуска"
                    checked={value.launch.enabled}
                    onChange={(enabled) => setLaunch({ enabled })}
                  />
                  <AssetPicker
                    label="Изображение экрана запуска"
                    help="PNG, JPEG или WebP, вертикальное, от 1080×1920 px. Файл публичный."
                    value={value.launch.assetId}
                    assets={choices}
                    emptyLabel="Не выбрано"
                    busy={busy}
                    recommendedSize={{ width: 1080, height: 1920 }}
                    onChange={(assetId) => setLaunch({ assetId })}
                    onUpload={(file) =>
                      upload(file, (assetId) => setLaunch({ assetId }))
                    }
                  />
                  {problem("launch.assetId") && (
                    <p className="field-error" role="alert">
                      {problem("launch.assetId")}
                    </p>
                  )}
                  <Select
                    label="Как показывать изображение"
                    value={value.launch.contentMode}
                    options={[
                      ["crop", "Заполнить экран, обрезав края"],
                      ["fit", "Вписать целиком"],
                    ]}
                    onChange={(contentMode) => setLaunch({ contentMode })}
                  />
                  <TextField
                    label="Подпись"
                    help="Необязательно, до 80 символов."
                    error={problem("launch.title")}
                    value={value.launch.title ?? ""}
                    maxLength={80}
                    onChange={(title) => setLaunch({ title: title || null })}
                  />
                  <TextField
                    label="Название для админки"
                    help="Видно только здесь, например «Осенняя кампания»."
                    error={problem("launch.name")}
                    value={value.launch.name ?? ""}
                    maxLength={150}
                    onChange={(name) => setLaunch({ name: name || null })}
                  />
                </>
              )}
              {current === "onboarding" && (
                <>
                  <Published>
                    {published.onboarding.enabled
                      ? `${cards(published.onboarding.items.length)} · редакция ${published.onboarding.revision}`
                      : "выключено"}
                  </Published>
                  <Switch
                    label="Показывать знакомство"
                    help="Приложение показывает каждую редакцию один раз, до входа в аккаунт тоже."
                    checked={value.onboarding.enabled}
                    onChange={(enabled) =>
                      edit((d) => ({
                        ...d,
                        onboarding: { ...d.onboarding, enabled },
                      }))
                    }
                  />
                  {problem("onboarding.items") && (
                    <p className="field-error" role="alert">
                      {problem("onboarding.items")}
                    </p>
                  )}
                  <ol className={styles.cards}>
                    {items.map((item, index) => (
                      <li
                        key={keys[index] ?? index}
                        className={styles.card}
                        data-active={index === card}
                        onFocusCapture={() => setCard(index)}
                      >
                        <div className={styles.cardHead}>
                          <h3>Карточка {index + 1}</h3>
                          <div className={styles.cardActions}>
                            <button
                              type="button"
                              className="icon"
                              id={`${editorId}-${keys[index]}-up`}
                              disabled={busy || index === 0}
                              aria-label={`Карточка ${index + 1}: выше`}
                              onClick={() => moveItem(index, -1)}
                            >
                              <ArrowUp size={16} />
                            </button>
                            <button
                              type="button"
                              className="icon"
                              id={`${editorId}-${keys[index]}-down`}
                              disabled={busy || index === items.length - 1}
                              aria-label={`Карточка ${index + 1}: ниже`}
                              onClick={() => moveItem(index, 1)}
                            >
                              <ArrowDown size={16} />
                            </button>
                            <button
                              type="button"
                              className="icon danger"
                              disabled={busy}
                              aria-label={`Удалить карточку ${index + 1}`}
                              onClick={() => {
                                setItems(
                                  items.filter((_, i) => i !== index),
                                  keys.filter((_, i) => i !== index),
                                );
                                setCard(Math.max(0, index - 1));
                              }}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                        <TextField
                          label="Заголовок"
                          error={problem(`onboarding.items.${index}.title`)}
                          value={item.title}
                          maxLength={80}
                          onChange={(title) =>
                            setItems(
                              items.map((it, i) =>
                                i === index ? { ...it, title } : it,
                              ),
                              keys,
                            )
                          }
                        />
                        <TextField
                          label="Текст"
                          help="Обычный текст без разметки, до 400 символов."
                          error={problem(`onboarding.items.${index}.body`)}
                          value={item.body ?? ""}
                          maxLength={400}
                          multiline
                          onChange={(body) =>
                            setItems(
                              items.map((it, i) =>
                                i === index
                                  ? { ...it, body: body || null }
                                  : it,
                              ),
                              keys,
                            )
                          }
                        />
                        <AssetPicker
                          label={`Изображение карточки ${index + 1}`}
                          help="Необязательно. PNG, JPEG или WebP."
                          value={item.assetId}
                          assets={choices}
                          emptyLabel="Без изображения"
                          busy={busy}
                          compact
                          onChange={(assetId) =>
                            setItems(
                              items.map((it, i) =>
                                i === index ? { ...it, assetId } : it,
                              ),
                              keys,
                            )
                          }
                          onUpload={(file) =>
                            upload(file, (assetId) =>
                              edit((d) => ({
                                ...d,
                                onboarding: {
                                  ...d.onboarding,
                                  items: d.onboarding.items.map((it, i) =>
                                    i === index ? { ...it, assetId } : it,
                                  ),
                                },
                              })),
                            )
                          }
                        />
                      </li>
                    ))}
                  </ol>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={
                      busy || items.length >= MOBILE_LIMITS.onboardingItems
                    }
                    onClick={() => {
                      setItems(
                        [...items, { title: "", body: null, assetId: null }],
                        [...keys, "card-" + ++counter.current],
                      );
                      setCard(items.length);
                    }}
                  >
                    <Plus size={16} />
                    Добавить карточку
                  </button>
                  <p className="help">
                    До {MOBILE_LIMITS.onboardingItems} карточек. Порядок здесь —
                    порядок в приложении.
                  </p>
                  {blocks.onboarding && (
                    <Switch
                      label="Показать снова тем, кто уже прошёл знакомство"
                      help="Выключите для мелкой правки: редакция останется прежней."
                      checked={reshow.onboarding}
                      onChange={(on) =>
                        setReshow((r) => ({ ...r, onboarding: on }))
                      }
                    />
                  )}
                </>
              )}
              {current === "notice" && (
                <>
                  <Published>
                    {published.notice
                      ? `«${published.notice.title}» · ${kindLabels[published.notice.kind]} · редакция ${published.notice.revision}`
                      : "нет сообщения"}
                  </Published>
                  <Switch
                    label="Показывать сообщение"
                    checked={value.notice.enabled}
                    onChange={(enabled) => setNoticeBlock({ enabled })}
                  />
                  <Select
                    label="Тип"
                    value={value.notice.kind}
                    options={[
                      ["promo", "Обычное: новости и акции"],
                      ["service", "Служебное: заметнее обычного"],
                      ["maintenance", "Технические работы: самое заметное"],
                    ]}
                    onChange={(kind) => setNoticeBlock({ kind })}
                  />
                  {value.notice.kind === "maintenance" && (
                    <p className="notice" data-tone="warning">
                      Сообщение о работах только информирует и ничего не
                      блокирует. Перед публикацией попросим подтвердить.
                    </p>
                  )}
                  <TextField
                    label="Заголовок"
                    error={problem("notice.title")}
                    value={value.notice.title}
                    maxLength={80}
                    onChange={(title) => setNoticeBlock({ title })}
                  />
                  <TextField
                    label="Текст"
                    help="Обычный текст, до 500 символов."
                    error={problem("notice.body")}
                    value={value.notice.body ?? ""}
                    maxLength={500}
                    multiline
                    onChange={(body) => setNoticeBlock({ body: body || null })}
                  />
                  <AssetPicker
                    label="Изображение сообщения"
                    help="Необязательно. PNG, JPEG или WebP."
                    value={value.notice.assetId}
                    assets={choices}
                    emptyLabel="Без изображения"
                    busy={busy}
                    compact
                    onChange={(assetId) => setNoticeBlock({ assetId })}
                    onUpload={(file) =>
                      upload(file, (assetId) => setNoticeBlock({ assetId }))
                    }
                  />
                  <div className={styles.pair}>
                    <TextField
                      label="Текст кнопки"
                      help="Необязательно, до 40 символов."
                      error={problem("notice.actionLabel")}
                      value={value.notice.actionLabel ?? ""}
                      maxLength={40}
                      onChange={(label) =>
                        setNoticeBlock({ actionLabel: label || null })
                      }
                    />
                    <TextField
                      label="Ссылка кнопки"
                      help="Страница сайта (/market) или https-адрес разрешённого домена."
                      error={problem("notice.actionUrl")}
                      value={value.notice.actionUrl ?? ""}
                      maxLength={500}
                      inputMode="url"
                      placeholder="/rides"
                      onChange={(url) =>
                        setNoticeBlock({ actionUrl: url || null })
                      }
                    />
                  </div>
                  {blocks.notice && (
                    <Switch
                      label="Показать снова тем, кто уже закрыл сообщение"
                      help="Выключите для мелкой правки: редакция останется прежней."
                      checked={reshow.notice}
                      onChange={(on) =>
                        setReshow((r) => ({ ...r, notice: on }))
                      }
                    />
                  )}
                </>
              )}
              {current === "links" && (
                <>
                  <p className="help">
                    Пустое поле — страница сайта по умолчанию. Можно указать
                    страницу сайта (/about) или https-адрес домена из списка
                    ниже. Другие схемы (javascript:, intent:, адреса приложений)
                    не принимаются.
                  </p>
                  {linkKeys.map((key) => (
                    <TextField
                      key={key}
                      label={linkLabels[key]}
                      help={
                        "В приложении: " +
                        (published.links[key] ?? "не показывается") +
                        (defaultLinks[key]
                          ? ` · по умолчанию ${defaultLinks[key]}`
                          : " · без умолчания")
                      }
                      error={problem("links." + key)}
                      value={value.links[key] ?? ""}
                      maxLength={500}
                      inputMode="url"
                      placeholder={defaultLinks[key] ?? "Не показывать"}
                      onChange={(link) =>
                        edit((d) => ({
                          ...d,
                          links: { ...d.links, [key]: link || null },
                        }))
                      }
                    />
                  ))}
                  <h3 className={styles.subheading}>
                    Разрешённые внешние домены
                  </h3>
                  <p className="help">
                    Ссылки на другие сайты (кнопка сообщения, служебные ссылки,
                    адрес обновления) открываются, только если домен есть в
                    списке. Совпадение точное: www.rustore.ru и rustore.ru —
                    разные домены.
                  </p>
                  {value.externalHosts.length > 0 && (
                    <ul className={styles.chips}>
                      {value.externalHosts.map((host, index) => (
                        <li key={host + index} className={styles.chip}>
                          {host}
                          <button
                            type="button"
                            className="icon"
                            disabled={busy}
                            aria-label={"Убрать домен " + host}
                            onClick={() =>
                              edit((d) => ({
                                ...d,
                                externalHosts: d.externalHosts.filter(
                                  (_, i) => i !== index,
                                ),
                              }))
                            }
                          >
                            <X size={14} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {problem("externalHosts") && (
                    <p className="field-error" role="alert">
                      {problem("externalHosts")}
                    </p>
                  )}
                  <form
                    className={styles.addRow}
                    onSubmit={(event) => {
                      event.preventDefault();
                      const host = normalizeHost(newHost);
                      if (!host) return;
                      edit((d) => ({
                        ...d,
                        externalHosts: d.externalHosts.includes(host)
                          ? d.externalHosts
                          : [...d.externalHosts, host],
                      }));
                      setNewHost("");
                    }}
                  >
                    <TextField
                      label="Домен"
                      error={hostProblem || undefined}
                      value={newHost}
                      maxLength={253}
                      placeholder="rustore.ru"
                      onChange={setNewHost}
                    />
                    <button
                      type="submit"
                      className="button secondary"
                      disabled={
                        busy ||
                        !normalizeHost(newHost) ||
                        value.externalHosts.length >= MOBILE_LIMITS.hosts
                      }
                    >
                      <Plus size={16} />
                      Добавить домен
                    </button>
                  </form>
                </>
              )}
              {current === "features" && (
                <>
                  <p className="help">
                    Выключенная функция пропадает из приложения. Включение не
                    добавит того, чего в установленной версии нет, и не заменяет
                    проверку прав на сервере.
                  </p>
                  {mobileFeatures.map(({ key, label, gate }) => (
                    <Switch
                      key={key}
                      label={
                        <>
                          {label} <code className={styles.key}>{key}</code>
                        </>
                      }
                      help={
                        gate && !settings.readiness[gate]
                          ? "Сервер для неё не настроен: приложение получит «выключено» при любом положении переключателя."
                          : published.features[key] === false
                            ? "Сейчас в приложении выключена."
                            : undefined
                      }
                      checked={value.features[key] ?? true}
                      onChange={(on) =>
                        edit((d) => ({
                          ...d,
                          features: { ...d.features, [key]: on },
                        }))
                      }
                    />
                  ))}
                  <h3 className={styles.subheading}>Ключи будущих версий</h3>
                  <p className="help">
                    Для функций новых версий приложения, о которых сайт пока не
                    знает. Старые версии такие ключи пропускают.
                  </p>
                  {customFeatures.map((key) => (
                    <div key={key} className={styles.customFeature}>
                      <Switch
                        label={<code className={styles.key}>{key}</code>}
                        checked={value.features[key]}
                        onChange={(on) =>
                          edit((d) => ({
                            ...d,
                            features: { ...d.features, [key]: on },
                          }))
                        }
                      />
                      <button
                        type="button"
                        className="icon danger"
                        disabled={busy}
                        aria-label={"Удалить ключ " + key}
                        onClick={() =>
                          edit((d) => ({
                            ...d,
                            features: Object.fromEntries(
                              Object.entries(d.features).filter(
                                ([name]) => name !== key,
                              ),
                            ),
                          }))
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                  {problem("features") && (
                    <p className="field-error" role="alert">
                      {problem("features")}
                    </p>
                  )}
                  <form
                    className={styles.addRow}
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!newFeature || featureProblem) return;
                      edit((d) => ({
                        ...d,
                        features: { ...d.features, [newFeature]: true },
                      }));
                      setNewFeature("");
                    }}
                  >
                    <TextField
                      label="Ключ функции"
                      error={featureProblem || undefined}
                      value={newFeature}
                      maxLength={40}
                      placeholder="rideRecording"
                      onChange={(key) => setNewFeature(key.trim())}
                    />
                    <button
                      type="submit"
                      className="button secondary"
                      disabled={
                        busy ||
                        !newFeature ||
                        !!featureProblem ||
                        Object.keys(value.features).length >=
                          MOBILE_LIMITS.features
                      }
                    >
                      <Plus size={16} />
                      Добавить ключ
                    </button>
                  </form>
                </>
              )}
              {current === "versions" && (
                <>
                  <Published>
                    {`минимальная ${published.compatibility.minimumSupportedVersionCode ?? "—"} · последняя ${published.compatibility.latestVersionCode ?? "—"} · ${published.compatibility.updateMode === "hard" ? "обязательное обновление" : "мягкое предложение"}`}
                  </Published>
                  <p className="help">
                    Сравнивается versionCode сборки — целое число, которое
                    растёт с каждым выпуском. Ниже минимальной версия не
                    поддерживается; ниже последней приложение предложит
                    обновиться. К магазину приложений не привязано: адрес
                    обновления задаётся ниже.
                  </p>
                  <div className={styles.pair}>
                    <TextField
                      label="Минимальная поддерживаемая версия"
                      help="Только для действительно несовместимых сборок."
                      error={problem(
                        "compatibility.minimumSupportedVersionCode",
                      )}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={MOBILE_LIMITS.versionCode}
                      value={String(
                        value.compatibility.minimumSupportedVersionCode ?? "",
                      )}
                      onChange={(code) =>
                        setCompatibility({
                          minimumSupportedVersionCode:
                            code === "" ? null : Number(code),
                        })
                      }
                    />
                    <TextField
                      label="Последняя версия"
                      error={problem("compatibility.latestVersionCode")}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={MOBILE_LIMITS.versionCode}
                      value={String(
                        value.compatibility.latestVersionCode ?? "",
                      )}
                      onChange={(code) =>
                        setCompatibility({
                          latestVersionCode: code === "" ? null : Number(code),
                        })
                      }
                    />
                  </div>
                  <Select
                    label="Если версия ниже минимальной"
                    value={value.compatibility.updateMode}
                    options={[
                      ["soft", "Предлагать обновиться, не блокируя"],
                      ["hard", "Обязательное обновление: экран обновления"],
                    ]}
                    onChange={(updateMode) => setCompatibility({ updateMode })}
                  />
                  {value.compatibility.updateMode === "hard" && (
                    <p className="notice" data-tone="warning">
                      Обязательный режим закрывает старые версии экраном
                      обновления. Нужны минимальная версия и ссылка; перед
                      сохранением попросим подтвердить.
                    </p>
                  )}
                  <TextField
                    label="Ссылка на обновление"
                    help="Страница сайта или https-адрес разрешённого домена, например страница RuStore."
                    error={problem("compatibility.updateUrl")}
                    value={value.compatibility.updateUrl ?? ""}
                    maxLength={500}
                    inputMode="url"
                    onChange={(url) =>
                      setCompatibility({ updateUrl: url || null })
                    }
                  />
                  <TextField
                    label="Текст об обновлении"
                    help="Необязательно, до 300 символов."
                    error={problem("compatibility.updateMessage")}
                    value={value.compatibility.updateMessage ?? ""}
                    maxLength={300}
                    multiline
                    onChange={(message) =>
                      setCompatibility({ updateMessage: message || null })
                    }
                  />
                </>
              )}
            </div>
            {showPreview && <Preview tab={current} draft={value} card={card} />}
          </div>
        )}
      </SectionTabs>
      <details className={styles.payload}>
        <summary>
          Что получает приложение сейчас: GET /api/v1/app-config
        </summary>
        <pre tabIndex={0}>{JSON.stringify(published, null, 2)}</pre>
      </details>
      <div className="admin-save" data-dirty={dirty}>
        <span>
          {dirty
            ? "Не опубликовано: " +
              changed.map((key) => blockNames[key]).join(", ")
            : `Опубликована версия ${settings.version} · ${updated}`}
        </span>
        <div>
          <button
            type="button"
            className="quiet"
            disabled={busy || !dirty}
            onClick={() => {
              accept(settings);
              setError("");
              setNotice("");
            }}
          >
            Отменить изменения
          </button>
          <button
            type="button"
            className="button"
            disabled={busy || !dirty}
            onClick={save}
          >
            <Save size={17} />
            {busy ? "Сохраняем…" : "Сохранить и опубликовать"}
          </button>
        </div>
      </div>
    </section>
  );
}
