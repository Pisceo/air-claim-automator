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

// Strategy 1: JSON-LD <script type="application/ld+json">
// Used by: Qatar Airways, some Iberia emails, United, KLM booking confirmations
function extractJsonLd(html: string): ParsedFlight[] {
  const results: ParsedFlight[] = [];
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];

  for (const s of scripts) {
    try {
      const json = JSON.parse(s[1].trim());
      const items = Array.isArray(json) ? json : [json];
      for (const item of items) {
        const nodes = item["@graph"] ? item["@graph"] : [item];
        for (const node of nodes) {
          // Handle both FlightReservation and direct arrays
          const reservations = Array.isArray(node) ? node : [node];
          for (const res of reservations) {
            const f = parseJsonLdReservation(res);
            if (f) results.push(f);
          }
        }
      }
    } catch { /* invalid JSON */ }
  }
  return results;
}

function parseJsonLdReservation(node: any): ParsedFlight | null {
  if (!node || typeof node !== "object") return null;

  // Handle ReservationPackage containing multiple FlightReservations
  if (Array.isArray(node.subReservation)) {
    const flights: ParsedFlight[] = [];
    for (const sub of node.subReservation) {
      const f = parseJsonLdReservation(sub);
      if (f) flights.push(f);
    }
    return flights[0] ?? null; // Return first, rest handled by loop
  }

  const rf = node.reservationFor;
  if (!rf) return null;

  const iataCode = (rf.airline?.iataCode ?? rf.operatingAirline?.iataCode ?? "").toUpperCase();
  const rawNum = String(rf.flightNumber ?? "").replace(/\D/g, "");
  if (!iataCode || !rawNum) return null;

  const flightNum = parseInt(rawNum, 10);
  if (isNaN(flightNum)) return null;

  const dep = (rf.departureAirport?.iataCode ?? "").toUpperCase();
  const arr = (rf.arrivalAirport?.iataCode ?? "").toUpperCase();

  let date: string | null = null;
  if (rf.departureTime) {
    const d = new Date(rf.departureTime);
    if (!isNaN(d.getTime())) date = d.toISOString().split("T")[0];
  }

  const AIRLINE_NAMES: Record<string, string> = {
    IB: "Iberia", KL: "KLM", QR: "Qatar Airways", TK: "Turkish Airlines",
    UA: "United", BA: "British Airways", FR: "Ryanair", U2: "easyJet",
    VY: "Vueling", AF: "Air France", LH: "Lufthansa", EK: "Emirates",
    W6: "Wizz Air", HV: "Transavia", DY: "Norwegian", TP: "TAP",
    UX: "Air Europa", DL: "Delta", AA: "American", QR2: "Qatar Airways",
    EY: "Etihad", SK: "SAS", AY: "Finnair", LO: "LOT", LX: "SWISS",
    OS: "Austrian", SN: "Brussels Airlines", V7: "Volotea", BT: "airBaltic",
  };

  return {
    flight_number: `${iataCode}${flightNum}`,
    airline: rf.airline?.name ?? AIRLINE_NAMES[iataCode] ?? iataCode,
    departure_airport: dep.length === 3 ? dep : null,
    arrival_airport: arr.length === 3 ? arr : null,
    departure_date: date,
  };
}

// Strategy 2: HTML Microdata (itemprop)
// Used by: Iberia boarding passes, Turkish Airlines, United check-in emails
// This is what powers the Google flight widgets in Gmail
function extractMicrodata(html: string): ParsedFlight[] {
  const results: ParsedFlight[] = [];

  // Find every FlightReservation block boundary
  const openRe = /<[^>]+itemtype=["'][^"']*FlightReservation["'][^>]*>/gi;
  const opens = [...html.matchAll(openRe)];
  if (!opens.length) return [];

  for (const open of opens) {
    const blockStart = (open.index ?? 0) + open[0].length;

    // Walk forward counting div depth to find end of block
    let depth = 1;
    let pos = blockStart;
    while (pos < html.length && depth > 0) {
      const nextOpen  = html.indexOf("<div",  pos);
      const nextClose = html.indexOf("</div", pos);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        pos = nextOpen + 4;
      } else {
        depth--;
        pos = nextClose + 6;
      }
    }

    const block = html.slice(blockStart, pos);
    const f = parseMicrodataBlock(block);
    if (f) results.push(f);
  }

  return results;
}

