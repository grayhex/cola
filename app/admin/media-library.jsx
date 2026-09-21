"use client";
import { useRef, useState } from "react";
import { assetUsageLabels } from "../../lib/site-assets.js";
import { Trash2, Upload } from "../ui/icons.jsx";
import { Pager } from "./design-controls.jsx";
import styles from "./design.module.css";

const pageSize = 12;
export default function MediaLibrary({ assets, draft, saved, busy, onUpload, onDelete, onConfirm }) {
  const [search, setSearch] = useState(""), [filter, setFilter] = useState("all"), [page, setPage] = useState(1);
  const file = useRef(null), latest = useRef(null);
  const rows = assets.map((asset) => ({ ...asset, labels: assetUsageLabels(asset, draft, saved) }));
  const unused = rows.filter((asset) => !asset.labels.length);
  latest.current = new Set(unused.map((asset) => asset.id));
  const term = search.trim().toLocaleLowerCase("ru");
  const visible = rows.filter((asset) => (asset.name || asset.id).toLocaleLowerCase("ru").includes(term) &&
    (filter === "all" || (filter === "unused" ? !asset.labels.length : asset.labels.length)));
  const pages = Math.max(1, Math.ceil(visible.length / pageSize)), current = Math.min(page, pages);
  function confirmDelete(ids) {
    onConfirm(`Удалить изображения (${ids.length})?`,
      "Будут удалены только неиспользуемые файлы графики сайта. Назначения в опубликованных настройках, текущем черновике, иконках и наградах защищены. Фотографии пользовательских велосипедов не затрагиваются. Действие нельзя отменить.",
      () => onDelete(ids.filter((id) => latest.current.has(id))));
  }
  return <section className={"admin-panel " + styles.compactPanel} aria-label="Медиатека сайта">
    <div className={styles.sectionHeading}><div><h2>Медиатека сайта</h2><p className="help">Всего: {assets.length} · Не используются: {unused.length}. JPEG, PNG, WebP до 10 МБ; файлы публичны.</p></div>
      <div className={styles.actions}><button type="button" className="button secondary small" disabled={busy} onClick={() => file.current?.click()}><Upload size={16} />Загрузить</button>
        <button type="button" className="quiet danger" disabled={busy || !unused.length} onClick={() => confirmDelete(unused.map((asset) => asset.id))}>
          <Trash2 size={16} />Удалить неиспользуемые ({unused.length})</button></div></div>
    <input ref={file} hidden type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} aria-label="Загрузить файл в медиатеку"
      onChange={(e) => { const selected = e.target.files?.[0]; e.target.value = ""; if (selected) onUpload(selected); }} />
    <div className={styles.toolbar}>
      <label className="field"><span>Найти файл</span><input type="search" value={search} placeholder="Название изображения" onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></label>
      <label className="field"><span>Использование</span><select value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }}>
        <option value="all">Все файлы</option><option value="used">Используемые</option><option value="unused">Неиспользуемые</option>
      </select></label>
    </div>
    <div className={styles.mediaList}>
      {visible.slice((current - 1) * pageSize, current * pageSize).map((asset) => <article key={asset.id} className={styles.mediaRow}>
        <a className={styles.mediaThumb} href={"/api/assets/" + asset.id} target="_blank" rel="noreferrer" aria-label={"Открыть оригинал: " + asset.name}>
          <img src={"/api/assets/" + asset.id} width="48" height="48" loading="lazy" alt="" /></a>
        <div className={styles.mediaInfo}><strong title={asset.name}>{asset.name}</strong>
          <small title={asset.labels.join(" · ")}>{asset.labels.join(" · ") || "Не используется"}</small>
          <small>{asset.created_at ? new Date(asset.created_at).toLocaleDateString("ru-RU") : "Только загружено"}</small></div>
        <button type="button" className={"icon danger " + styles.removeAsset} disabled={busy || !!asset.labels.length}
          title={asset.labels.length ? "Сначала снимите все назначения и сохраните настройки" : "Удалить изображение"}
          aria-label={"Удалить: " + asset.name} onClick={() => confirmDelete([asset.id])}><Trash2 size={16} /></button>
      </article>)}
    </div>
    {!visible.length && <p className={styles.empty}>{assets.length ? "Нет файлов по выбранному фильтру." : "Загрузите первое изображение."}</p>}
    <Pager page={current} pages={pages} total={visible.length} onChange={setPage} label="Страницы медиатеки" />
  </section>;
}
