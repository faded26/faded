import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GMAIL_USER = Deno.env.get("GMAIL_USER")!;
const GMAIL_APP_PASSWORD = Deno.env.get("GMAIL_APP_PASSWORD")!;

const BG_URL = "https://bhnorwrdchrsfiutsvse.supabase.co/storage/v1/object/public/public-assets/faded-background.jpg";

function fmtDate(d: Date) {
  return d.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" });
}

Deno.serve(async (req) => {
  const authHeader = req.headers.get("Authorization");
  if (authHeader !== `Bearer ${SERVICE_ROLE_KEY}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  try {
    const { subscriber_id } = await req.json();
    if (!subscriber_id) {
      return new Response(JSON.stringify({ error: "subscriber_id required" }), { status: 400 });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: subscriber, error } = await admin
      .from("subscribers")
      .select(`
        email, full_name, cycle_start, cycle_end, preferred_cut_dates,
        barbers ( name ),
        subscription_plans ( name, price, cuts_included )
      `)
      .eq("id", subscriber_id)
      .single();

    if (error || !subscriber) {
      return new Response(JSON.stringify({ error: "Subscriber not found", detail: error?.message }), { status: 404 });
    }

    const barber = subscriber.barbers as unknown as { name: string };
    const plan = subscriber.subscription_plans as unknown as { name: string; price: number; cuts_included: number };
    const firstName = subscriber.full_name?.split(" ")[0] ?? subscriber.full_name;

    const cycleStart = new Date(subscriber.cycle_start);
    const cycleEnd = new Date(subscriber.cycle_end);
    const cutsIncluded = plan?.cuts_included ?? 4;

    let cutDates: string[];
    if (subscriber.preferred_cut_dates && Array.isArray(subscriber.preferred_cut_dates) && subscriber.preferred_cut_dates.length > 0) {
      cutDates = subscriber.preferred_cut_dates.map((d: string) => fmtDate(new Date(d)));
    } else {
      const spacingDays = 30 / cutsIncluded;
      cutDates = Array.from({ length: cutsIncluded }, (_, i) =>
        fmtDate(new Date(cycleStart.getTime() + spacingDays * (i + 1) * 24 * 60 * 60 * 1000))
      );
    }

    const datesHtml = cutDates.map((d, i) => `<div style="font-size:13px;color:#F5F3EF;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.1);">Cut ${i + 1} — <span style="color:#C9A24B;">${d}</span></div>`).join("");

    const html = `
      <div style="font-family:Georgia,serif;background:#0e0e10;padding:32px 16px;">
        <div style="max-width:480px;margin:0 auto;background:#17171A;border-radius:12px;overflow:hidden;">
          <img src="${BG_URL}" alt="Faded" width="480" style="width:100%;max-width:480px;height:180px;object-fit:cover;display:block;border:0;" />
          <div style="background:#0e0e10;padding:16px 24px;">
            <span style="font-weight:bold;letter-spacing:0.02em;font-size:20px;color:#C9A24B;">FADED.</span>
          </div>
          <div style="padding:24px;">
            <p style="font-size:16px;color:#F5F3EF;margin:0 0 4px;">Welcome, ${firstName}!</p>
            <p style="font-size:14px;color:#A3A09B;margin:0 0 20px;line-height:1.6;">
              You're subscribed to the <strong style="color:#F5F3EF;">${plan?.name ?? "Standard"}</strong> plan
              with ${barber?.name ?? "your barber"} — R${plan?.price ?? "—"}/month for ${cutsIncluded} cuts.
            </p>
            <p style="font-size:13px;color:#9B9894;margin:0 0 6px;">Your cycle runs ${fmtDate(cycleStart)} to ${fmtDate(cycleEnd)}. Unused cuts don't roll over, so here are suggested dates to use them all:</p>
            ${datesHtml}
            <p style="font-size:12px;color:#9B9894;margin-top:20px;line-height:1.5;">
              These are suggestions, not fixed bookings — book each cut whenever suits you before the cycle ends.
              Reminders will also be coming via WhatsApp soon.
            </p>
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

    await client.send({
      from: `Faded <${GMAIL_USER}>`,
      to: subscriber.email,
      subject: `Welcome to Faded — your ${plan?.name ?? "subscription"} is active`,
      html,
    });
    await client.close();

    return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
