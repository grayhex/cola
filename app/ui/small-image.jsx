"use client";
import { useEffect, useRef, useState } from "react";
import { Bike } from "lucide-react";
export default function SmallImage({
  src,
  alt = "",
  className = "",
  priority = false,
  srcSet,
  sizes,
}) {
  const [failed, setFailed] = useState(null);
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current?.complete && !ref.current.naturalWidth) setFailed(src);
  }, [src]);
  return src && failed !== src ? (
    <img
      ref={ref}
      className={className}
      src={src}
      srcSet={srcSet}
      sizes={srcSet ? sizes : undefined}
      alt={alt}
      width={160}
      height={120}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      onError={() => setFailed(src)}
    />
  ) : (
    <span className={className} aria-label={alt || "Без фотографии"}>
      <Bike size={28} strokeWidth={1.3} aria-hidden="true" />
    </span>
  );
}
