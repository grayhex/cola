"use client";
import { useEffect, useState } from "react";
import type { BikeChoiceDto } from "../../lib/contracts.ts";
import { errorMessage } from "../../lib/errors.ts";
import { socialApi } from "./social-primitives.tsx";
import { useSite } from "./site-provider.tsx";

// Component-local, scoped to the current owner. No module/shared private cache.
export function useBikeChoices(enabled: boolean) {
  const owner = useSite().viewer?.id;
  const [result, setResult] = useState<{
    owner: string;
    bikes: BikeChoiceDto[];
  } | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const bikes = result && result.owner === owner ? result.bikes : null;
  useEffect(() => {
    if (!enabled || !owner || bikes) return;
    const controller = new AbortController();
    socialApi<{ bikes: BikeChoiceDto[] }>(
      "bikes?view=choices",
      "GET",
      undefined,
      { signal: controller.signal },
    )
      .then((data) => {
        if (!controller.signal.aborted) {
          setResult({ owner, bikes: data.bikes });
          setError("");
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      });
    return () => controller.abort();
  }, [enabled, owner, bikes, revision]);
  return {
    bikes,
    error,
    retry: () => {
      setError("");
      setResult(null);
      setRevision((n) => n + 1);
    },
  };
}
