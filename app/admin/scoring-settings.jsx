"use client";
import { defaultScoring } from "../../lib/bike-score.js";
export default function ScoringSettings({ value = defaultScoring, onChange, catalog }) {
  const set=(key,v)=>onChange({...value,[key]:v});
  const rule=(i,key,v)=>set("rules",value.rules.map((r,n)=>n===i?{...r,[key]:v}:r));
  const number=(label,v,change,min,max)=><label className="field"><span>{label}</span><input type="number" min={min} max={max} step="any" value={v} onChange={e=>change(Number(e.target.value))}/></label>;
  return <section className="admin-panel">
    <h2>Формула прокаченности</h2>
    <p className="help">База + сумма совпавших правил + поправки за вес и открытую стоимость. Итог ограничен 0–100%. Каждое правило срабатывает один раз на велосипед; разные правила суммируются. Это настраиваемая оценка сообщества, а не техническая экспертиза.</p>
    <div className="form-grid">{Object.entries(catalog.categories).map(([key,label])=><div key={key}>{number("База: "+label,value.base[key],v=>set("base",{...value.base,[key]:v}),0,100)}</div>)}</div>
    {["weight","price"].map(key=><fieldset key={key}><legend>{key==="weight"?"Вес (кг)":"Стоимость велосипеда (₽)"}</legend>
      <div className="form-grid">{number("Базовое значение",value[key].reference,v=>set(key,{...value[key],reference:v}),0.01,999999999)}
      {number(key==="weight"?"Баллы за снижение веса на 10%":"Баллы за рост стоимости на 10%",value[key].pointsPer10Percent,v=>set(key,{...value[key],pointsPer10Percent:v}),-100,100)}</div>
      <p className="help">Обратное отклонение вычитает баллы; 0 отключает поправку. Незаданные значения не влияют. Скрытая стоимость не влияет на публичный рейтинг.</p>
    </fieldset>)}
    <h3>Компоненты-триггеры</h3>
    <p className="help">Все слова должны присутствовать в названии компонента, регистр не важен. Например: Fox +20, Suntour −10, Cues −10, Deore XT +15, Nexus +5, Alfine 11 +15. Выберите группу и при необходимости категорию. Аксессуары не учитываются.</p>
    {value.rules.map((r,i)=><fieldset key={i}><legend>Правило {i+1}</legend><div className="form-grid">
      <label className="field"><span>Группа</span><select value={r.groupId} onChange={e=>rule(i,"groupId",e.target.value)}><option value="">Все группы</option>{catalog.componentGroups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}<option value="other">Другое</option></select></label>
      <label className="field"><span>Категория</span><select value={r.category} onChange={e=>rule(i,"category",e.target.value)}><option value="">Любая</option>{catalog.partCategories.build.map(c=><option key={c}>{c}</option>)}</select></label>
      <label className="field"><span>Слова в названии</span><input value={r.match} maxLength={150} onChange={e=>rule(i,"match",e.target.value)}/></label>
      {number("Баллы (+/−)",r.points,v=>rule(i,"points",v),-100,100)}
    </div><button className="quiet" type="button" onClick={()=>set("rules",value.rules.filter((_,n)=>n!==i))}>Удалить правило</button></fieldset>)}
    <button className="button secondary" type="button" disabled={value.rules.length>=100} onClick={()=>set("rules",[...value.rules,{groupId:"",category:"",match:"",points:0}])}>Добавить правило</button>
    <h2>Заполненность карточки</h2>
    <p className="help">100% — есть собственное/импортированное фото и нужное число заполненных компонентов. Стоковое изображение и точные дубли компонентов не учитываются.</p>
    <div className="form-grid">{number("Компонентов для 100%",value.componentTarget,v=>set("componentTarget",v),1,200)}{number("Доля фотографии, %",value.photoPoints,v=>set("photoPoints",v),0,100)}</div>
  </section>;
}
