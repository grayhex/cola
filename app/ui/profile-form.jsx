"use client";
import { useState } from "react";
export default function ProfileForm({ user, busy, onSave }) {
  const [name,setName] = useState(user.name), [prefs,setPrefs] = useState(user.preferences || {});
  const set = (key,value) => setPrefs(p => { const next={...p}; if(value==="") delete next[key]; else next[key]=value; return next; });
  return <form onSubmit={e=>{e.preventDefault();onSave({name,preferences:prefs});}}>
    <p className="help">Ник виден рядом с публичными велосипедами. Оформление применяется только для вас.</p>
    <label className="field"><span>Ник автора</span><input required maxLength={60} value={name} onChange={e=>setName(e.target.value)}/></label>
    <p className="help">{user.email}</p>
    {[
      ["theme","Тема",[["light","Светлая"],["dark","Тёмная"],["system","Как на устройстве"]]],
      ["bikeLayout","Карточка велосипеда",[["dense","Компактная"],["balanced","Сбалансированная"],["spacious","Подробная"]]],
      ["font","Шрифт",[["manrope","Manrope"],["system","Системный"],["arial","Arial"],["georgia","Georgia"],["mono","Моноширинный"]]],
    ].map(([key,label,options])=><label className="field" key={key}><span>{label}</span><select value={prefs[key]||""} onChange={e=>set(key,e.target.value)}><option value="">Как на сайте</option>{options.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>)}
    <label className="field"><span>Цвет акцента</span><input type="color" value={prefs.accent||"#e7482f"} onChange={e=>set("accent",e.target.value)}/></label>
    <label className="admin-toggle"><span>Показывать пробег</span><input type="checkbox" checked={prefs.showMileage||false} onChange={e=>set("showMileage",e.target.checked)}/></label>
    <div className="form-actions"><button type="button" className="quiet" onClick={()=>setPrefs({})}>Сбросить оформление</button><button className="button" disabled={busy}>Сохранить</button></div>
  </form>;
}
