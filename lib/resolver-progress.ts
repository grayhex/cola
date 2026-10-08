import type { TraceEvent } from "./resolver-stream.ts";

// What a person reads of the Resolver's stream (#374). One place for the words,
// shared by the wizard's short status and the admin Inspector's full log; the
// stream itself is not changed: every line here comes from an event that
// arrived, and nothing is planned, counted ahead or guessed.
export const traceLabels: Record<string, string> = {
  retailer_search_started: "Ищем комплектацию в магазинах",
  resolve_started: "Начинаем поиск",
  cache_checked: "Проверяем кеш",
  cache_hit: "Найдено в кеше",
  source_planned: "Источники поиска",
  source_started: "Проверяем источник",
  source_connected: "Соединение установлено",
  discovery_started: "Ищем модель в каталоге",
  candidate_found: "Найдены варианты",
  candidate_selected: "Модель выбрана",
  store_checked: "Магазин проверен",
  document_fetch_started: "Загружаем страницу",
  document_fetched: "Страница загружена",
  structured_data_found: "Найдены данные страницы",
  spec_section_found: "Найден раздел комплектации",
  extractor_started: "Анализируем разметку",
  fields_extracted: "Извлечены характеристики",
  normalization_started: "Определяем компоненты",
  components_recognized: "Компоненты распознаны",
  source_failed: "Источник не дал комплектацию",
  fallback_started: "Пробуем другой способ",
  conflict_found: "Есть расхождения — проверьте результат",
  resolved: "Комплектация готова",
  partial: "Часть комплектации готова",
  failed: "Поиск завершён без комплектации",
  completed: "Поиск завершён",
};
export const failureReasons: Record<string, string> = {
  http_403: "сайт отклонил запрос",
  access_challenge: "сайт требует проверку посетителя",
  http_429: "слишком много запросов",
  timeout: "не ответил вовремя",
  dns_failed: "адрес не найден",
  blocked_source: "адрес заблокирован настройками",
  connection_failed: "нет соединения",
};
// Events that tell a person little on their own: no line for them.
const quiet = new Set([
  "extractor_started",
  "cache_checked",
  "source_started",
  "completed",
]);
export const significantEvents = (events: TraceEvent[]) =>
  events.filter(
    (e) => !quiet.has(e.event) && !(e.event === "fields_extracted" && !e.count),
  );

/** How a search ended, for the one line that stays after it. */
export type ProgressOutcome =
  | "resolved"
  | "partial"
  | "ambiguous"
  | "not_found"
  | "unsupported_brand"
  | "upstream_unavailable"
  | "parse_error"
  | "cancelled"
  | "failed";
export const outcomeText: Record<ProgressOutcome, string> = {
  resolved: "Комплектация готова",
  partial: "Часть комплектации готова",
  ambiguous: "Нашли варианты — выберите свой",
  not_found: "Комплектация не найдена",
  unsupported_brand: "Для этой марки автоподбор недоступен",
  upstream_unavailable: "Часть источников недоступна",
  parse_error: "Страницу не удалось прочитать",
  cancelled: "Поиск остановлен",
  failed: "Поиск не завершился",
};
export function outcomeOf(result: {
  status: string;
  quality?: { level?: string } | null;
}): ProgressOutcome {
  if (result.status === "resolved")
    return result.quality?.level === "partial" ? "partial" : "resolved";
  return result.status in outcomeText
    ? (result.status as ProgressOutcome)
    : "not_found";
}

export interface ProgressStage {
  text: string;
  /** Only when the event that says it names a site. */
  host?: string;
  note?: string;
}
/** The phrase for what is going on now: the last event decides, nothing else. */
export function currentStage(events: TraceEvent[]): ProgressStage {
  const last = events.at(-1);
  if (!last) return { text: "Начинаем поиск" };
  const text = traceLabels[last.event] || "Идёт поиск";
  const stage: ProgressStage = { text };
  if (last.host) stage.host = last.host;
  // A failed source is not «found»: the search moves on, and says so.
  if (last.event === "source_failed") {
    stage.text += ", ищем дальше";
    const reason = last.reason && (failureReasons[last.reason] || last.reason);
    if (reason) stage.note = reason;
  } else if (last.event === "candidate_found" && last.count !== undefined)
    stage.note = String(last.count);
  return stage;
}

/** The last answer of the normalizer about one page: its own two numbers. */
export function recognizedCount(events: TraceEvent[]) {
  const event = events.findLast((e) => e.event === "components_recognized");
  return event && event.count !== undefined
    ? { count: event.count, total: event.total }
    : null;
}

export interface RibbonItem {
  /** Index of the first event of the group: stable while the tail slides. */
  key: number;
  text: string;
  repeats: number;
}
/**
 * The tail of the events a person would want: noisy repeats (the same event
 * several times in a row, one per page or site) become one item with a count.
 */
export function ribbonOf(events: TraceEvent[], limit = 6): RibbonItem[] {
  const items: RibbonItem[] = [];
  events.forEach((event, index) => {
    if (!significantEvents([event]).length) return;
    const text = traceLabels[event.event];
    const previous = items.at(-1);
    if (previous && previous.text === text) previous.repeats += 1;
    else items.push({ key: index, text, repeats: 1 });
  });
  return items.slice(-limit);
}
export const ribbonText = (items: RibbonItem[]) =>
  items
    .map((item) => item.text + (item.repeats > 1 ? ` ×${item.repeats}` : ""))
    .join(" · ");
