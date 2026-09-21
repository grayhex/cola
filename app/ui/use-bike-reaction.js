"use client";
import { useMemo, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { createBikeReaction } from "../../lib/bike-reactions.js";

export function useBikeReaction(bike, user, onGuest) {
  const router = useRouter();
  const reaction = useMemo(
    () =>
      createBikeReaction(bike || {}, async (liked) => {
        const response = await fetch(`/api/bikes/${bike.id}/like`, {
          method: liked ? "PUT" : "DELETE",
        });
        if (!response.ok) throw new Error("Reaction rejected");
        return response.json();
      }),
    [bike?.id, user?.id],
  );
  const state = useSyncExternalStore(
    reaction.subscribe,
    reaction.snapshot,
    reaction.snapshot,
  );
  return {
    ...state,
    toggle() {
      if (!bike || bike.is_owner || !bike.is_public) return;
      if (!user) {
        if (onGuest) onGuest();
        else router.push("/account");
        return;
      }
      reaction.toggle();
    },
  };
}
