import sharp from "sharp";
import { XMLParser, XMLValidator } from "fast-xml-parser";

// Admin artwork is served as an image, never injected into the document.
// Keep CSS/SMIL animation and local paint references, but no active/external content.
const tags = new Set(
  "svg image g defs title desc path rect circle ellipse line polyline polygon text tspan textPath use symbol clipPath mask pattern linearGradient radialGradient stop filter feGaussianBlur feOffset feMerge feMergeNode feColorMatrix feBlend feComposite feFlood feDropShadow feComponentTransfer feFuncR feFuncG feFuncB feFuncA animate animateTransform animateMotion mpath set style".split(
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
export async function prepareSvg(bytes) {
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
  const embedded = new Map();
  let imageCount = 0;
  function embeddedRaster(value) {
    if (++imageCount > 32) throw Error("SVG: слишком много растровых слоёв");
    const match =
      /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
        String(value),
      );
    if (!match || match[2].length % 4 !== 0)
      throw Error("SVG: нужен встроенный PNG/JPEG/WebP в base64");
    const bytes = Buffer.from(match[2], "base64");
    if (
      !bytes.length ||
      bytes.length > 768 * 1024 ||
      bytes.toString("base64") !== match[2]
    )
      throw Error("SVG: некорректный или слишком большой растровый слой");
    embedded.set(match[2], { bytes, format: match[1] });
  }
  function walk(nodes, depth = 0) {
    if (depth > 40) throw Error("Слишком сложный SVG");
    for (const node of nodes) {
      if (++count > 12000) throw Error("Слишком сложный SVG");
      const element = Object.keys(node).find(
        (key) => ![":@", "#text", "#cdata"].includes(key),
      );
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
              element === "image" &&
              ["href", "xlink:href"].includes(name) &&
              String(val).startsWith("data:")
            ) {
              embeddedRaster(val);
              continue;
            }
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
  // Decode every distinct payload, not just its declared MIME or signature.
  // Pixel and aggregate bounds avoid compressed-image memory amplification.
  let pixels = 0;
  for (const image of embedded.values()) {
    try {
      const decoder = sharp(image.bytes, {
        limitInputPixels: 16_000_000,
        failOn: "warning",
      });
      const meta = await decoder.metadata();
      pixels += (meta.width || 0) * (meta.height || 0);
      if (
        meta.format !== image.format ||
        !meta.width ||
        !meta.height ||
        meta.width > 8192 ||
        meta.height > 8192 ||
        (meta.pages || 1) !== 1 ||
        pixels > 32_000_000
      )
        throw Error("Invalid raster");
      await decoder.raw().toBuffer();
    } catch {
      throw Error(
        "SVG: повреждённый, слишком большой или неподдерживаемый растровый слой",
      );
    }
  }
  return Buffer.from(xml);
}
