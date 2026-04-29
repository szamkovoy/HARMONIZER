import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceSupabase, errorResponse, json, requireUserId } from "../../../_utils/supabase";

export const runtime = "nodejs";

type Body = {
  action?: string;
};

type ProposalRow = {
  id: string;
  user_id: string;
  proposed_planet: string;
  proposed_label: string;
  proposed_polarity: string;
  status: string;
};

type StateItem = { id: string; label: string; source: string; weight: number };

type PlanetBucket = {
  chakra_number: number;
  positive_states: StateItem[];
  negative_states: StateItem[];
  rejected_states: unknown[];
  is_confirmed: boolean;
};

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

async function mergeAcceptedProposalIntoCalibration(
  db: SupabaseClient,
  userId: string,
  proposal: ProposalRow,
): Promise<{ merged: boolean }> {
  const { data: calibration, error } = await db
    .from("user_calibrations")
    .select("id,states_map")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  if (!calibration?.states_map || typeof calibration.states_map !== "object") {
    return { merged: false };
  }

  const planet = proposal.proposed_planet;
  const statesMap = { ...(calibration.states_map as Record<string, PlanetBucket>) };
  const prev = statesMap[planet];
  if (!prev) return { merged: false };

  const bucket = proposal.proposed_polarity === "positive" ? "positive_states" : "negative_states";
  const list = [...(prev[bucket] ?? [])];
  const id = slugify(proposal.proposed_label);
  if (!list.some((item) => item.id === id)) {
    list.push({ id, label: proposal.proposed_label, source: "user_confirmed", weight: 1 });
  }

  statesMap[planet] = {
    ...prev,
    [bucket]: list,
    is_confirmed: true,
  };

  const { error: updateError } = await db.from("user_calibrations").update({ states_map: statesMap }).eq("id", calibration.id);
  if (updateError) throw updateError;
  return { merged: true };
}

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId(req);
    const { id } = await context.params;
    const body = (await req.json()) as Body;
    const action = body.action === "accept" || body.action === "reject" ? body.action : null;
    if (!action) {
      return json({ error: "Invalid action. Use accept or reject." }, { status: 400 });
    }

    const db = createServiceSupabase();

    const { data: existing, error: readError } = await db
      .from("ai_state_proposals")
      .select("id,user_id,status,proposed_planet,proposed_label,proposed_polarity")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (readError) throw readError;
    if (!existing) return json({ error: "Proposal not found" }, { status: 404 });
    if (existing.status !== "pending") {
      return json({ error: "Proposal is not pending" }, { status: 409 });
    }

    const nextStatus = action === "accept" ? "accepted" : "rejected";
    const { data, error } = await db
      .from("ai_state_proposals")
      .update({
        status: nextStatus,
        responded_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", userId)
      .select("*")
      .single();
    if (error) throw error;

    let mergedIntoCalibration = false;
    if (action === "accept") {
      const merge = await mergeAcceptedProposalIntoCalibration(db, userId, data as ProposalRow);
      mergedIntoCalibration = merge.merged;
    }

    return json({ success: true, proposal: data, mergedIntoCalibration });
  } catch (error) {
    return errorResponse(error);
  }
}
