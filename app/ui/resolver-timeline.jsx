"use client";
import { Check, LoaderCircle, TriangleAlert } from "lucide-react";
const labels = {
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
export default function ResolverTimeline({ events, running }) {
  if (!events.length && !running) return null;
  const significant = events.filter(
    (e) =>
      ![
        "extractor_started",
        "cache_checked",
        "source_started",
        "completed",
      ].includes(e.event) && !(e.event === "fields_extracted" && !e.count),
  );
  function rows(list) {
    return (
      <ol>
        {list.map((e, i) => (
          <li key={i}>
            {["source_failed", "conflict_found", "failed"].includes(e.event) ? (
              <TriangleAlert size={13} />
            ) : (
              <Check size={13} />
            )}
            <span>
              {labels[e.event]}
              {e.host && <small>{e.host}</small>}
              {e.strategy && <small>{e.strategy}</small>}
            </span>
            {e.count !== undefined && (
              <b>
                {e.count}
                {e.total !== undefined ? ` / ${e.total}` : ""}
              </b>
            )}
            <time>{(e.elapsedMs / 1000).toFixed(1)} с</time>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <div className="resolver-timeline" aria-label="Ход поиска комплектации">
      {running && (
        <p role="status">
          <LoaderCircle size={14} className="resolver-spinner" />
          {labels[events.at(-1)?.event] || "Подключаем парсер…"}
        </p>
      )}
      {running && rows(significant.slice(-4))}
      <details>
        <summary>Подробнее · {events.length} событий</summary>
        {rows(events)}
      </details>
    </div>
  );
}
