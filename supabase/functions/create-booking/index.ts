import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      customer_name, customer_email, customer_phone,
      barber_id, service_id, booking_date, booking_time,
      payment_method, proof_of_payment_url,
    } = body;

    if (!customer_name || !customer_email || !barber_id || !service_id || !booking_date || !booking_time || !payment_method) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: corsHeaders });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Identify the caller as a subscriber, if they're logged in
    let subscriberUserId: string | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const jwt = authHeader.replace("Bearer ", "");
      const authClient = createClient(SUPABASE_URL, ANON_KEY);
      const { data: { user } } = await authClient.auth.getUser(jwt);
      if (user) subscriberUserId = user.id;
    }

    let effectivePaymentMethod = payment_method;
    let subscriberId: string | null = null;
    let cutsUsedAfterThisBooking: number | null = null;

    if (payment_method === "subscription") {
      if (!subscriberUserId) {
        return new Response(JSON.stringify({ error: "You must be logged in to use your subscription." }), { status: 401, headers: corsHeaders });
      }

      const { data: subscriber, error: subError } = await admin
        .from("subscribers")
        .select("id, cuts_used, cycle_end, status, subscription_plans(cuts_included)")
        .eq("id", subscriberUserId)
        .single();

      if (subError || !subscriber) {
        return new Response(JSON.stringify({ error: "No subscription found for this account." }), { status: 404, headers: corsHeaders });
      }

      subscriberId = subscriber.id;
      const cutsIncluded = (subscriber as any).subscription_plans?.cuts_included ?? 4;
      const isExpired = new Date(subscriber.cycle_end) < new Date() || subscriber.status === "expired";
      const cutsRemaining = Math.max(0, cutsIncluded - subscriber.cuts_used);

      if (!isExpired && cutsRemaining > 0) {
        effectivePaymentMethod = "subscription";
        cutsUsedAfterThisBooking = subscriber.cuts_used + 1;
      } else if (proof_of_payment_url) {
        effectivePaymentMethod = "card";
      } else {
        return new Response(JSON.stringify({
          error: isExpired
            ? "Your subscription has expired. Please upload proof of payment."
            : "You've used all your cuts this cycle. Please upload proof of payment.",
        }), { status: 400, headers: corsHeaders });
      }
    } else if (payment_method === "card" && !proof_of_payment_url) {
      return new Response(JSON.stringify({ error: "Proof of payment is required for card bookings." }), { status: 400, headers: corsHeaders });
    }

    const status = effectivePaymentMethod === "subscription" ? "approved" : "pending_approval";

    const { data: booking, error: insertError } = await admin
      .from("bookings")
      .insert({
        customer_name, customer_email, customer_phone,
        barber_id, service_id, booking_date, booking_time,
        payment_method: effectivePaymentMethod,
        proof_of_payment_url: proof_of_payment_url ?? null,
        subscriber_id: subscriberId,
        status,
      })
      .select()
      .single();

    if (insertError || !booking) {
      return new Response(JSON.stringify({ error: "Could not create booking", detail: insertError?.message }), { status: 500, headers: corsHeaders });
    }

    if (cutsUsedAfterThisBooking !== null && subscriberId) {
      await admin.from("subscribers").update({ cuts_used: cutsUsedAfterThisBooking }).eq("id", subscriberId);
    }

    // Booking is already saved regardless of what happens here — but we AWAIT
    // this rather than fire-and-forget, since un-awaited promises can be killed
    // by the runtime once the response is sent back to the client.
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/notify-barber`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
          "apikey": SERVICE_ROLE_KEY,
        },
        body: JSON.stringify({ booking_id: booking.id }),
      });
    } catch (_) {
      // Swallow — a failed notification shouldn't fail the booking response
    }

    return new Response(JSON.stringify({ id: booking.id, status: booking.status }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
