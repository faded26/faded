import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: corsHeaders });
    }

    const jwt = authHeader.replace("Bearer ", "");
    const authClient = createClient(SUPABASE_URL, ANON_KEY);
    const { data: { user } } = await authClient.auth.getUser(jwt);

    if (!user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: corsHeaders });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: caller, error: callerError } = await admin
      .from("barbers")
      .select("id, role, active")
      .eq("auth_user_id", user.id)
      .single();

    if (callerError || !caller || !caller.active) {
      return new Response(JSON.stringify({ error: "Barber account not found or inactive" }), { status: 403, headers: corsHeaders });
    }

    const body = await req.json();
    let {
      barber_id, service_id, customer_name, customer_phone, customer_email,
      booking_date, booking_time, payment_method,
    } = body;

    // Non-owners can only book for themselves, regardless of what's in the payload
    if (caller.role !== "owner") {
      barber_id = caller.id;
    }

    if (!barber_id || !service_id || !customer_name || !booking_date || !booking_time) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: corsHeaders });
    }

    const { data: service, error: serviceError } = await admin
      .from("services")
      .select("duration_minutes")
      .eq("id", service_id)
      .single();

    if (serviceError || !service) {
      return new Response(JSON.stringify({ error: "Service not found" }), { status: 404, headers: corsHeaders });
    }

    const newStart = toMinutes(booking_time);
    const newEnd = newStart + (service.duration_minutes ?? 30);

    const { data: existingBookings, error: existingError } = await admin
      .from("bookings")
      .select("booking_time, services(duration_minutes)")
      .eq("barber_id", barber_id)
      .eq("booking_date", booking_date)
      .in("status", ["pending_approval", "approved", "completed"]);

    if (existingError) {
      return new Response(JSON.stringify({ error: "Could not check availability", detail: existingError.message }), { status: 500, headers: corsHeaders });
    }

    const hasConflict = (existingBookings ?? []).some((b: any) => {
      const existingStart = toMinutes(b.booking_time);
      const existingDuration = b.services?.duration_minutes ?? 30;
      const existingEnd = existingStart + existingDuration;
      return newStart < existingEnd && existingStart < newEnd;
    });

    if (hasConflict) {
      return new Response(JSON.stringify({ error: "That time is already booked for this barber. Please choose another time." }), { status: 409, headers: corsHeaders });
    }

    const { data: booking, error: insertError } = await admin
      .from("bookings")
      .insert({
        customer_name,
        customer_email: customer_email ?? "",
        customer_phone: customer_phone ?? null,
        barber_id,
        service_id,
        booking_date,
        booking_time,
        payment_method: payment_method ?? "cash",
        proof_of_payment_url: null,
        subscriber_id: null,
        status: "approved",
      })
      .select()
      .single();

    if (insertError || !booking) {
      return new Response(JSON.stringify({ error: "Could not create booking", detail: insertError?.message }), { status: 500, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ id: booking.id, status: booking.status }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