function parseMicrodataBlock(block: string): ParsedFlight | null {
  function getMeta(prop: string): string {
    const r1 = block.match(new RegExp(`itemprop=["']${prop}["'][^>]*content=["']([^"'<>]+)["']`, "i"));
    const r2 = block.match(new RegExp(`content=["']([^"'<>]+)["'][^>]*itemprop=["']${prop}["']`, "i"));
    return (r1 ?? r2)?.[1]?.trim() ?? "";
  }

  // Collect all iataCode values IN ORDER — airline code first, then dep, then arr
  const allIata = [
    ...block.matchAll(/itemprop=["']iataCode["'][^>]*content=["']([A-Z]{2,3})["']/gi),
    ...block.matchAll(/content=["']([A-Z]{2,3})["'][^>]*itemprop=["']iataCode["']/gi),
  ].map(m => m[1].toUpperCase());

  // Deduplicate preserving order
  const seen = new Set<string>();
  const codes = allIata.filter(c => { if (seen.has(c)) return false; seen.add(c); return true; });

  if (codes.length < 1) return null;

  const airlineCode = codes[0];
  // Airline codes are 2 chars, airport codes are 3 chars
  const airports = codes.filter(c => c.length === 3);
  const dep = airports[0] ?? null;
  const arr = airports[1] ?? null;

  const rawNum = getMeta("flightNumber").replace(/\D/g, "");
  if (!rawNum) return null;
  const flightNum = parseInt(rawNum, 10);
  if (isNaN(flightNum) || airlineCode.length !== 2) return null;

  const depTime = getMeta("departureTime");
  let date: string | null = null;
  if (depTime) {
    const d = new Date(depTime);
    if (!isNaN(d.getTime())) date = d.toISOString().split("T")[0];
  }

  const AIRLINE_NAMES: Record<string, string> = {
    IB: "Iberia", KL: "KLM", QR: "Qatar Airways", TK: "Turkish Airlines",
    UA: "United", BA: "British Airways", FR: "Ryanair", U2: "easyJet",
    VY: "Vueling", AF: "Air France", LH: "Lufthansa", EK: "Emirates",
    W6: "Wizz Air", HV: "Transavia", DY: "Norwegian", TP: "TAP",
    UX: "Air Europa", DL: "Delta", AA: "American", EY: "Etihad",
    SK: "SAS", AY: "Finnair", LO: "LOT", LX: "SWISS", OS: "Austrian",
    SN: "Brussels Airlines", V7: "Volotea", BT: "airBaltic",
  };

  return {
    flight_number: `${airlineCode}${flightNum}`,
    airline: AIRLINE_NAMES[airlineCode] ?? airlineCode,
    departure_airport: dep,
    arrival_airport: arr,
    departure_date: date,
  };
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

    // ── Step 1: Fetch emails from category:reservations ───────────────────
    // This is Gmail's own booking/reservation category — filters out all
    // promotional emails, newsletters, and marketing automatically.
    // It's the same filter that powers Google's trip detection.
    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent("category:reservations newer_than:1095d")}&maxResults=40`,
      { headers: { Authorization: `Bearer ${googleToken}` } }
    );

    if (!listRes.ok) {
      if (listRes.status === 401) return { detected: 0, inserted: 0, error: "Gmail token expired — sign out and back in" };
      return { detected: 0, inserted: 0, error: `Gmail error ${listRes.status}` };
    }

    const listData = await listRes.json();
    const messages: any[] = listData.messages ?? [];
    if (!messages.length) return { detected: 0, inserted: 0, error: "No reservation emails found" };

    // ── Step 2: Fetch and parse each email ────────────────────────────────
    // Budget: 1 (list) + up to 35 (full fetch) + 1 (delete) + 1 (insert) = 38
    const flightMap = new Map<string, ParsedFlight>();

    for (const msg of messages.slice(0, 35)) {
      try {
        const res = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
          { headers: { Authorization: `Bearer ${googleToken}` } }
        );
        if (!res.ok) continue;
        const full = await res.json();

        const htmlParts = getHtmlParts(full.payload);
        const fullHtml = htmlParts.join("\n");
        if (!fullHtml) continue;

        // Try JSON-LD first (Qatar Airways, some KLM, some United)
        let parsed: ParsedFlight[] = [];

        if (fullHtml.includes("application/ld+json")) {
          parsed = extractJsonLd(fullHtml);
        }

        // Try microdata if JSON-LD found nothing (Iberia, Turkish, most others)
        if (!parsed.length && fullHtml.includes("FlightReservation")) {
          parsed = extractMicrodata(fullHtml);
        }

        // Deduplicate into map
        for (const f of parsed) {
          if (!f.flight_number) continue;
          const key = `${f.flight_number}-${f.departure_date ?? "nodate"}`;
          if (!flightMap.has(key)) {
            flightMap.set(key, f);
          } else {
            // Enrich existing record with any missing fields
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
        detected: messages.length,
        inserted: 0,
        error: "Emails found but no structured flight data detected. Airlines may not include Schema.org markup.",
      };
    }

    // ── Step 3: Write to database ─────────────────────────────────────────
    const toInsert = [...flightMap.values()].map(f => ({
      user_id: userId,
      flight_number:      f.flight_number,
      airline:            f.airline,
      departure_airport:  f.departure_airport,
      arrival_airport:    f.arrival_airport,
      departure_date:     f.departure_date,
    }));

    await (supabase as any).from("flights").delete().eq("user_id", userId);

    const { data: ins, error: insErr } = await (supabase as any)
      .from("flights").insert(toInsert).select();

    return {
      detected: messages.length,
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
