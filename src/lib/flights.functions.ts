import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const AIRLINE_DOMAINS = [
  "ryanair.com", "easyjet.com", "wizzair.com", "vueling.com",
  "klm.com", "klm-info.com", "airfrance.com", "lufthansa.com", "iberia.com",
  "britishairways.com", "transavia.com", "norwegian.com", "tap.pt",
  "turkishairlines.com", "thy.com", "emirates.com", "aireuropa.com",
  "united.com", "delta.com", "aa.com", "qatarairways.com",
  "etihad.com", "flysas.com", "finnair.com", "lot.com", "swiss.com",
  "austrian.com", "brusselsairlines.com", "airbaltic.com",
  "flydubai.com", "condor.com", "volotea.com",
  "edreams.com", "kiwi.com", "opodo.com", "lastminute.com",
  "bravofly.com", "trip.com", "expedia.com",
];

// ─── DECODE ──────────────────────────────────────────────────────────────────

function base64Decode(str: string): string {
  try {
    return decodeURIComponent(
      atob(str.replace(/-/g, "+").replace(/_/g, "/"))
        .split("").map(c => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)).join("")
    );
  } catch {
    try { return atob(str.replace(/-/g, "+").replace(/_/g, "/")); } catch { return ""; }
  }
}

function extractText(payload: any, depth = 0): string {
  if (depth > 4) return "";
  let text = "";
  if (payload?.parts) {
    for (const p of payload.parts) {
      if ((p.mimeType === "text/plain" || p.mimeType === "text/html") && p.body?.data) {
        try {
          const decoded = base64Decode(p.body.data);
          // Strip HTML tags if HTML
          text += p.mimeType === "text/html"
            ? decoded.replace(/<style[\s\S]*?<\/style>/gi, "")
                     .replace(/<script[\s\S]*?<\/script>/gi, "")
                     .replace(/<[^>]+>/g, " ")
                     .replace(/\s+/g, " ")
                     .slice(0, 1500)
            : decoded.slice(0, 1500);
          text += "\n";
        } catch { /* skip */ }
      } else if (p.mimeType?.startsWith("multipart/")) {
        text += extractText(p, depth + 1);
      }
    }
  } else if (payload?.body?.data) {
    try { text += base64Decode(payload.body.data).slice(0, 1500); } catch { /* skip */ }
  }
  return text.slice(0, 2000);
}

// ─── AI EXTRACTION ───────────────────────────────────────────────────────────

interface ExtractedFlight {
  flight_number: string;
  airline: string;
  departure_airport: string | null;
  arrival_airport: string | null;
  departure_date: string | null; // YYYY-MM-DD
}

async function extractFlightsWithAI(emails: { subject: string; from: string; body: string }[]): Promise<ExtractedFlight[]> {
  const emailList = emails.map((e, i) =>
    `EMAIL ${i + 1}:\nFrom: ${e.from}\nSubject: ${e.subject}\nBody: ${e.body}`
  ).join("\n\n---\n\n");

  const prompt = `You are extracting flight booking data from airline emails. For each email, extract ALL actual flights (not promotional content).

Return ONLY a JSON array. Each object must have:
- flight_number: string like "IB740" or "KL1500" (airline IATA code + number, NO leading zeros e.g. IB740 not IB0740)
- airline: full airline name
- departure_airport: IATA code (3 letters) or null
- arrival_airport: IATA code (3 letters) or null  
- departure_date: "YYYY-MM-DD" format or null

Rules:
- Only include REAL flights the person booked (not advertised flights)
- Strip leading zeros from flight numbers (IB0740 → IB740, KL1500 stays KL1500)
- If an email has multiple legs (layovers), include each leg as a separate flight
- If you cannot determine a field with confidence, use null
- Ignore promotional emails, miles/points emails, surveys
- If no flights found in an email, skip it

Emails to process:
${emailList}

Return ONLY valid JSON array, no other text:`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    console.error("Claude API error:", response.status, await response.text());
    return [];
  }

  const data = await response.json();
  const text = data.content?.[0]?.text ?? "";

  try {
    // Strip any markdown fences just in case
    const clean = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(clean);
    if (!Array.isArray(parsed)) return [];

    // Validate and normalise each flight
    return parsed.filter((f: any) => {
      if (!f.flight_number || typeof f.flight_number !== "string") return false;
      if (!f.airline || typeof f.airline !== "string") return false;
      // Must have at least a flight number
      return f.flight_number.match(/^[A-Z]{2}\d{1,4}$/);
    }).map((f: any) => ({
      flight_number: f.flight_number.toUpperCase(),
      airline: f.airline,
      departure_airport: typeof f.departure_airport === "string" && f.departure_airport.length === 3
        ? f.departure_airport.toUpperCase() : null,
      arrival_airport: typeof f.arrival_airport === "string" && f.arrival_airport.length === 3
        ? f.arrival_airport.toUpperCase() : null,
      departure_date: typeof f.departure_date === "string" && f.departure_date.match(/^\d{4}-\d{2}-\d{2}$/)
        ? f.departure_date : null,
    }));
  } catch (e) {
    console.error("Failed to parse Claude response:", text, e);
    return [];
  }
}

// ─── MAIN SCAN ────────────────────────────────────────────────────────────────

