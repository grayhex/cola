"use client";
import { useEffect, useRef, useState } from "react";
import { iconPack, iconPackByName, resolveIconAsset, mergeIconPack } from "../../lib/icon-pack.js";
import { SiteIcon } from "../ui/icons.jsx";
import styles from "./icon-pack-settings.module.css";

async function upload(file, params, signal) {
  const response = await fetch("/api/admin/icon-pack?" + new URLSearchParams(params), {
    method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file, signal,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Не удалось загрузить графику");
  return result;
}
export default function IconPackSettings({ settings, assets, busy, onChange }) {
  const [search, setSearch] = useState("");
  const [plan, setPlan] = useState(null), [selected, setSelected] = useState([]);
  const [mode, setMode] = useState("replace"), [pending, setPending] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [staged, setStaged] = useState([]);
  const archive = useRef(null), controller = useRef(null), latest = useRef(settings);
  latest.current = settings;
  useEffect(() => () => controller.current?.abort(), []);
  const disabled = busy || pending;
  const allAssets = [...new Map([...assets, ...staged].map((asset) => [asset.id, asset])).values()];
  const eligible = plan?.icons.filter((icon) => selected.includes(icon.key) &&
    (mode === "replace" || !resolveIconAsset(settings, icon.key))) || [];
  async function run(work) {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setError(""); setNotice(""); setPending(true);
    try { await work(abort.signal); }
    catch (e) { if (e.name !== "AbortError") setError(e.message); }
    finally { if (!abort.signal.aborted) setPending(false); }
  }
  function accept(result, importMode = "replace") {
    setStaged((before) => [...before, ...result.assets]);
    onChange("uiIcons", mergeIconPack(latest.current, result.assignments, importMode));
    setNotice(`Подготовлено иконок: ${result.assets.length}. Для публикации нажмите «Сохранить настройки» внизу страницы.`);
  }
  async function preview(file) {
    setPlan(null); archive.current = null;
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setError("ZIP должен быть не больше 10 МБ"); return; }
    await run(async (signal) => {
      const result = await upload(file, { action: "preview" }, signal);
      if (signal.aborted) return;
      archive.current = file;
      setPlan(result); setSelected(result.icons.map((icon) => icon.key));
    });
  }
  return (
    <section className={styles.root} aria-labelledby="icon-pack-title" aria-busy={pending}>
      <h2 id="icon-pack-title">Единый набор ColaBike · 64 иконки</h2>
      <p className="help">
        Загрузите colabike-unified-icons.zip целиком. Выбираются PNG-мастера из png/;
        SVG, превью, исходники и версии других размеров пропускаются. Баннеры,
        логотип и фотографии не меняются. Затем можно заменить любой значок отдельно.
      </p>
      <fieldset disabled={disabled} className={styles.controls}>
        <label className={styles.upload}>
          <span>Выбрать ZIP для предпросмотра</span>
          <input type="file" accept=".zip,application/zip" onChange={(event) => {
            const file = event.target.files?.[0]; event.target.value = ""; preview(file);
          }} />
        </label>
        <small>ZIP до 10 МБ. Предпросмотр ничего не записывает на сервер.</small>
      </fieldset>
      {pending && <p role="status">Проверяем и подготавливаем графику…</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
      {plan && (
        <fieldset className={styles.plan} disabled={disabled}>
          <legend>Предпросмотр импорта: {plan.icons.length} из 64 слотов</legend>
          <p>Ненайденные и невыбранные значки останутся без изменений.</p>
          <label className={styles.mode}>Режим
            <select value={mode} onChange={(event) => setMode(event.target.value)}>
              <option value="replace">Заменить выбранные иконки</option>
              <option value="missing">Только заполнить пустые слоты</option>
            </select>
          </label>
          <div className={styles.actions}>
            <button type="button" className="quiet" onClick={() => setSelected(plan.icons.map((icon) => icon.key))}>Выбрать все</button>
            <button type="button" className="quiet" onClick={() => setSelected([])}>Снять выбор</button>
          </div>
          <div className={styles.previewList}>
            {plan.icons.map((icon) => {
              const current = resolveIconAsset(settings, icon.key);
              const skipped = mode === "missing" && current;
              return (
                <label key={icon.key} className={styles.previewRow}>
                  <input type="checkbox" checked={selected.includes(icon.key)} disabled={Boolean(skipped)}
                    onChange={(event) => setSelected((before) => event.target.checked ? [...before, icon.key] : before.filter((key) => key !== icon.key))} />
                  <span className={styles.samples} aria-hidden="true">
                    {current ? <img src={"/api/assets/" + current} alt="" /> : <SiteIcon name={icon.key} original size={32} />}
                    <span>→</span><img src={icon.preview} alt="" />
                  </span>
                  <span><strong>{iconPackByName[icon.key].label}</strong><code>{icon.key}</code>
                    <small>{icon.width}×{icon.height} · {skipped ? "будет пропущен" : current ? "замена" : "новое назначение"}</small>
                  </span>
                </label>
              );
            })}
          </div>
          {plan.ignoredCount > 0 && <details><summary>Пропущено служебных файлов и альтернатив: {plan.ignoredCount}</summary>
            <p className="help">Первые {plan.ignored.length} путей:</p>
            <pre className={styles.ignored}>{plan.ignored.join("\n")}</pre>
          </details>}
          <div className={styles.actions}>
            <button type="button" className="button small" disabled={!eligible.length} onClick={() => run(async (signal) => {
              const result = await upload(archive.current, { action: "stage", fingerprint: plan.fingerprint, keys: eligible.map((icon) => icon.key).join(",") }, signal);
              if (signal.aborted) return;
              accept(result, mode); setPlan(null); archive.current = null;
            })}>Импортировать {eligible.length} иконок в настройки</button>
            <button type="button" className="quiet" onClick={() => { setPlan(null); archive.current = null; }}>Отмена</button>
          </div>
        </fieldset>
      )}
      <label className={styles.search}>Найти слот
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Например: saved, журнал, фильтры" />
      </label>
      <p className="help">Эти слоты имеют приоритет над прежними значками навигации и Lucide.
        «Встроенный» отключает замену в конкретном слоте. Все изменения публикуются штатным сохранением настроек.</p>
      {[...new Set(iconPack.map((icon) => icon.group))].map((group) => {
        const visible = iconPack.filter((icon) => icon.group === group &&
          (icon.name + " " + icon.label).toLowerCase().includes(search.toLowerCase()));
        if (!visible.length) return null;
        return <details key={group} className={styles.group} open={search ? true : undefined}>
          <summary>{group} · {visible.length}</summary>
          <div className={styles.grid}>
            {visible.map((icon) => {
              const value = resolveIconAsset(settings, icon.name);
              return <article key={icon.name} className={styles.tile}>
                <div className={styles.samples} aria-hidden="true">
                  {value ? <><img src={"/api/assets/" + value} alt="" /><img src={"/api/assets/" + value} alt="" width="24" height="24" /></>
                    : <SiteIcon name={icon.name} original size={32} />}
                </div>
                <strong>{icon.label}</strong><code>{icon.name}</code>
                <select aria-label={"Иконка: " + icon.label} disabled={disabled} value={value || ""}
                  onChange={(event) => onChange("uiIcons", { ...latest.current.uiIcons, [icon.name]: event.target.value || null })}>
                  <option value="">Встроенный значок</option>
                  {allAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
                </select>
                <label className={styles.upload}>Заменить PNG / WebP
                  <input type="file" accept="image/png,image/webp" disabled={disabled}
                    aria-label={"Загрузить " + icon.name} onChange={(event) => {
                      const file = event.target.files?.[0]; event.target.value = "";
                      if (file) run(async (signal) => {
                        const result = await upload(file, { action: "single", slot: icon.name }, signal);
                        if (!signal.aborted) accept(result);
                      });
                    }} />
                </label>
                <button type="button" className="quiet" disabled={disabled || !value}
                  onClick={() => onChange("uiIcons", { ...latest.current.uiIcons, [icon.name]: null })}>Встроенный</button>
              </article>;
            })}
          </div>
        </details>;
      })}
    </section>
  );
}
