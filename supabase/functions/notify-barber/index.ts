import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { booking_id } = await req.json();
    if (!booking_id) {
      return new Response(JSON.stringify({ error: "booking_id required" }), { status: 400, headers: corsHeaders });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Pull the booking with everything needed for the alert in one query
    const { data: booking, error } = await supabase
      .from("bookings")
      .select(`
        id, customer_name, customer_email, customer_phone,
        booking_date, booking_time, payment_method, proof_of_payment_url,
        subscriber_id, status,
        barbers ( id, name, email ),
        services ( name, price )
      `)
      .eq("id", booking_id)
      .single();

    if (error || !booking) {
      return new Response(JSON.stringify({ error: "Booking not found", detail: error?.message }), { status: 404, headers: corsHeaders });
    }

    const barber = booking.barbers as unknown as { id: string; name: string; email: string };
    const service = booking.services as unknown as { name: string; price: number };

    const paymentLabel: Record<string, string> = {
      cash: "Cash",
      card: "Card (Transfer)",
      subscription: "Subscription",
    };

    const subject = booking.payment_method === "subscription"
      ? `New booking (auto-confirmed): ${booking.customer_name}`
      : `New booking needs approval: ${booking.customer_name}`;

    const proofLine = booking.proof_of_payment_url
      ? `<p><strong>Proof of Payment:</strong> ${booking.proof_of_payment_url}</p>`
      : "";

    const subIdLine = booking.subscriber_id
      ? `<p><strong>Subscriber ID:</strong> ${booking.subscriber_id}</p>`
      : "";

    const html = `
      <h2>${subject}</h2>
      <p><strong>Customer:</strong> ${booking.customer_name} (${booking.customer_email}${booking.customer_phone ? `, ${booking.customer_phone}` : ""})</p>
      <p><strong>Service:</strong> ${service?.name ?? "—"} (R${service?.price ?? "—"})</p>
      <p><strong>Date/Time:</strong> ${booking.booking_date} at ${booking.booking_time}</p>
      <p><strong>Payment Method:</strong> ${paymentLabel[booking.payment_method] ?? booking.payment_method}</p>
      ${proofLine}
      ${subIdLine}
      <p><strong>Status:</strong> ${booking.status}</p>
      ${booking.status === "pending_approval" ? "<p>This booking needs your approval before it hits the schedule.</p>" : "<p>This booking is already confirmed on the schedule.</p>"}
    `;

    const brevoRes = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": BREVO_API_KEY,
      },
      body: JSON.stringify({
        sender: { name: "Faded Bookings", email: "faded0713@gmail.com" },
        to: [{ email: barber.email, name: barber.name }],
        subject,
        htmlContent: html,
      }),
    });

    if (!brevoRes.ok) {
      const errText = await brevoRes.text();
      return new Response(JSON.stringify({ error: "Brevo send failed", detail: errText }), { status: 502, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
