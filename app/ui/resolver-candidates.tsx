"use client";
import type { ResolveResult } from "../../lib/bike-resolver-client.ts";
import { Bike, TriangleAlert } from "./icons.tsx";

type Choices = Extract<ResolveResult, { status: "ambiguous" }>;
export type ResolverCandidate = Choices["candidates"][number];
export type ResolverSearchSummary = NonNullable<Choices["search"]>;
type Source = Extract<ResolveResult, { status: "resolved" }>["source"];

// A page of the manufacturer itself (never a store, a search hit or a pasted
// address). Old previews have no `kind`; their adapter id tells the same.
export function officialSource(source: Source) {
  return source.kind
    ? source.kind === "manufacturer"
    : source.adapter !== "manual-url" &&
        source.adapter !== "retailer-search" &&
        !source.adapter.startsWith("store:");
}
// Where a page comes from, in words a rider understands. Old previews have no
// `kind`; their adapter id still tells official pages from pasted ones.
export function sourceLabel(source: Source) {
  if (source.kind === "store") return "магазин " + source.manufacturer;
  if (source.kind === "web") return "найденная страница";
  if (source.kind === "archive") return "архив моделей";
  if (source.kind === "manual" || source.adapter === "manual-url")
    return "страница по ссылке";
  if (source.adapter === "retailer-search") return "найденный магазин";
  return "официальный источник";
}
function candidateSource(c: ResolverCandidate) {
  if (c.kind === "store") return "магазин " + (c.storeName || c.sourceHost);
  if (c.kind === "web") return "найденная страница · " + c.sourceHost;
  if (c.kind === "archive") return "архив моделей";
  return "официальный сайт";
}
const warningText: Record<string, string> = {
  identity_mismatch: "Название или год отличаются от запроса",
  conflicting_sources: "В данных страницы есть расхождения",
};
const statusText: Record<string, string> = {
  empty: "подходящих страниц нет",
  timeout: "не ответил вовремя",
  unavailable: "недоступен",
  skipped: "поиск по каталогу не подключён, читается только ссылка",
  disabled: "отключён",
};
const reasonText: Record<string, string> = {
  http_403: "сайт отклонил запрос",
  access_challenge: "сайт требует проверку посетителя",
  http_429: "слишком много запросов",
  blocked_source: "адрес заблокирован настройками",
};
function sourceStatus(s: ResolverSearchSummary["sources"][number]) {
  if (s.status === "ok")
    return `найдено: ${s.candidates}, страниц проверено: ${s.pages}`;
  if (s.status === "blocked")
    return (
      "доступ ограничен" +
      (s.reason ? ` (${reasonText[s.reason] ?? s.reason})` : "")
    );
  return statusText[s.status] ?? s.status;
}

export function ResolverCandidateCard({
  candidate: c,
  requestedYear,
  disabled,
  onChoose,
}: {
  candidate: ResolverCandidate;
  requestedYear: number | null | undefined;
  disabled?: boolean;
  onChoose: (candidate: ResolverCandidate) => void;
}) {
  const warnings = [
    ...(c.year != null && requestedYear != null && c.year !== requestedYear
      ? [`Год страницы ${c.year}, вы указали ${requestedYear}`]
      : []),
    ...(c.warnings || []).flatMap((w) =>
      // A year or name that differs is already stated more precisely above.
      w === "identity_mismatch" &&
      c.year != null &&
      requestedYear != null &&
      c.year !== requestedYear
        ? []
        : warningText[w]
          ? [warningText[w]]
          : [],
    ),
    ...(c.kind === "store" || c.kind === "web"
      ? ["Комплектация магазина может отличаться от заводской"]
      : []),
  ];
  return (
    <button
      type="button"
      className="wizard-candidate"
      disabled={disabled}
      onClick={() => onChoose(c)}
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
          {c.year ? `${c.year} год` : "Год не указан на странице"} ·{" "}
          {candidateSource(c)}
        </small>
        {c.drivetrain && <small>Навеска: {c.drivetrain}</small>}
        {c.quality && (
          <small>
            {c.quality.level === "complete"
              ? "Спецификация полная"
              : "Спецификация частичная"}{" "}
            · компонентов: {c.quality.recognizedComponents}
          </small>
        )}
        {warnings.map((w) => (
          <small key={w} className="resolver-warning">
            <TriangleAlert size={12} aria-hidden="true" /> {w}
          </small>
        ))}
        {!!c.alternatives?.length && (
          <small>
            Та же модель на других страницах:{" "}
            {[...new Set(c.alternatives.map((a) => a.sourceHost))].join(", ")}
          </small>
        )}
        <small>Выбрать комплектацию →</small>
      </span>
    </button>
  );
}

// What was asked and what answered: a limited search is not called complete.
export function ResolverSearchReport({
  search,
}: {
  search: ResolverSearchSummary | undefined;
}) {
  if (!search?.sources.length) return null;
  const asked = search.sources.filter((s) => s.status !== "disabled");
  const answered = asked.filter(
    (s) => s.status === "ok" || s.status === "empty",
  ).length;
  return (
    <details className="resolver-sources">
      <summary>
        Проверено источников: {answered} из {asked.length}
        {!search.complete && " · выдача ограничена"}
      </summary>
      <ul>
        {search.sources.map((s) => (
          <li key={s.id + s.kind}>
            <strong>{s.name}</strong>
            <span>{sourceStatus(s)}</span>
          </li>
        ))}
      </ul>
      {!search.complete && (
        <p className="help">
          Это не полный поиск: страницы магазинов проверяются выборочно, часть
          каталогов недоступна для автоматического чтения. Если нужной
          комплектации нет, вставьте ссылку на её страницу.
        </p>
      )}
    </details>
  );
}
