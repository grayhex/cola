"use client";
import { useMemo, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { createBikeReaction } from "../../lib/bike-reactions.ts";

export function useBikeReaction(
  bike:
    | (Parameters<typeof createBikeReaction>[0] & {
        id: string;
        is_owner?: boolean;
        is_public?: boolean;
      })
    | null
    | undefined,
  user: { id: string } | null | undefined,
  onGuest: (() => void) | undefined,
) {
  const router = useRouter();
  const reaction = useMemo(
    () =>
      createBikeReaction(
        bike || {},
        async (liked): Promise<{ liked: boolean; likes?: number }> => {
          const response = await fetch(`/api/bikes/${bike!.id}/like`, {
            method: liked ? "PUT" : "DELETE",
          });
          if (!response.ok) throw new Error("Reaction rejected");
          return response.json();
        },
      ),
    // Keep this serialized writer across list refreshes while a like is pending.
    // Only changing the bike/viewer starts a new server-seeded reaction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
