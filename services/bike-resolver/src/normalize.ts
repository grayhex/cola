import { load } from "cheerio";
import {
  componentTypes,
  type BikeComponent,
  type ComponentType,
} from "./domain.js";
export const normalize = (s: string | null | undefined) =>
  load("<span></span>")("span")
    .html(s || "")
    .text()
    .replace(/[™®©]/g, "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
export const queryKey = (q: {
  brand: string;
  model: string;
  trim: string | null;
  year: number;
}) =>
  JSON.stringify([
    normalize(q.brand),
    normalize(q.model),
    normalize(q.trim),
    q.year,
  ]);
const aliases: Partial<Record<ComponentType, string[]>> = {
  frame: ["rahmen"],
  fork: ["gabel"],
  rear_shock: ["shock", "dämpfer"],
  rear_derailleur: ["schaltwerk"],
  front_derailleur: ["umwerfer"],
  shifter: ["shifters", "shift levers", "schalthebel"],
  crankset: ["crank", "cranks", "kurbelgarnitur"],
  bottom_bracket: ["innenlager"],
  chainring: ["chainrings"],
  chain: ["kette"],
  rear_sprocket: ["nabenritzel"],
  brake: ["brakes", "brake system", "bremsanlage"],
  brake_lever: ["brake levers", "shift brake lever"],
  front_hub: ["vorderrad nabe"],
  rear_hub: ["hinterrad nabe"],
  rim: ["rims"],
  wheel: ["wheels", "wheelset"],
  tire: ["tyre", "tyres", "tires", "reifen"],
  front_tire: ["front tyre"],
  rear_tire: ["rear tyre"],
  handlebar: ["handlebars", "lenker", "cockpit"],
  stem: ["vorbau"],
  grips: ["griffe"],
  bar_tape: ["tape", "handlebar tape"],
  headset: ["steuersatz"],
  seatpost: ["seat post", "sattelstütze"],
  saddle: ["sattel"],
  seat_clamp: ["seat binder", "sattelklemme"],
  pedals: ["pedal", "pedale"],
  front_light: ["headlight", "scheinwerfer"],
  rear_light: ["tail light", "rücklicht"],
  mudguards: ["fenders", "schutzbleche"],
  rack: ["carrier", "gepäckträger"],
  kickstand: ["ständer"],
  bell: ["glocke"],
  motor: ["drive unit"],
  battery: ["akku"],
};
const labels = new Map<string, ComponentType>();
for (const type of componentTypes) {
  labels.set(normalize(type), type);
  for (const a of aliases[type] || []) labels.set(normalize(a), type);
}
export const componentType = (label: string): ComponentType =>
  labels.get(normalize(label)) || "other";
export function normalizeComponent(
  label: string,
  value: string,
): BikeComponent {
  let type = componentType(label);
  if (type === "chain" && /\bGates\s+(CDX|CDN|CDC)\b/i.test(value))
    type = "belt";
  const c: BikeComponent = {
    type,
    description: value,
    attributes: {},
    raw: { label, value },
  };
  const brand = value.match(
    /^(Shimano|SRAM|Gates|Schwalbe|Continental|CUBE|ACID|Brooks|FSA|DT Swiss|RockShox|Fox|Bosch|Canyon|Specialized|Giant|Syncros|Maxxis|Race Face|Roval|Fizik|Selle Royal|Busch\s*&\s*Müller)\b/i,
  )?.[1];
  if (brand) c.brand = brand;
  const family = value.match(
    /\b(Alfine|Nexus|Dura-Ace|Ultegra|GRX|Deore|XT|XTR|Force|Rival|Red|CDX|CDN)\b/i,
  )?.[1];
  if (family) c.family = family;
  const model = value.match(
    /\b(?:SG|SL|BR|DH|RD|FD|FC|ST|BL|CS|SM)-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/i,
  )?.[0];
  if (model) c.model = model;
  const speeds = value.match(/\b(\d{1,2})\s*[- ]?\s*(?:speed|gang)\b/i);
  if (speeds) c.attributes.speeds = Number(speeds[1]);
  if (["chainring", "rear_sprocket", "belt", "crankset"].includes(type)) {
    const teeth = value.match(/\b(\d{1,3})T\b/i);
    if (teeth) c.attributes.teeth = Number(teeth[1]);
  }
  if (type.startsWith("front_")) c.position = "front";
  if (type.startsWith("rear_")) c.position = "rear";
  return c;
}
export const normalizeSpecification = (raw: Record<string, string>) =>
  Object.entries(raw).map(([k, v]) => normalizeComponent(k, v));
