// Pure, shared by Resolver, the wizard and the offline rebuild. No network or DOM.
/** @typedef {{type?: string, brand?: string|null, model?: string|null, family?: string|null, description?: string, attributes?: Record<string,string|number|boolean>, raw?: {label?: string, value?: string}}} Part */
/** @type {Record<string, string>} */
const entities = {
  nbsp: " ",
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  times: "x",
  ndash: "-",
  mdash: "-",
  reg: "",
  trade: "",
  copy: "",
};
/** @param {unknown} value */
export function componentText(value) {
  let s = typeof value === "string" ? value : "";
  for (let i = 0; i < 3; i++) {
    const next = s.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
      if (code[0] !== "#") return entities[code.toLowerCase()] ?? whole;
      const n =
        code[1].toLowerCase() === "x"
          ? parseInt(code.slice(2), 16)
          : Number(code.slice(1));
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
        ? String.fromCodePoint(n)
        : " ";
    });
    if (next === s) break;
    s = next;
  }
  return s
    .replace(/<\/?[a-z][^>]*>/gi, " ")
    .replace(/[™®©]/g, "")
    .normalize("NFKC")
    .replace(/[™®©\u0000-\u001f\u007f]/g, " ")
    .replace(/[×]/g, "x")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\s+([,;:])/g, "$1")
    .trim();
}
/** @param {unknown} value */
export function absentComponent(value) {
  const s = componentText(value).replace(/^[\s:;|.,-]+|[\s:;|.,-]+$/g, "");
  return (
    !s ||
    /^(?:n\/?a|n\.?d\.?|none(?: included)?|(?:pedals? )?not (?:available|included|specified|applicable|supplied)|unspecified|no (?:pedals|component)|without pedals|нет|отсутствует|не (?:указан[аоы]?|предусмотрен[аоы]?|входит в комплект)|без педалей)$/i.test(
      s,
    )
  );
}
/** @type {Record<string, string>} */
const positions = {
  "front tire": "front_tire",
  "front tyre": "front_tire",
  "rear tire": "rear_tire",
  "rear tyre": "rear_tire",
  "передняя покрышка": "front_tire",
  "задняя покрышка": "rear_tire",
  "front brake": "front_brake",
  "rear brake": "rear_brake",
  "передний тормоз": "front_brake",
  "задний тормоз": "rear_brake",
};
/** Recover labelled subfields in saved flattened specs as well as new HTML. @param {string} label @param {string} value */
export function splitComponentField(label, value) {
  const clean = componentText(value);
  const matches = [
    ...clean.matchAll(
      /(?:^|[\s;|:])((?:Front|Rear) (?:Tire|Tyre|Brake)|(?:Передняя|Задняя) покрышка|(?:Передний|Задний) тормоз)\s*[:：]\s*/gi,
    ),
  ];
  if (!matches.length) return [{ label: componentText(label), value: clean }];
  return matches.map((m, i) => ({
    label: m[1],
    type: positions[m[1].toLowerCase()],
    value: clean
      .slice(m.index + m[0].length, matches[i + 1]?.index ?? clean.length)
      .replace(/[\s;|:]+$/g, ""),
  }));
}
const brands = [
  "Busch & Müller",
  "DT Swiss",
  "Selle Royal",
  "Selle Italia",
  "Race Face",
  "SR Suntour",
  "X-Fusion",
  "RockShox",
  "Continental",
  "Specialized",
  "Schwalbe",
  "Shimano",
  "SRAM",
  "Gates",
  "CUBE",
  "ACID",
  "Brooks",
  "FSA",
  "FOX",
  "Bosch",
  "Canyon",
  "Giant",
  "Syncros",
  "Maxxis",
  "Roval",
  "Fizik",
  "Ergon",
  "WTB",
  "Kenda",
  "Tektro",
  "TRP",
  "Promax",
  "Magura",
  "Ritchey",
  "Bontrager",
  "Zipp",
  "Easton",
  "Mavic",
  "Fulcrum",
  "Campagnolo",
  "KMC",
  "Pirelli",
  "Panaracer",
  "Vittoria",
  "Truvativ",
  "Newmen",
  "Alexrims",
  "Formula",
  "Bafang",
  "Tange",
  "VP",
  "Wellgo",
  "Cane Creek",
  "OneUp",
  "KS",
  "Öhlins",
];
const generic =
  /^(?:alloy|aluminium|aluminum|carbon|steel|integrated|internal|sealed|hydraulic|disc|one-piece|custom|интегрированн|внутренн|закрыт|алюмини|сталь|карбон|гидравлическ)/i;
