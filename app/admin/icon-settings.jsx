"use client";
import { useState } from "react";
import { illustrationSlots, interfaceSlots, componentSlots, graphicAsset, filterGraphicSlots } from "../../lib/design-graphics.js";
import { SiteIcon } from "../ui/icons.jsx";
import PartIcon from "../ui/part-icon.jsx";
import AssetPicker from "./asset-picker.jsx";
import { SectionTabs, Pager } from "./design-controls.jsx";
import styles from "./design.module.css";

const catalogs = { illustrations: illustrationSlots, icons: interfaceSlots, components: componentSlots };
const pageSize = 8;
export default function IconSettings({ settings, assets, busy, onChange, onUpload }) {
  const [kind, setKind] = useState("illustrations");
  const [search, setSearch] = useState(""), [group, setGroup] = useState("all"), [page, setPage] = useState(1);
  const slots = catalogs[kind];
  const visible = filterGraphicSlots(slots, search, group);
  const pages = Math.max(1, Math.ceil(visible.length / pageSize));
  const current = Math.min(page, pages);
  function assign(slot, id) {
    if (slot.target === "setting") onChange(slot.key, id);
    else onChange(slot.target === "semantic" ? "uiIcons" : slot.target, (before) => ({ ...before, [slot.key]: id }));
  }
  return <section className={"admin-panel " + styles.compactPanel} aria-label="Графика сайта">
    <p className="help">Контентные иллюстрации сохраняются. Иконки, старые баннеры и фон находятся в Legacy и не используются новым интерфейсом. Hero меняется во вкладке «Главная».</p>
    <SectionTabs label="Виды графики" items={[["illustrations", "Контентная графика"], ["icons", "Legacy · иконки"], ["components", "Legacy · компоненты"]]}
      value={kind} onChange={(next) => { setKind(next); setGroup("all"); setSearch(""); setPage(1); }}>
      {() => <>
        <div className={styles.toolbar}>
          <label className="field"><span>Найти графику</span><input type="search" value={search}
            placeholder="Например: Дизайн, Журнал, Palette" onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></label>
          <label className="field"><span>Группа</span><select value={group} onChange={(e) => { setGroup(e.target.value); setPage(1); }}>
            <option value="all">Все группы</option>
            {[...new Set(slots.map((slot) => slot.group))].map((name) => <option key={name} value={name}>{name}</option>)}
          </select></label>
        </div>
        <div className={styles.graphicGrid}>
          {visible.slice((current - 1) * pageSize, current * pageSize).map((slot) => <AssetPicker
            key={slot.target + ":" + slot.key} compact label={slot.label} help={`${slot.group} · ${slot.key}`}
            emptyLabel={slot.emptyLabel || "Встроенный значок"} value={graphicAsset(settings, slot)}
            assets={assets} busy={busy} previewClassName={kind === "illustrations" ? "wide" : "icon"}
            accept={slot.target === "semantic" ? "image/png,image/webp" : "image/jpeg,image/png,image/webp"}
            Fallback={slot.target === "partIconAssets" ? (props) => <PartIcon {...props} name={slot.key} original />
              : (props) => <SiteIcon {...props} name={slot.fallback || (slot.target === "setting" ? "Image" : slot.key)} original />}
            onChange={(id) => assign(slot, id)} onUpload={async (file) => {
              const asset = await onUpload(file, slot);
              if (asset) assign(slot, asset.id);
            }} />)}
        </div>
        {!visible.length && <p className={styles.empty}>Ничего не найдено. Измените запрос или группу.</p>}
        <Pager page={current} pages={pages} total={visible.length} onChange={setPage} label="Страницы графики" />
      </>}
    </SectionTabs>
  </section>;
}
