"use client";
import { useEffect, useRef, useState } from "react";
import { iconPack, iconPackByName, resolveIconAsset, mergeIconPack } from "../../lib/icon-pack.js";
import { SiteIcon, Upload } from "../ui/icons.jsx";
import styles from "./icon-pack-settings.module.css";

export async function uploadIconPack(file, params, signal) {
  const response = await fetch("/api/admin/icon-pack?" + new URLSearchParams(params), {
    method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file, signal,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Не удалось загрузить графику");
  return result;
}

// ZIP import is a separate task, not another copy of the per-slot editor.
export default function IconPackSettings({ settings, busy, onChange, onAssets, onBusyChange }) {
  const [plan, setPlan] = useState(null), [selected, setSelected] = useState([]);
  const [mode, setMode] = useState("missing"), [pending, setPending] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const archive = useRef(null), input = useRef(null), controller = useRef(null), latest = useRef(settings);
  latest.current = settings;
  useEffect(() => () => { controller.current?.abort(); onBusyChange(false); }, [onBusyChange]);
  const disabled = busy || pending;
  const eligible = plan?.icons.filter((icon) => selected.includes(icon.key) &&
    (mode === "replace" || !resolveIconAsset(settings, icon.key))) || [];
  async function run(work) {
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setError(""); setNotice(""); setPending(true); onBusyChange(true);
    try { await work(abort.signal); }
    catch (e) { if (e.name !== "AbortError") setError(e.message); }
    finally { if (!abort.signal.aborted) { setPending(false); onBusyChange(false); } }
  }
  async function preview(file) {
    setPlan(null); archive.current = null;
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setError("ZIP должен быть не больше 10 МБ"); return; }
    await run(async (signal) => {
      const result = await uploadIconPack(file, { action: "preview" }, signal);
      if (signal.aborted) return;
      archive.current = file; setPlan(result); setSelected(result.icons.map((icon) => icon.key));
    });
  }
  return <section className={"admin-panel " + styles.root} aria-labelledby="icon-pack-title" aria-busy={pending}>
    <h2 id="icon-pack-title">Первичная загрузка набора · {iconPack.length} иконки</h2>
    <p className="help">Выберите colabike-unified-icons.zip, проверьте состав, затем импортируйте в черновик. Из png/ выбираются PNG-мастера; SVG, превью и альтернативные размеры пропускаются. Баннеры и фотографии не меняются.</p>
    <fieldset disabled={disabled} className={styles.controls}>
      <button type="button" className="button secondary" onClick={() => input.current?.click()}><Upload size={16} />Выбрать ZIP</button>
      <input ref={input} hidden type="file" accept=".zip,application/zip" aria-label="Архив иконок" onChange={(event) => {
        const file = event.target.files?.[0]; event.target.value = ""; preview(file);
      }} />
      <small>До 10 МБ. Предпросмотр не записывает файлы на сервер.</small>
    </fieldset>
    {pending && <p role="status">Проверяем и подготавливаем графику…</p>}
    {error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {plan && <fieldset className={styles.plan} disabled={disabled}>
      <legend>Найдено {plan.icons.length} из {iconPack.length} слотов</legend>
      <div className={styles.actions}><label className={styles.mode}>Режим импорта
        <select value={mode} onChange={(event) => setMode(event.target.value)}>
          <option value="missing">Только заполнить пустые слоты</option><option value="replace">Заменить выбранные иконки</option>
        </select></label>
        <button type="button" className="quiet" onClick={() => setSelected(plan.icons.map((icon) => icon.key))}>Выбрать все</button>
        <button type="button" className="quiet" onClick={() => setSelected([])}>Снять выбор</button></div>
      <p className="help">Ненайденные и невыбранные значки останутся без изменений.</p>
      <div className={styles.previewList} tabIndex={0} aria-label="Состав архива">
        {plan.icons.map((icon) => {
          const current = resolveIconAsset(settings, icon.key), skipped = mode === "missing" && current;
          return <label key={icon.key} className={styles.previewRow}>
            <input type="checkbox" checked={selected.includes(icon.key)} disabled={Boolean(skipped)} onChange={(event) => setSelected((before) =>
              event.target.checked ? [...before, icon.key] : before.filter((key) => key !== icon.key))} />
            <span className={styles.samples} aria-hidden="true">{current ? <img src={"/api/assets/" + current} alt="" /> : <SiteIcon name={icon.key} original size={28} />}
              <span>→</span><img src={icon.preview} alt="" /></span>
            <span><strong>{iconPackByName[icon.key].label}</strong><code>{icon.key}</code>
              <small>{icon.width}×{icon.height} · {skipped ? "будет пропущен" : current ? "замена" : "новое назначение"}</small></span>
          </label>;
        })}
      </div>
      {plan.ignoredCount > 0 && <details><summary>Пропущено служебных файлов и альтернатив: {plan.ignoredCount}</summary>
        <pre className={styles.ignored}>{plan.ignored.join("\n")}</pre></details>}
      <div className={styles.actions}>
        <button type="button" className="button small" disabled={!eligible.length} onClick={() => run(async (signal) => {
          const result = await uploadIconPack(archive.current, { action: "stage", fingerprint: plan.fingerprint, keys: eligible.map((icon) => icon.key).join(",") }, signal);
          if (signal.aborted) return;
          onAssets(result.assets);
          onChange("uiIcons", (before) => mergeIconPack({ ...latest.current, uiIcons: before }, result.assignments, mode));
          setNotice(`Подготовлено иконок: ${result.assets.length}. Нажмите «Сохранить», чтобы опубликовать. Точечная замена — во вкладке «Графика».`);
          setPlan(null); archive.current = null;
        })}>Импортировать {eligible.length} иконок в черновик</button>
        <button type="button" className="quiet" onClick={() => { setPlan(null); archive.current = null; }}>Отмена</button>
      </div>
    </fieldset>}
  </section>;
}
