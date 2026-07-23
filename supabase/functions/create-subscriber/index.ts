import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function findUserByEmail(admin: ReturnType<typeof createClient>, email: string) {
  // Small user base — a full list + filter is simple and reliable here,
  // rather than relying on undocumented admin API filter behavior.
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error || !data) return null;
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const {
      email, password, barber_id, plan_id,
      full_name, phone, preferred_contact_method, preferred_cut_dates,
    } = await req.json();

    if (!email || !password || !barber_id || !plan_id || !full_name) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: corsHeaders });
    }
    if (password.length < 8) {
      return new Response(JSON.stringify({ error: "Password must be at least 8 characters." }), { status: 400, headers: corsHeaders });
    }

    const existingUser = await findUserByEmail(admin, email);
    let userId: string;

    if (existingUser) {
      // Only block if this email currently has an ACTIVE subscription.
      const { data: existingSub } = await admin
        .from("subscribers")
        .select("status, cycle_end")
        .eq("id", existingUser.id)
        .maybeSingle();

      const hasActiveSub = existingSub
        && existingSub.status === "active"
        && new Date(existingSub.cycle_end) > new Date();

      if (hasActiveSub) {
        return new Response(JSON.stringify({ error: "This email already has an active subscription." }), { status: 409, headers: corsHeaders });
      }

      // Reuse the existing account — reset password to what they just entered.
      const { error: updateError } = await admin.auth.admin.updateUserById(existingUser.id, { password });
      if (updateError) {
        return new Response(JSON.stringify({ error: updateError.message }), { status: 400, headers: corsHeaders });
      }
      userId = existingUser.id;
    } else {
      const { data: newUser, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (createError || !newUser.user) {
        return new Response(JSON.stringify({ error: createError?.message ?? "Could not create account." }), { status: 400, headers: corsHeaders });
      }
      userId = newUser.user.id;
    }

    const { error: profileError } = await admin
      .from("profiles")
      .upsert({ id: userId, user_type: "subscriber" });

    if (profileError) {
      return new Response(JSON.stringify({ error: "Could not create profile.", detail: profileError.message }), { status: 500, headers: corsHeaders });
    }

    const now = new Date();
    const cycleEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const { error: subError } = await admin
      .from("subscribers")
      .upsert({
        id: userId,
        email,
        barber_id,
        plan_id,
        cycle_start: now.toISOString(),
        cycle_end: cycleEnd.toISOString(),
        cuts_used: 0,
        status: "active",
        full_name,
        phone: phone ?? null,
        preferred_contact_method: preferred_contact_method ?? null,
        preferred_cut_dates: preferred_cut_dates ?? null,
      });

    if (subError) {
      return new Response(JSON.stringify({ error: "Could not create subscription.", detail: subError.message }), { status: 500, headers: corsHeaders });
    }

    try {
      console.log("Calling welcome-subscriber for:", userId);
      const welcomeRes = await fetch(`${SUPABASE_URL}/functions/v1/welcome-subscriber`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
          "apikey": SERVICE_ROLE_KEY,
        },
        body: JSON.stringify({ subscriber_id: userId }),
      });
      const welcomeBody = await welcomeRes.text();
      console.log("welcome-subscriber response:", welcomeRes.status, welcomeBody);
    } catch (welcomeErr) {
      console.error("welcome-subscriber call threw:", welcomeErr);
      // Welcome email failing shouldn't fail the signup
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
