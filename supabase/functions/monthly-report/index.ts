import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GMAIL_USER = Deno.env.get("GMAIL_USER")!;
const GMAIL_APP_PASSWORD = Deno.env.get("GMAIL_APP_PASSWORD")!;

function fmt(n: number) {
  return n.toFixed(2);
}

const CRON_SECRET = Deno.env.get("CRON_SECRET")!;

Deno.serve(async (req) => {
  const provided = req.headers.get("x-cron-secret");
  if (provided !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const today = now.toISOString().slice(0, 10);

    const { data: owners, error: ownerErr } = await admin
      .from("barbers")
      .select("name, email")
      .eq("role", "owner")
      .eq("active", true);

    if (ownerErr || !owners || owners.length === 0) {
      return new Response(JSON.stringify({ error: "No active owner found", detail: ownerErr?.message }), { status: 404 });
    }

    const { data: bookings, error: bookingErr } = await admin
      .from("bookings")
      .select(`
        payment_method, barber_id, service_id,
        barbers ( name ),
        services ( name, price )
      `)
      .eq("status", "completed")
      .gte("booking_date", monthStart)
      .lte("booking_date", today);

    if (bookingErr) {
      return new Response(JSON.stringify({ error: "Query failed", detail: bookingErr.message }), { status: 500 });
    }

    const rows = (bookings ?? []).map((b: any) => ({
      paymentMethod: b.payment_method,
      barberName: b.barbers?.name ?? "—",
      serviceName: b.services?.name ?? "—",
      price: Number(b.services?.price ?? 0),
    }));

    const total = rows.reduce((sum, r) => sum + r.price, 0);

    function groupSum<T extends string>(keyFn: (r: typeof rows[0]) => T) {
      const map = new Map<T, number>();
      for (const r of rows) map.set(keyFn(r), (map.get(keyFn(r)) ?? 0) + r.price);
      return [...map.entries()].map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount);
    }

    const byPayment = groupSum((r) => r.paymentMethod);
    const byBarber = groupSum((r) => r.barberName);

    const serviceCounts = new Map<string, { count: number; amount: number }>();
    for (const r of rows) {
      const cur = serviceCounts.get(r.serviceName) ?? { count: 0, amount: 0 };
      cur.count += 1;
      cur.amount += r.price;
      serviceCounts.set(r.serviceName, cur);
    }
    const topServices = [...serviceCounts.entries()]
      .map(([label, v]) => ({ label: `${label} (${v.count})`, amount: v.amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    const subTotal = rows.filter((r) => r.paymentMethod === "subscription").reduce((s, r) => s + r.price, 0);
    const oneOffTotal = total - subTotal;

    // Build CSV attachment
    const csvLines: string[] = [];
    csvLines.push("Faded Accounting Report");
    csvLines.push(`Period,${monthStart} to ${today}`);
    csvLines.push("");
    csvLines.push("Summary");
    csvLines.push(`Total Revenue,R${fmt(total)}`);
    csvLines.push("");
    csvLines.push("By Payment Method");
    for (const r of byPayment) csvLines.push(`${r.label},R${fmt(r.amount)}`);
    csvLines.push("");
    csvLines.push("Subscription vs One-Off");
    csvLines.push(`Subscription,R${fmt(subTotal)}`);
    csvLines.push(`One-Off (Cash/Card),R${fmt(oneOffTotal)}`);
    csvLines.push("");
    csvLines.push("Revenue Per Barber");
    for (const r of byBarber) csvLines.push(`${r.label},R${fmt(r.amount)}`);
    csvLines.push("");
    csvLines.push("Top Services");
    for (const r of topServices) csvLines.push(`${r.label},R${fmt(r.amount)}`);
    const csv = csvLines.join("\n");

    const rowsHtml = (title: string, items: { label: string; amount: number }[]) => `
      <h3 style="font-size:14px;color:#C9A24B;margin:16px 0 6px;">${title}</h3>
      ${items.map(r => `<div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0;border-bottom:1px solid #2c2c31;"><span style="color:#A3A09B;">${r.label}</span><span style="color:#F5F3EF;">R${fmt(r.amount)}</span></div>`).join("")}
    `;

    const html = `
      <div style="font-family:Georgia,serif;background:#0e0e10;padding:32px 16px;">
        <div style="max-width:520px;margin:0 auto;background:#17171A;border-radius:12px;overflow:hidden;">
          <div style="background:#0e0e10;padding:20px 24px;">
            <span style="font-weight:bold;letter-spacing:0.02em;font-size:20px;color:#C9A24B;">FADED.</span>
          </div>
          <div style="padding:24px;">
            <p style="font-size:15px;color:#F5F3EF;margin:0 0 4px;">Month-to-date report</p>
            <p style="font-size:13px;color:#A3A09B;margin:0 0 16px;">${monthStart} to ${today}</p>
            <div style="font-size:22px;font-weight:bold;color:#F5F3EF;margin-bottom:8px;">R${fmt(total)} total revenue</div>
            ${rowsHtml("By payment method", byPayment)}
            ${rowsHtml("Revenue per barber", byBarber)}
            ${rowsHtml("Top services", topServices)}
            <p style="font-size:12px;color:#9B9894;margin-top:20px;">Full detail attached as CSV.</p>
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

    for (const owner of owners) {
      const firstName = owner.name?.split(" ")[0] ?? owner.name;
      await client.send({
        from: `Faded Reports <${GMAIL_USER}>`,
        to: owner.email,
        subject: `Faded — month-to-date report (${monthStart} to ${today})`,
        html: html.replace("Month-to-date report", `Hi ${firstName}, here's your month-to-date report`),
        attachments: [
          {
            filename: `faded-accounting-${today}.csv`,
            content: csv,
            encoding: "utf-8",
          },
        ],
      });
    }
    await client.close();

    return new Response(JSON.stringify({ success: true, sentTo: owners.map((o: any) => o.email) }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
