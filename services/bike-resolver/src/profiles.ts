export interface ExtractionProfile {
  id: string;
  sections?: string[];
  framework?: "react" | "shopify";
  aliases?: Record<string, string>;
}
export function profileFor(url: string, body: string): ExtractionProfile {
  const host = new URL(url).hostname;
  if (host === "specialized.com" || host.endsWith(".specialized.com"))
    return {
      id: "specialized",
      framework: "react",
      sections: [
        "#technical-specifications",
        '[data-testid="tech-specs-accordion-children"]',
      ],
    };
  if (/cdn\.shopify\.com|shopify-section|shopify-block/.test(body))
    return {
      id: "shopify",
      framework: "shopify",
      sections: [
        '[itemprop="description"]',
        ".product__description",
        ".product-single__description",
        ".main-product__description",
      ],
    };
  return { id: "generic" };
}
