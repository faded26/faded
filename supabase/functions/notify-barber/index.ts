import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GMAIL_USER = Deno.env.get("GMAIL_USER")!;
const GMAIL_APP_PASSWORD = Deno.env.get("GMAIL_APP_PASSWORD")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { booking_id } = await req.json();
    console.log("notify-barber invoked for booking:", booking_id);
    if (!booking_id) {
      return new Response(JSON.stringify({ error: "booking_id required" }), { status: 400, headers: corsHeaders });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

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

    const client = new SMTPClient({
      connection: {
        hostname: "smtp.gmail.com",
        port: 465,
        tls: true,
        auth: {
          username: GMAIL_USER,
          password: GMAIL_APP_PASSWORD,
        },
      },
    });

    try {
      await client.send({
        from: `Faded Bookings <${GMAIL_USER}>`,
        to: barber.email,
        subject,
        html,
      });
      await client.close();
    } catch (smtpErr) {
      console.error("Gmail SMTP error:", smtpErr);
      return new Response(JSON.stringify({ error: "Email send failed", detail: String(smtpErr) }), { status: 502, headers: corsHeaders });
    }

    console.log("Email sent successfully to:", barber.email);
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