/** A conservative catalog identity; unidentifiable equipment stays in factory_spec. @param {Part} c */
export function componentIdentity(c) {
  const description = componentText(c.description || c.raw?.value).replace(
    /^["\']|["\']$/g,
    "",
  );
  if (absentComponent(description)) return null;
  let brand =
    brands.find(
      (b) =>
        description.toLowerCase() === b.toLowerCase() ||
        description.toLowerCase().startsWith(b.toLowerCase() + " ") ||
        description.toLowerCase().startsWith(b.toLowerCase() + ","),
    ) || componentText(c.brand);
  let lead = description
    .replace(/^["']|["']$/g, "")
    .split(/[,;|]/)[0]
    .trim();
  // These branded products are routinely listed without a manufacturer prefix.
  if (
    !brand &&
    /^(?:front_tire|rear_tire|tire)$/.test(c.type || "") &&
    /^(Butcher|Eliminator|Ground Control|Fast Trak|Pathfinder)\b/i.test(lead)
  )
    brand = "Specialized";
  if (!brand || brand.length > 60 || generic.test(brand)) return null;
  if (lead.toLowerCase().startsWith(brand.toLowerCase()))
    lead = lead.slice(brand.length).trim();
  const attributes = { ...c.attributes };
  const size = description.match(
    /\b(\d{2,3}(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\b/i,
  );
  if (size) attributes.size = size[1] + "x" + size[2];
  const speeds = description.match(
    /\b(\d{1,2})\s*[- ]?\s*(?:speed|gang|ск(?:оростей|орости)?)(?:\b|$)/i,
  );
  if (speeds) attributes.speeds = Number(speeds[1]);
  const teeth = description.match(/\b(\d{1,3})T\b/i);
  if (teeth && /chainring|sprocket|belt|crankset/.test(c.type || ""))
    attributes.teeth = Number(teeth[1]);
  const family =
    componentText(c.family) ||
    lead.match(
      /\b(Alfine|Nexus|Dura-Ace|Ultegra|GRX|Deore|XT|XTR|Force|Rival|Red|CDX|CDN)\b/i,
    )?.[1] ||
    "";
  // Keep meaningful product suffixes; dimensions/casing/marketing are attributes.
  let model = componentText(c.model) || lead;
  if (model.toLowerCase().startsWith(brand.toLowerCase() + " "))
    model = model.slice(brand.length).trim();
  model = model
    .replace(
      /\s+(?:\d{1,3}(?:\.\d+)?\s*x\s*\d.*|\d+(?:[.,]\d+)?\s*(?:mm|мм|TPI)\b.*|\d+[- ]?(?:speed|gang)\b.*|\d{2,3}-\d{3}\b.*|(?:hydraulic|mechanical|disc|rotors?)\b.*|EXO(?:\+|\/TR)?\b.*|TR\b.*|tubeless\b.*|folding\b.*|(?:with|гидравлическ\S*|дисков\S*|диск|возможно)\s.*)$/i,
      "",
    )
    .replace(/["'\s:;|,-]+$/g, "")
    .trim();
  // A structured model takes precedence over prose, but still must be a name.
  if (
    !model ||
    model === brand ||
    model.length > 100 ||
    model.split(/\s+/).length > 12 ||
    generic.test(model) ||
    /[!?]|\.(?:\s|$)|&#?\w+;/.test(model)
  )
    return null;
  const hasFamily =
    family && model.toLowerCase().includes(family.toLowerCase());
  const name = [brand, !hasFamily && family ? family : "", model]
    .filter(Boolean)
    .join(" ");
  return { brand, family, model, name, description, attributes };
}
