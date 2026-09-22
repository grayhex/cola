// One policy for the asset response and Next's later path-header merge.
// No scripts, remote resources or embedded browsing contexts; SVG may only
// display validated data rasters and its local inline CSS/SMIL animation.
export const assetContentSecurityPolicy =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; sandbox";
