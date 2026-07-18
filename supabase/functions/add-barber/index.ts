import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 1. Identify the caller and confirm they're the owner
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: corsHeaders });
    }
    const jwt = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await admin.auth.getUser(jwt);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: corsHeaders });
    }

    const { data: callerBarber, error: callerError } = await admin
      .from("barbers")
      .select("id, role")
      .eq("auth_user_id", user.id)
      .single();

    if (callerError || !callerBarber || callerBarber.role !== "owner") {
      return new Response(JSON.stringify({ error: "Only the owner can add barbers." }), { status: 403, headers: corsHeaders });
    }

    // 2. Validate input
    const { name, email, phone, password } = await req.json();
    if (!name || !email || !password) {
      return new Response(JSON.stringify({ error: "Name, email, and password are required." }), { status: 400, headers: corsHeaders });
    }
    if (password.length < 8) {
      return new Response(JSON.stringify({ error: "Password must be at least 8 characters." }), { status: 400, headers: corsHeaders });
    }

    // 3. Create the Auth user
    const { data: newUser, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createError || !newUser.user) {
      return new Response(JSON.stringify({ error: createError?.message ?? "Could not create login." }), { status: 400, headers: corsHeaders });
    }

    // 4. Create the barber row + profile, linked to the new auth user
    const { data: barber, error: barberError } = await admin
      .from("barbers")
      .insert({
        name,
        email,
        phone: phone ?? null,
        active: true,
        auth_user_id: newUser.user.id,
        role: "barber",
      })
      .select()
      .single();

    if (barberError) {
      // Roll back the auth user so we don't leave an orphaned login
      await admin.auth.admin.deleteUser(newUser.user.id);
      return new Response(JSON.stringify({ error: "Could not create barber record.", detail: barberError.message }), { status: 500, headers: corsHeaders });
    }

    const { error: profileError } = await admin
      .from("profiles")
      .upsert({ id: newUser.user.id, user_type: "barber" });

    if (profileError) {
      return new Response(JSON.stringify({ error: "Barber created but profile setup failed.", detail: profileError.message }), { status: 500, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ success: true, barber }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
