import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

function getHtmlParts(payload: any, depth = 0): string[] {
  if (depth > 4) return [];
  const parts: string[] = [];
  if (payload?.mimeType === "text/html" && payload?.body?.data) {
    try { parts.push(base64Decode(payload.body.data)); } catch { /* skip */ }
  }
  if (payload?.parts) {
    for (const p of payload.parts) {
      if (p.mimeType === "text/html" && p.body?.data) {
        try { parts.push(base64Decode(p.body.data)); } catch { /* skip */ }
      } else if (p.mimeType?.startsWith("multipart/")) {
        parts.push(...getHtmlParts(p, depth + 1));
      }
    }
  }
  return parts;
}

// ─── STRUCTURED DATA EXTRACTION ──────────────────────────────────────────────

interface ParsedFlight {
  flight_number: string;
  airline: string;
  departure_airport: string | null;
  arrival_airport: string | null;
  departure_date: string | null;
}

const AIRLINE_NAMES: Record<string, string> = {
  IB: "Iberia", KL: "KLM", QR: "Qatar Airways", TK: "Turkish Airlines",
  UA: "United", BA: "British Airways", FR: "Ryanair", U2: "easyJet",
  VY: "Vueling", AF: "Air France", LH: "Lufthansa", EK: "Emirates",
  W6: "Wizz Air", HV: "Transavia", DY: "Norwegian", TP: "TAP",
  UX: "Air Europa", DL: "Delta", AA: "American", EY: "Etihad",
  SK: "SAS", AY: "Finnair", LO: "LOT", LX: "SWISS", OS: "Austrian",
  SN: "Brussels Airlines", V7: "Volotea", BT: "airBaltic", PC: "Pegasus",
};

// JSON-LD: used by Qatar Airways, United, KLM booking confirmations
function extractJsonLd(html: string): ParsedFlight[] {
  const results: ParsedFlight[] = [];
  for (const s of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const json = JSON.parse(s[1].trim());
      const items = Array.isArray(json) ? json : [json];
      for (const item of items) {
        for (const node of (item["@graph"] ?? [item])) {
          for (const res of (Array.isArray(node) ? node : [node])) {
            const f = parseJsonLdNode(res);
            if (f) results.push(f);
            // Also handle subReservation arrays (multi-leg trips)
            if (Array.isArray(res?.subReservation)) {
              for (const sub of res.subReservation) {
                const sf = parseJsonLdNode(sub);
                if (sf) results.push(sf);
              }
            }
          }
        }
      }
    } catch { /* invalid JSON */ }
  }
  return results;
}

function parseJsonLdNode(node: any): ParsedFlight | null {
  if (!node || typeof node !== "object") return null;
  const rf = node.reservationFor;
  if (!rf) return null;
  const iataCode = (rf.airline?.iataCode ?? rf.operatingAirline?.iataCode ?? "").toUpperCase();
  const rawNum = String(rf.flightNumber ?? "").replace(/\D/g, "");
  if (!iataCode || !rawNum || iataCode.length !== 2) return null;
  const flightNum = parseInt(rawNum, 10);
  if (isNaN(flightNum)) return null;
  const dep = (rf.departureAirport?.iataCode ?? "").toUpperCase();
  const arr = (rf.arrivalAirport?.iataCode ?? "").toUpperCase();
  let date: string | null = null;
  if (rf.departureTime) {
    const d = new Date(rf.departureTime);
    if (!isNaN(d.getTime())) date = d.toISOString().split("T")[0];
  }
  return {
    flight_number: `${iataCode}${flightNum}`,
    airline: rf.airline?.name ?? AIRLINE_NAMES[iataCode] ?? iataCode,
    departure_airport: dep.length === 3 ? dep : null,
    arrival_airport: arr.length === 3 ? arr : null,
    departure_date: date,
  };
}

// Microdata: used by Iberia, Turkish Airlines, most boarding pass emails
function extractMicrodata(html: string): ParsedFlight[] {
  const results: ParsedFlight[] = [];
  const openRe = /<[^>]+itemtype=["'][^"']*FlightReservation["'][^>]*>/gi;
  for (const open of html.matchAll(openRe)) {
    const blockStart = (open.index ?? 0) + open[0].length;
    let depth = 1, pos = blockStart;
    while (pos < html.length && depth > 0) {
      const nextOpen  = html.indexOf("<div",  pos);
      const nextClose = html.indexOf("</div", pos);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) { depth++; pos = nextOpen + 4; }
      else { depth--; pos = nextClose + 6; }
    }
    const f = parseMicrodataBlock(html.slice(blockStart, pos));
    if (f) results.push(f);
  }
  return results;
}