export const scanGmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: profileData } = await (supabase as any)
      .from("profiles").select("gmail_access_token").eq("id", userId).single();

    const googleToken = profileData?.gmail_access_token;
    if (!googleToken) return { detected: 0, inserted: 0, error: "No Gmail token — sign out and back in" };

    // ── Step 1: Two parallel Gmail searches (2 subrequests) ──────────────────
    const domainQuery = AIRLINE_DOMAINS.map(d => `from:${d}`).join(" OR ");
    const q1 = `(${domainQuery}) (subject:booking OR subject:confirmation OR subject:reservation OR subject:"your trip" OR subject:itinerary OR subject:"e-ticket" OR subject:"online ticket") newer_than:1095d`;
    const q2 = `(${domainQuery}) (subject:"boarding pass" OR subject:"check in" OR subject:checkin OR subject:"ready to fly" OR subject:"hatirlatma") newer_than:1095d`;

    const [r1, r2] = await Promise.all([
      fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q1)}&maxResults=18`, { headers: { Authorization: `Bearer ${googleToken}` } }),
      fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q2)}&maxResults=12`, { headers: { Authorization: `Bearer ${googleToken}` } }),
    ]);

    if (!r1.ok && !r2.ok) {
      if (r1.status === 401) return { detected: 0, inserted: 0, error: "Gmail token expired — sign out and back in" };
      return { detected: 0, inserted: 0, error: `Gmail error ${r1.status}` };
    }

    const [d1, d2] = await Promise.all([
      r1.ok ? r1.json() : { messages: [] },
      r2.ok ? r2.json() : { messages: [] },
    ]);

    // Deduplicate message IDs
    const seenIds = new Set<string>();
    const messages: any[] = [];
    for (const m of [...(d1.messages ?? []), ...(d2.messages ?? [])]) {
      if (!seenIds.has(m.id)) { seenIds.add(m.id); messages.push(m); }
    }

    if (!messages.length) return { detected: 0, inserted: 0, error: "No matching emails found" };

    // ── Step 2: Fetch full email content (up to 30 subrequests) ──────────────
    const emailContents: { subject: string; from: string; body: string }[] = [];

    for (const msg of messages.slice(0, 30)) {
      try {
        const res = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
          { headers: { Authorization: `Bearer ${googleToken}` } }
        );
        if (!res.ok) continue;
        const full = await res.json();

        const hdrs    = full.payload?.headers ?? [];
        const subject = hdrs.find((h: any) => h.name === "Subject")?.value ?? "";
        const from    = hdrs.find((h: any) => h.name === "From")?.value ?? "";

        // Skip obvious noise
        const subj = subject.toLowerCase();
        if (["survey", "newsletter", "unsubscribe", "miles earned", "points earned",
             "feedback", "satisfaction", "miles&smiles", "new login", "security alert",
             "password", "invoice", "receipt"].some(w => subj.includes(w))) continue;

        const body = extractText(full.payload);
        emailContents.push({ subject, from, body });
      } catch { continue; }
    }

    if (!emailContents.length) return { detected: 0, inserted: 0, error: "No flight emails to process" };

    // ── Step 3: One Claude API call to extract all flights (1 subrequest) ────
    const aiFlights = await extractFlightsWithAI(emailContents);

    if (!aiFlights.length) return { detected: messages.length, inserted: 0, error: "No flights found in emails" };

    // ── Step 4: Deduplicate by flight_number + departure_date ─────────────────
    const flightMap = new Map<string, any>();
    for (const f of aiFlights) {
      if (!f.flight_number || !f.departure_date) continue;
      const key = `${f.flight_number}-${f.departure_date}`;
      if (!flightMap.has(key)) {
        flightMap.set(key, { user_id: userId, ...f });
      } else {
        const ex = flightMap.get(key)!;
        if (!ex.departure_airport && f.departure_airport) ex.departure_airport = f.departure_airport;
        if (!ex.arrival_airport && f.arrival_airport) ex.arrival_airport = f.arrival_airport;
      }
    }

    const toUpsert = [...flightMap.values()];

    // ── Step 5: Clear old flights and upsert new ones (1 subrequest) ──────────
    await (supabase as any).from("flights").delete().eq("user_id", userId);

    let actuallyInserted = 0;
    let insertError = null;

    if (toUpsert.length) {
      const { data: ins, error: insErr } = await (supabase as any)
        .from("flights")
        .upsert(toUpsert, { onConflict: "user_id,flight_number,departure_date", ignoreDuplicates: false })
        .select();
      if (insErr) insertError = insErr.message;
      else actuallyInserted = ins?.length ?? 0;
    }

    return { detected: messages.length, parsed: toUpsert.length, inserted: actuallyInserted, error: insertError };
  });

export const clearAndRescan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await (supabase as any).from("flights").delete().eq("user_id", userId);
    return { cleared: true };
  });

export const listFlights = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await (supabase as any)
      .from("flights").select("*").eq("user_id", userId)
      .order("departure_date", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listClaims = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await (supabase as any)
      .from("claims")
      .select("*, flights(airline, flight_number, departure_airport, arrival_airport, departure_date)")
      .eq("user_id", userId).order("filed_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await (supabase as any)
      .from("profiles").select("*").eq("id", userId).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });
