"use client";
import { bikeCategories } from "../../lib/bike-classification.js";
import { useState } from "react";
import { Plus, Trash2, ChevronUp, ChevronDown } from "../ui/icons.jsx";
import PartIcon from "../ui/part-icon.jsx";
import { iconNames, categoryIcons } from "../../lib/part-icons.js";
import ExperienceCatalog from "./experience-catalog.jsx";
import { Field, Select } from "./design-controls.jsx";

function ListEditor({ values, onChange, label }) {
  const [newValue, setNew] = useState("");
  function add() {
    if (!newValue.trim() || values.includes(newValue.trim())) return;
    onChange([...values, newValue.trim()]); setNew("");
  }
  function move(i, delta) {
    if (i + delta < 0 || i + delta >= values.length) return;
    const next = [...values]; [next[i], next[i + delta]] = [next[i + delta], next[i]]; onChange(next);
  }
  return <div className="list-editor">
    <div className="list-add"><input aria-label={"Новое значение: " + label} placeholder="Новое название" value={newValue}
      onChange={(e) => setNew(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
      <button type="button" className="button secondary" disabled={!newValue.trim() || values.includes(newValue.trim())} onClick={add}><Plus size={18} />Добавить</button></div>
    <p className="help">{values.length} записей. Названия можно редактировать; стрелки меняют порядок.</p>
    {values.map((value, index) => <div className="list-row" key={index}>
      <input aria-label={label + " " + (index + 1)} value={value} maxLength={150} onChange={(e) => onChange(values.map((v, i) => i === index ? e.target.value : v))} />
      <button type="button" className="icon" aria-label="Выше" disabled={index === 0} onClick={() => move(index, -1)}><ChevronUp size={17} /></button>
      <button type="button" className="icon" aria-label="Ниже" disabled={index === values.length - 1} onClick={() => move(index, 1)}><ChevronDown size={17} /></button>
      <button type="button" className="icon danger" aria-label={"Убрать " + value} onClick={() => onChange(values.filter((_, i) => i !== index))}><Trash2 size={17} /></button>
    </div>)}
  </div>;
}

export default function CatalogEditor({ value: c, onChange }) {
  const [kind, setKind] = useState("bikes"), [type, setType] = useState("gravel"), [brand, setBrand] = useState("");
  const [newBrand, setNewBrand] = useState(""), [brandName, setBrandName] = useState(""), [section, setSection] = useState("build"), [category, setCategory] = useState("");
  const brands = Object.keys(c.models[type] || {});
  const selectedBrand = brands.includes(brand) ? brand : brands[0] || "";
  const allCategories = [...new Set([...c.partCategories.build, ...c.partCategories.accessories, ...Object.keys(c.parts)])];
  const selectedCategory = allCategories.includes(category) ? category : allCategories[0] || "";
  function models(next) { onChange({ ...c, models: { ...c.models, [type]: next } }); }
  return <section className="admin-panel">
    <div className="catalog-tabs">
      {[["bikes", "Марки и модели"], ["sizes", "Ростовки"], ["manufacturers", "Производители"], ["categories", "Категории навески"], ["parts", "Модели компонентов"], ["types", "Типы велосипедов"], ["experience", "Поиск и опыт"]].map(([key, label]) =>
        <button key={key} className={kind === key ? "active" : ""} onClick={() => setKind(key)}>{label}</button>)}
    </div>
    <p className="help">Изменения применяются к подсказкам для новых записей. Сохранённые велосипеды и детали не меняются.</p>
    {kind === "experience" && <ExperienceCatalog value={c} onChange={onChange} />}
    {kind === "bikes" && <>
      <Select label="Тип велосипеда" value={type} onChange={(v) => { setType(v); setBrand(""); setBrandName(""); }} options={Object.entries(c.categories)} />
      <div className="list-add"><input aria-label="Новая марка" value={newBrand} placeholder="Новая марка велосипеда" onChange={(e) => setNewBrand(e.target.value)} />
        <button className="button secondary" disabled={!newBrand.trim() || brands.includes(newBrand.trim())}
          onClick={() => { models({ ...c.models[type], [newBrand.trim()]: [] }); setBrand(newBrand.trim()); setNewBrand(""); }}><Plus size={17} />Добавить</button></div>
      {brands.length > 0 && <>
        <Select label="Марка" value={selectedBrand} onChange={(v) => { setBrand(v); setBrandName(""); }} options={brands.map((b) => [b, b])} />
        <div className="list-add"><input aria-label="Новое название марки" value={brandName} placeholder={"Переименовать " + selectedBrand} onChange={(e) => setBrandName(e.target.value)} />
          <button className="button secondary" disabled={!brandName.trim() || brands.includes(brandName.trim())} onClick={() => {
            models(Object.fromEntries(Object.entries(c.models[type]).map(([key, value]) => [key === selectedBrand ? brandName.trim() : key, value])));
            setBrand(brandName.trim()); setBrandName("");
          }}>Переименовать</button></div>
        <h3>Модели {selectedBrand}</h3><ListEditor label="Модель велосипеда" values={c.models[type]?.[selectedBrand] || []} onChange={(value) => models({ ...c.models[type], [selectedBrand]: value })} />
        <button className="quiet danger" onClick={() => { const next = { ...c.models[type] }; delete next[selectedBrand]; models(next); setBrand(""); }}>Убрать марку из справочника</button>
      </>}
    </>}
    {kind === "sizes" && <ListEditor label="Ростовка" values={c.sizes || ["XS", "S", "M", "L", "XL"]} onChange={(value) => onChange({ ...c, sizes: value })} />}
    {kind === "manufacturers" && <ListEditor label="Производитель" values={c.manufacturers} onChange={(value) => onChange({ ...c, manufacturers: value })} />}
    {kind === "categories" && <>
      <Select label="Раздел" value={section} onChange={setSection} options={[["build", "Комплектация"], ["accessories", "Аксессуары"]]} />
      <ListEditor label="Категория" values={c.partCategories[section]} onChange={(value) => onChange({ ...c, partCategories: { ...c.partCategories, [section]: value } })} />
      <p className="help">После переименования категории её модели останутся под прежним названием. Их можно перенести в разделе «Модели компонентов».</p>
    </>}
    {kind === "parts" && <>
      <Select label="Категория компонента" value={selectedCategory} onChange={setCategory} options={allCategories.map((x) => [x, x])} />
      <div className="icon-picker"><PartIcon category={selectedCategory} icons={c.icons} size={42} />
        <Select label="Иконка категории" value={c.icons[selectedCategory] || categoryIcons[selectedCategory] || "other"}
          onChange={(v) => onChange({ ...c, icons: { ...c.icons, [selectedCategory]: v } })}
          options={iconNames.map((key) => [key, Object.entries(categoryIcons).find(([, value]) => value === key)?.[0] || key])} /></div>
      <ListEditor label="Модель компонента" values={c.parts[selectedCategory] || []} onChange={(value) => onChange({ ...c, parts: { ...c.parts, [selectedCategory]: value } })} />
      <Select label="Скопировать модели в другую категорию" value="" onChange={(target) => {
        if (target) onChange({ ...c, parts: { ...c.parts, [target]: [...new Set([...(c.parts[target] || []), ...(c.parts[selectedCategory] || [])])] } });
      }} options={[["", "Выберите категорию"], ...allCategories.filter((key) => key !== selectedCategory).map((key) => [key, key])]} />
    </>}
    {kind === "types" && Object.keys(bikeCategories).map((key) => [key, c.categories[key] || bikeCategories[key]]).map(([key, label]) => <Field key={key} label={"Название типа: " + key}>
      <input value={label} onChange={(e) => onChange({ ...c, categories: { ...c.categories, [key]: e.target.value } })} /></Field>)}
  </section>;
}
