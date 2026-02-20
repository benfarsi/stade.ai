// lib/auth.ts
import { createClient } from "./supabase/server";
import { NextResponse } from "next/server";
type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export async function getAuthUser() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return { user: null, profile: null, supabase, error: authError?.message ?? "Unauthorized" };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return { user, profile, supabase, error: null };
}

export async function requireAuth() {
  const result = await getAuthUser();
  if (result.error || !result.user) {
    return {
      ...result,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { ...result, response: null };
}

const FREE_TIER_LIMIT = 20;

export async function checkRateLimit(userId: string, supabase: SupabaseServerClient) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("tier, monthly_ai_calls, monthly_ai_calls_reset_at")
    .eq("id", userId)
    .single();

  if (!profile) return { allowed: false, reason: "Profile not found" };
  if (profile.tier === "pro") return { allowed: true };

  const resetAt = new Date(profile.monthly_ai_calls_reset_at);
  const now = new Date();
  if (now.getMonth() !== resetAt.getMonth() || now.getFullYear() !== resetAt.getFullYear()) {
    await supabase
      .from("profiles")
      .update({ monthly_ai_calls: 0, monthly_ai_calls_reset_at: now.toISOString() })
      .eq("id", userId);
    return { allowed: true };
  }

  if (profile.monthly_ai_calls >= FREE_TIER_LIMIT) {
    return {
      allowed: false,
      reason: `Free tier limit of ${FREE_TIER_LIMIT} AI calls/month reached. Upgrade to Pro for unlimited access.`,
    };
  }

  return { allowed: true };
}

export async function incrementAiCalls(userId: string, supabase: SupabaseServerClient) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("monthly_ai_calls")
    .eq("id", userId)
    .single();

  if (profile) {
    await supabase
      .from("profiles")
      .update({ monthly_ai_calls: profile.monthly_ai_calls + 1 })
      .eq("id", userId);
  }
}