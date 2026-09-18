export default function SiteAssetIcon({
  assetId,
  Fallback,
  size = 24,
  className = "",
  fallbackProps = {},
}) {
  if (assetId) {
    return (
      <img
        className={"site-asset-icon " + className}
        src={"/api/assets/" + assetId}
        alt=""
        width={size}
        height={size}
        aria-hidden="true"
      />
    );
  }
  return (
    <Fallback
      className={"site-asset-icon-fallback " + className}
      size={size}
      aria-hidden="true"
      {...fallbackProps}
    />
  );
}