function parseMicrodataBlock(block: string): ParsedFlight | null {
  const getMeta = (prop: string) =>
    (block.match(new RegExp(`itemprop=["']${prop}["'][^>]*content=["']([^"'<>]+)["']`, "i")) ??
     block.match(new RegExp(`content=["']([^"'<>]+)["'][^>]*itemprop=["']${prop}["']`, "i")))?.[1]?.trim() ?? "";

  const allIata = [
    ...block.matchAll(/itemprop=["']iataCode["'][^>]*content=["']([A-Z]{2,3})["']/gi),
    ...block.matchAll(/content=["']([A-Z]{2,3})["'][^>]*itemprop=["']iataCode["']/gi),
  ].map(m => m[1].toUpperCase());

  const seen = new Set<string>();
  const codes = allIata.filter(c => { if (seen.has(c)) return false; seen.add(c); return true; });
  if (!codes.length) return null;

  const airlineCode = codes[0];
  if (airlineCode.length !== 2) return null;
  const airports = codes.filter(c => c.length === 3);

  const rawNum = getMeta("flightNumber").replace(/\D/g, "");
  if (!rawNum) return null;
  const flightNum = parseInt(rawNum, 10);
  if (isNaN(flightNum)) return null;

  let date: string | null = null;
  const depTime = getMeta("departureTime");
  if (depTime) {
    const d = new Date(depTime);
    if (!isNaN(d.getTime())) date = d.toISOString().split("T")[0];
  }

  return {
    flight_number: `${airlineCode}${flightNum}`,
    airline: AIRLINE_NAMES[airlineCode] ?? airlineCode,
    departure_airport: airports[0] ?? null,
    arrival_airport: airports[1] ?? null,
    departure_date: date,
  };
}

function parseEmail(payload: any): ParsedFlight[] {
  const htmlParts = getHtmlParts(payload);
  const html = htmlParts.join("\n");
  if (!html) return [];
  if (html.includes("application/ld+json")) {
    const results = extractJsonLd(html);
    if (results.length) return results;
  }
  if (html.includes("FlightReservation")) {
    return extractMicrodata(html);
  }
  return [];
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

    // ── Step 1: Fetch threads (not messages) from category:reservations ───
    // Using threads instead of messages means one booking = one thread.
    // The first message in each thread is the original booking confirmation
    // with structured data. Follow-ups (gate change, check-in, boarding)
    // are later messages in the same thread — we skip them automatically.
    // 54 emails → ~20 unique threads → well within 35 subrequest budget.
    const threadsRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads?q=${encodeURIComponent("category:reservations newer_than:1095d")}&maxResults=40`,
      { headers: { Authorization: `Bearer ${googleToken}` } }
    );

    if (!threadsRes.ok) {
      if (threadsRes.status === 401) return { detected: 0, inserted: 0, error: "Gmail token expired — sign out and back in" };
      return { detected: 0, inserted: 0, error: `Gmail error ${threadsRes.status}` };
    }

    const threadsData = await threadsRes.json();
    const threads: any[] = threadsData.threads ?? [];
    if (!threads.length) return { detected: 0, inserted: 0, error: "No reservation emails found in Gmail" };

    // ── Step 2: For each thread, fetch the FIRST message only ─────────────
    // threads/{id}?format=metadata returns all message IDs in the thread.
    // We then fetch only messages[0] (original booking) with format=full.
    // This costs 2 subrequests per thread (metadata + full first message).
    // 20 threads × 2 = 40 subrequests + 1 list = 41 total. Fine.
    //
    // HOWEVER: to stay safe under 50, we fetch threads directly with
    // format=full which returns all messages in the thread in one call.
    // We then only parse the first message. 1 subrequest per thread.

    const flightMap = new Map<string, ParsedFlight>();
    let threadsProcessed = 0;

    for (const thread of threads) {
      // Stop if we're approaching the subrequest limit
      // 1 (threads list) + N (thread fetches) + 1 (delete) + 1 (insert) < 50
      if (threadsProcessed >= 45) break;

      try {
        const threadRes = await fetch(
          // format=metadata is fast and returns message list with snippets
          // We use it to get the oldest message ID cheaply
          `https://gmail.googleapis.com/gmail/v1/users/me/threads/${thread.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
          { headers: { Authorization: `Bearer ${googleToken}` } }
        );
        threadsProcessed++;
        if (!threadRes.ok) continue;

        const threadData = await threadRes.json();
        const threadMessages: any[] = threadData.messages ?? [];
        if (!threadMessages.length) continue;

        // Get the oldest message in thread (index 0 = first/oldest)
        // This is the original booking confirmation
        const firstMsg = threadMessages[0];

        // Quick subject check from metadata to skip obvious non-flight threads
        const subjectHeader = firstMsg.payload?.headers?.find((h: any) => h.name === "Subject");
        const subject = (subjectHeader?.value ?? "").toLowerCase();
        if (["hotel", "car hire", "car rental", "restaurant", "event", "concert", "train",
             "bus", "ferry", "cruise", "visa", "passport"].some(w => subject.includes(w))) continue;

        // Fetch full content of just this first message
        const msgRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${firstMsg.id}?format=full`,
          { headers: { Authorization: `Bearer ${googleToken}` } }
        );
        threadsProcessed++;
        if (!msgRes.ok) continue;

        const msgData = await msgRes.json();
        const flights = parseEmail(msgData.payload);

        for (const f of flights) {
          if (!f.flight_number) continue;
          const key = `${f.flight_number}-${f.departure_date ?? "nodate"}`;
          if (!flightMap.has(key)) {
            flightMap.set(key, f);
          } else {
            const ex = flightMap.get(key)!;
            if (!ex.departure_airport && f.departure_airport) ex.departure_airport = f.departure_airport;
            if (!ex.arrival_airport   && f.arrival_airport)   ex.arrival_airport   = f.arrival_airport;
            if (!ex.departure_date    && f.departure_date)    ex.departure_date    = f.departure_date;
          }
        }
      } catch { continue; }
    }

    if (!flightMap.size) {
      return {
        detected: threads.length,
        inserted: 0,
        error: "Reservation emails found but no structured flight data (JSON-LD/microdata) detected",
      };
    }

    // ── Step 3: Write to database ─────────────────────────────────────────
    const toInsert = [...flightMap.values()].map(f => ({
      user_id:           userId,
      flight_number:     f.flight_number,
      airline:           f.airline,
      departure_airport: f.departure_airport,
      arrival_airport:   f.arrival_airport,
      departure_date:    f.departure_date,
    }));

    await (supabase as any).from("flights").delete().eq("user_id", userId);

    const { data: ins, error: insErr } = await (supabase as any)
      .from("flights").insert(toInsert).select();

    return {
      detected: threads.length,
      inserted: ins?.length ?? 0,
      error: insErr?.message ?? null,
    };
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
