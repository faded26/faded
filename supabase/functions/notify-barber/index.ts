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
    if (!booking_id) {
      return new Response(JSON.stringify({ error: "booking_id required" }), { status: 400, headers: corsHeaders });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: booking, error } = await supabase
      .from("bookings")
      .select(`
        id, customer_name, customer_email, customer_phone,
        booking_date, booking_time, payment_method, proof_of_payment_url,
        subscriber_id, status, approval_token,
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
    const needsApproval = booking.status === "pending_approval";

    const paymentLabel: Record<string, string> = {
      cash: "Cash",
      card: "Card (transfer)",
      subscription: "Subscription",
    };

    const firstName = barber.name?.split(" ")[0] ?? barber.name;

    const subject = needsApproval
      ? `New booking needs your approval — ${booking.customer_name}`
      : `New booking confirmed — ${booking.customer_name}`;

    const approveUrl = `${SUPABASE_URL}/functions/v1/approve-booking?token=${booking.approval_token}`;

    const proofRow = booking.proof_of_payment_url
      ? `<tr><td style="color:#9B9894;padding:6px 0;">Proof of payment</td><td style="color:#F5F3EF;padding:6px 0;">${booking.proof_of_payment_url}</td></tr>`
      : "";

    const subIdRow = booking.subscriber_id
      ? `<tr><td style="color:#9B9894;padding:6px 0;">Subscriber ID</td><td style="color:#F5F3EF;padding:6px 0;">${booking.subscriber_id}</td></tr>`
      : "";

    const introLine = needsApproval
      ? "You've got a new booking waiting on your approval."
      : "This booking is already confirmed and on your schedule.";

    const actionBlock = needsApproval
      ? `<a href="${approveUrl}" style="display:inline-block;background:#C9A24B;color:#17171A;font-size:14px;font-weight:bold;padding:10px 20px;border-radius:6px;text-decoration:none;">Approve booking</a>
         <p style="font-size:12px;color:#9B9894;margin:20px 0 0;line-height:1.5;">Approving adds this to your schedule and confirms it with the customer.</p>`
      : `<p style="font-size:13px;color:#9B9894;margin:0;">No action needed from you.</p>`;

    const html = `
      <div style="font-family: Georgia, serif; background:#0e0e10; padding:32px 16px;">
        <div style="max-width:480px;margin:0 auto;background:#17171A;border-radius:12px;overflow:hidden;">
          <div style="background:#0e0e10;padding:20px 24px;">
            <span style="font-weight:bold;letter-spacing:0.02em;font-size:20px;color:#C9A24B;">FADED.</span>
          </div>
          <div style="padding:24px;">
            <p style="font-size:15px;color:#F5F3EF;margin:0 0 4px;">Hi ${firstName},</p>
            <p style="font-size:14px;color:#A3A09B;margin:0 0 20px;line-height:1.6;">${introLine}</p>
            <table style="width:100%;font-size:14px;border-collapse:collapse;margin-bottom:20px;">
              <tr><td style="color:#9B9894;padding:6px 0;width:130px;">Customer</td><td style="color:#F5F3EF;padding:6px 0;">${booking.customer_name}${booking.customer_phone ? " · " + booking.customer_phone : ""}</td></tr>
              <tr><td style="color:#9B9894;padding:6px 0;">Service</td><td style="color:#F5F3EF;padding:6px 0;">${service?.name ?? "—"} — R${service?.price ?? "—"}</td></tr>
              <tr><td style="color:#9B9894;padding:6px 0;">When</td><td style="color:#F5F3EF;padding:6px 0;">${booking.booking_date} at ${booking.booking_time}</td></tr>
              <tr><td style="color:#9B9894;padding:6px 0;">Payment</td><td style="color:#F5F3EF;padding:6px 0;">${paymentLabel[booking.payment_method] ?? booking.payment_method}</td></tr>
              ${proofRow}
              ${subIdRow}
            </table>
            ${actionBlock}
          </div>
        </div>
      </div>`;

    const client = new SMTPClient({
      connection: {
        hostname: "smtp.gmail.com",
        port: 465,
        tls: true,
        auth: { username: GMAIL_USER, password: GMAIL_APP_PASSWORD },
      },
    });

    try {
      await client.send({ from: `Faded Bookings <${GMAIL_USER}>`, to: barber.email, subject, html });
      await client.close();
    } catch (smtpErr) {
      console.error("Gmail SMTP error:", smtpErr);
      return new Response(JSON.stringify({ error: "Email send failed", detail: String(smtpErr) }), { status: 502, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
