import { XMLParser, XMLValidator } from "fast-xml-parser";

// Admin artwork is served as an image, never injected into the document.
// Keep CSS/SMIL animation and local paint references, but no active/external content.
const tags = new Set(
  "svg g defs title desc path rect circle ellipse line polyline polygon text tspan textPath use symbol clipPath mask pattern linearGradient radialGradient stop filter feGaussianBlur feOffset feMerge feMergeNode feColorMatrix feBlend feComposite feFlood feDropShadow feComponentTransfer feFuncR feFuncG feFuncB feFuncA animate animateTransform animateMotion mpath set style".split(
    " ",
  ),
);
const animationAttributes = new Set(
  "transform opacity fill stroke stroke-width stroke-dasharray stroke-dashoffset d points x y x1 x2 y1 y2 cx cy r rx ry width height offset stop-color stop-opacity fill-opacity stroke-opacity rotate viewBox".split(
    " ",
  ),
);
function safeValue(value) {
  const s = String(value);
  if (
    /[\\\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s) ||
    /@import|expression\s*\(|javascript\s*:|data\s*:|https?\s*:|\/\//i.test(s)
  )
    return false;
  return !/url\s*\(/i.test(
    s.replace(/url\(\s*['"]?#[a-zA-Z0-9_.:-]+['"]?\s*\)/gi, ""),
  );
}
export function prepareSvg(bytes) {
  if (bytes.length > 1024 * 1024) throw Error("SVG: максимум 1 МБ");
  const xml = bytes.toString("utf8").replace(/^\uFEFF/, "");
  if (
    /<!DOCTYPE|<!ENTITY|<\?(?!xml\s)/i.test(xml) ||
    XMLValidator.validate(xml) !== true
  )
    throw Error("Некорректный SVG");
  const tree = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    processEntities: true,
  }).parse(xml);
  let count = 0;
  function walk(nodes, depth = 0) {
    if (depth > 40) throw Error("Слишком сложный SVG");
    for (const node of nodes) {
      if (++count > 12000) throw Error("Слишком сложный SVG");
      for (const [key, value] of Object.entries(node)) {
        if (key === ":@") {
          for (const [attr, val] of Object.entries(value)) {
            const name = attr.replace(/^@_/, "");
            if (name === "xmlns" && val === "http://www.w3.org/2000/svg")
              continue;
            if (
              name === "xmlns:xlink" &&
              val === "http://www.w3.org/1999/xlink"
            )
              continue;
            if (
              /^on/i.test(name) ||
              name === "xml:base" ||
              !safeValue(val) ||
              (/href$/i.test(name) && !/^#[a-zA-Z0-9_.:-]+$/.test(val)) ||
              (name === "attributeName" && !animationAttributes.has(val))
            )
              throw Error("SVG содержит внешние ссылки или активный код");
          }
        } else if (key === "?xml") continue;
        else if (key === "#text" || key === "#cdata") {
          if (
            !safeValue(
              typeof value === "string" ? value : JSON.stringify(value),
            )
          )
            throw Error("Недопустимое содержимое SVG");
        } else {
          if (!tags.has(key)) throw Error("Недопустимый элемент SVG: " + key);
          walk(value, depth + 1);
        }
      }
    }
  }
  const roots = tree.filter((n) => !Object.hasOwn(n, "?xml"));
  if (roots.length !== 1 || !Object.hasOwn(roots[0], "svg"))
    throw Error("Нужен SVG-документ");
  walk(tree);
  return Buffer.from(xml);
}
