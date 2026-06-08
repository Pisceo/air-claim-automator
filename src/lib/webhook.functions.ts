import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const MAKE_WEBHOOK_URL = "https://hook.eu1.make.com/epslvgm41bsicn5agyan5gkny8aiimip";

export const notifyOnboardingComplete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: profile, error: pErr } = await (supabase as any)
      .from("profiles").select("*").eq("id", userId).maybeSingle();
    if (pErr) throw new Error(pErr.message);

    const { data: flights, error: fErr } = await (supabase as any)
      .from("flights").select("*").eq("user_id", userId).order("departure_date", { ascending: false });
    if (fErr) throw new Error(fErr.message);

    const flightList = (flights ?? [])
      .map((f: any) => `${f.flight_number} ${f.departure_airport}->${f.arrival_airport} ${f.departure_date} (${f.airline})`)
      .join(", ");

    const payload = {
      full_name: profile?.full_name ?? "",
      email: profile?.email ?? "",
      iban: profile?.iban ?? "",
      paypal_email: profile?.paypal_email ?? "",
      payout_method: profile?.payout_method ?? "",
      passport_uploaded: profile?.passport_uploaded ? "yes" : "no",
      signup_date: profile?.created_at ?? new Date().toISOString(),
      flights_detected: (flights ?? []).length,
      flights_list: flightList,
    };

    try {
      const res = await fetch(MAKE_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        return { ok: false, status: res.status, error: await res.text().catch(() => "") };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
