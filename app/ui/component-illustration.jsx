"use client";
import { useState } from "react";
import Image from "next/image";
import { useSite } from "./site-provider.jsx";
import PartIcon from "./part-icon.jsx";
import styles from "./component-illustration.module.css";

export default function ComponentIllustration({ group, category, ...props }) {
  const site = useSite();
  const images = site?.settings?.componentIllustrations;
  const id = group ? images?.groups?.[group] : images?.categories?.[category];
  const [failedId, setFailedId] = useState(null);
  const size = props.size || 26;
  if (id && failedId !== id)
    return (
      <Image
        unoptimized
        loading="eager"
        className={styles.image}
        src={"/api/assets/" + id}
        width={size}
        height={size}
        alt=""
        aria-hidden="true"
        onError={() => setFailedId(id)}
      />
    );
  return <PartIcon category={category} {...props} />;
}
