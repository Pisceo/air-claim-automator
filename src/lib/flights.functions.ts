import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const AIRLINE_MAP: Record<string, string> = {
  FR: "Ryanair", U2: "easyJet", W6: "Wizz Air", VY: "Vueling",
  KL: "KLM", AF: "Air France", LH: "Lufthansa", IB: "Iberia",
  BA: "British Airways", HV: "Transavia", DY: "Norwegian",
  TP: "TAP", TK: "Turkish Airlines", EK: "Emirates",
  UX: "Air Europa", UA: "United", DL: "Delta", AA: "American",
  QR: "Qatar Airways", EY: "Etihad", SK: "SAS", AY: "Finnair",
  LO: "LOT", A3: "Aegean", LX: "SWISS", OS: "Austrian",
  SN: "Brussels Airlines", V7: "Volotea", BT: "airBaltic",
  PC: "Pegasus", DE: "Condor",
};

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

const ALL_AIRPORTS = new Set([
  "MAD","BCN","AGP","PMI","ALC","VLC","SVQ","BIO","TFS","LPA","ACE","FUE","IBZ","MAH",
  "LHR","LGW","STN","LTN","MAN","EDI","BHX","GLA","BRS","NCL","EMA","ABZ","BFS","CWL",
  "AMS","EIN","RTM","BRU","LGG","LUX",
  "CDG","ORY","LYS","NCE","MRS","TLS","BOD","NTE","BSL","MPL",
  "FRA","MUC","BER","DUS","HAM","STR","CGN","NUE","HAJ","LEJ",
  "FCO","MXP","LIN","VCE","NAP","BLQ","PMO","CTA","CAG","BRI","TRN","VRN","PSA","FLR",
  "LIS","OPO","FAO",
  "CPH","ARN","GOT","OSL","BGO","TRD","HEL","RIX","TLL","VNO",
  "WAW","KRK","PRG","BUD","OTP","SOF","BEG","ZAG","LJU","SKP","TIA",
  "ATH","SKG","HER","RHO","CFU","KGS","LCA","PFO","CHQ",
  "DUB","ORK","SNN",
  "IST","SAW","AYT","ADB","ESB","ADA",
  "DXB","AUH","DOH","AMM","BEY","CAI","TLV","MCT","KWI","BAH",
  "JFK","EWR","LGA","LAX","ORD","ATL","DFW","MIA","BOS","SFO","SEA","DEN","IAD","IAH","PHX","LAS","MCO",
  "PEK","PKX","PVG","HKG","SIN","BKK","NRT","HND","ICN","KUL","CGK","MNL","DEL","BOM","DPS","CMB",
  "YYZ","YVR","MEX","GRU","EZE","SCL","LIM","BOG","NBO","JNB","CPT","SYD","MEL","AKL",
]);

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

function getPlainText(payload: any, depth = 0): string {
  if (depth > 4) return "";
  let text = "";
  if (payload?.parts) {
    for (const p of payload.parts) {
      if (p.mimeType === "text/plain" && p.body?.data) {
        try { text += base64Decode(p.body.data) + "\n"; } catch { /* skip */ }
      } else if (p.mimeType?.startsWith("multipart/")) {
        text += getPlainText(p, depth + 1);
      }
    }
  }
  return text;
}

// ─── STRUCTURED DATA: MICRODATA ──────────────────────────────────────────────
// Extracts schema.org/FlightReservation microdata blocks precisely
// Used by Iberia, United, Turkish Airlines, British Airways, Qatar

interface ParsedFlight {
  flightNumber: string;
  airline: string;
  dep: string | null;
  arr: string | null;
  date: string | null;
}

function extractMicrodata(html: string): ParsedFlight[] {
  const results: ParsedFlight[] = [];

  // Find the opening tag of each FlightReservation
  const openTagRe = /<[^>]+itemtype=["'][^"']*schema\.org\/FlightReservation["'][^>]*>/gi;
  const openMatches = [...html.matchAll(openTagRe)];

  for (const open of openMatches) {
    const start = (open.index ?? 0) + open[0].length;

    // Find matching closing </div> by counting nesting
    let depth = 1;
    let pos = start;
    while (pos < html.length && depth > 0) {
      const nextOpen  = html.indexOf("<div", pos);
      const nextClose = html.indexOf("</div", pos);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        pos = nextOpen + 4;
      } else {
        depth--;
        pos = nextClose + 5;
      }
    }

    // The block is html[start..pos]
    const block = html.slice(start, pos);
    const flight = parseMicrodataBlock(block);
    if (flight) results.push(flight);
  }

  return results;
}

function parseMicrodataBlock(block: string): ParsedFlight | null {
  // Extract all meta itemprop values — only look within this block
  function getMetaContent(prop: string): string {
    // Match both attribute orderings
    const re1 = new RegExp(`itemprop=["']${prop}["'][^>]*content=["']([^"'<>]+)["']`, "i");
    const re2 = new RegExp(`content=["']([^"'<>]+)["'][^>]*itemprop=["']${prop}["']`, "i");
    return (block.match(re1) || block.match(re2))?.[1]?.trim() ?? "";
  }

  // Get all iataCode values strictly within this block
  // Order: airline iataCode, then departure airport iataCode, then arrival airport iataCode
  const iataMatches = [
    ...block.matchAll(/itemprop=["']iataCode["'][^>]*content=["']([^"'<>]+)["']/gi),
    ...block.matchAll(/content=["']([^"'<>]+)["'][^>]*itemprop=["']iataCode["']/gi),
  ].map(m => m[1].trim().toUpperCase());

  // Deduplicate while preserving order
  const seen = new Set<string>();
  const iataCodes = iataMatches.filter(c => { if (seen.has(c)) return false; seen.add(c); return true; });

  if (iataCodes.length < 1) return null;

  const airlineCode = iataCodes[0];
  if (!AIRLINE_MAP[airlineCode]) return null;

  const dep = iataCodes[1] && ALL_AIRPORTS.has(iataCodes[1]) ? iataCodes[1] : null;
  const arr = iataCodes[2] && ALL_AIRPORTS.has(iataCodes[2]) ? iataCodes[2] : null;

  const rawFlightNum = getMetaContent("flightNumber");
  if (!rawFlightNum) return null;

  // Format flight number correctly: IB + 0740 = IB0740
  const numPart = rawFlightNum.replace(/\D/g, "");
  const flightNumber = `${airlineCode}${parseInt(numPart, 10)}`;

  // Get departure date from departureTime ISO string
  const depTime = getMetaContent("departureTime");
  let date: string | null = null;
  if (depTime) {
    // Parse ISO datetime — format as DD/MM/YYYY for display
    const d = new Date(depTime);
    if (!isNaN(d.getTime())) {
      // Store as YYYY-MM-DD internally, display logic handles format
      date = d.toISOString().split("T")[0];
    }
  }

  return {
    flightNumber,
    airline: AIRLINE_MAP[airlineCode],
    dep,
    arr,
    date,
  };
}

// ─── STRUCTURED DATA: JSON-LD ────────────────────────────────────────────────

function extractJsonLd(html: string): ParsedFlight[] {
  const results: ParsedFlight[] = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const json = JSON.parse(match[1].trim());
      const items = Array.isArray(json) ? json : [json];
      for (const item of items) {
        for (const node of (item["@graph"] ?? [item])) {
          const f = parseJsonLdNode(Array.isArray(node) ? node[0] : node);
          if (f) results.push(f);
        }
      }
    } catch { /* skip */ }
  }
  return results;
}

function parseJsonLdNode(node: any): ParsedFlight | null {
  if (!node || typeof node !== "object") return null;
  const rf = node.reservationFor ?? node;
  const flight = node["@type"] === "Flight" ? node : rf;
  if (!flight) return null;
  const rawNum = String(flight.flightNumber ?? "");
  const iataCode = (flight.airline?.iataCode ?? "").toUpperCase();
  if (!rawNum || !iataCode || !AIRLINE_MAP[iataCode]) return null;
  const flightNumber = `${iataCode}${rawNum.replace(/\D/g, "")}`;
  const dep = (flight.departureAirport?.iataCode ?? "").toUpperCase();
  const arr = (flight.arrivalAirport?.iataCode ?? "").toUpperCase();
  let date: string | null = null;
  if (flight.departureTime) {
    const d = new Date(flight.departureTime);
    if (!isNaN(d.getTime())) date = d.toISOString().split("T")[0];
  }
  return {
    flightNumber,
    airline: AIRLINE_MAP[iataCode],
    dep: ALL_AIRPORTS.has(dep) ? dep : null,
    arr: ALL_AIRPORTS.has(arr) ? arr : null,
    date,
  };
}

// ─── REGEX FALLBACK ──────────────────────────────────────────────────────────
// For KLM check-in emails which embed data only in HTML table cells

function extractRegex(allText: string, from: string): ParsedFlight | null {
  const fnMatch = allText.match(/\b([A-Z]{2})(\d{3,4})\b/);
  if (!fnMatch || !AIRLINE_MAP[fnMatch[1]]) return null;
  const flightNumber = fnMatch[1] + fnMatch[2];
  const airlineCode  = fnMatch[1];

  // "Madrid (MAD)" pattern — most reliable for KLM
  const cityIata: string[] = [];
  for (const m of allText.matchAll(/[A-Z][a-zA-Z\s]+\(([A-Z]{3})\)/g)) {
    if (ALL_AIRPORTS.has(m[1])) cityIata.push(m[1]);
  }

  const dep = cityIata[0] ?? null;
  const arr = cityIata[1] ?? null;
  const date = extractDate(allText);
  if (!date) return null;

  const airline = guessAirline(from) || AIRLINE_MAP[airlineCode] || airlineCode;
  return { flightNumber, airline, dep, arr, date };
}

function extractDate(text: string): string | null {
  const M: Record<string, string> = {
    jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",
    jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12",
  };
  const all: string[] = [];

  // ISO: 2026-04-07
  for (const m of text.matchAll(/\b(202[0-7])-(\d{2})-(\d{2})\b/g))
    all.push(`${m[1]}-${m[2]}-${m[3]}`);

  // "7 April 2026" or "07 Apr 2026"
  for (const m of text.matchAll(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+(202[0-7])\b/gi))
    all.push(`${m[3]}-${M[m[2].toLowerCase().slice(0,3)]}-${m[1].padStart(2,"0")}`);

  // "April 7, 2026"
  for (const m of text.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+(\d{1,2})[,\s]+(202[0-7])\b/gi))
    all.push(`${m[3]}-${M[m[1].toLowerCase().slice(0,3)]}-${m[2].padStart(2,"0")}`);

  // KLM: "Thu 28 May 26"
  for (const m of text.matchAll(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{2})\b/gi)) {
    const yr = `20${m[3]}`;
    if (parseInt(yr) >= 2020 && parseInt(yr) <= 2027)
      all.push(`${yr}-${M[m[2].toLowerCase().slice(0,3)]}-${m[1].padStart(2,"0")}`);
  }

  // DD/MM/YYYY
  for (const m of text.matchAll(/\b(\d{2})\/(\d{2})\/(202[0-7])\b/g))
    all.push(`${m[3]}-${m[2]}-${m[1]}`);

  const valid = all.filter(d => !isNaN(new Date(d).getTime()));
  if (!valid.length) return null;
  valid.sort();
  return valid[0];
}

function guessAirline(from: string): string | null {
  const f = from.toLowerCase();
  if (f.includes("klm")) return "KLM";
  if (f.includes("ryanair")) return "Ryanair";
  if (f.includes("easyjet")) return "easyJet";
  if (f.includes("wizz")) return "Wizz Air";
  if (f.includes("vueling")) return "Vueling";
  if (f.includes("airfrance") || f.includes("air-france")) return "Air France";
  if (f.includes("lufthansa")) return "Lufthansa";
  if (f.includes("iberia")) return "Iberia";
  if (f.includes("britishairways")) return "British Airways";
  if (f.includes("transavia")) return "Transavia";
  if (f.includes("norwegian")) return "Norwegian";
  if (f.includes("tap")) return "TAP";
  if (f.includes("turkishairlines") || f.includes("thy.com")) return "Turkish Airlines";
  if (f.includes("emirates")) return "Emirates";
  if (f.includes("united.com")) return "United";
  if (f.includes("delta.com")) return "Delta";
  if (f.includes("qatarairways")) return "Qatar Airways";
  return null;
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

    const domainQuery = AIRLINE_DOMAINS.map(d => `from:${d}`).join(" OR ");

    // Two targeted searches to maximize finding real booking emails
    // Search 1: booking confirmations (have unique flights, older)
    const q1 = `(${domainQuery}) (subject:booking OR subject:confirmation OR subject:reservation OR subject:"your trip" OR subject:itinerary OR subject:"e-ticket") newer_than:1095d`;
    // Search 2: boarding passes (have clean microdata)
    const q2 = `(${domainQuery}) (subject:"boarding pass" OR subject:"check in" OR subject:checkin OR subject:"ready to fly") newer_than:1095d`;

    const [r1, r2] = await Promise.all([
      fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q1)}&maxResults=20`, { headers: { Authorization: `Bearer ${googleToken}` } }),
      fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q2)}&maxResults=13`, { headers: { Authorization: `Bearer ${googleToken}` } }),
    ]);

    if (!r1.ok && !r2.ok) {
      if (r1.status === 401) return { detected: 0, inserted: 0, error: "Gmail token expired — sign out and back in" };
      return { detected: 0, inserted: 0, error: `Gmail error ${r1.status}` };
    }

    const [d1, d2] = await Promise.all([r1.ok ? r1.json() : { messages: [] }, r2.ok ? r2.json() : { messages: [] }]);

    // Deduplicate message IDs — same email can appear in both searches
    const seenIds = new Set<string>();
    const messages: any[] = [];
    for (const m of [...(d1.messages ?? []), ...(d2.messages ?? [])]) {
      if (!seenIds.has(m.id)) { seenIds.add(m.id); messages.push(m); }
    }

    if (!messages.length) return { detected: 0, inserted: 0, error: "No matching emails found" };

    await (supabase as any).from("flights").delete().eq("user_id", userId);

    // Key: "FLIGHTNUM-DATE" → one record per unique flight
    const flightMap = new Map<string, any>();

    for (const msg of messages) {
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
        const dateHdr = hdrs.find((h: any) => h.name === "Date")?.value ?? "";

        const subj = subject.toLowerCase();
        if (["survey","newsletter","unsubscribe","miles earned","points earned","feedback","satisfaction"]
            .some(w => subj.includes(w))) continue;

        const htmlParts = getHtmlParts(full.payload);
        const fullHtml  = htmlParts.join("\n");
        const plainText = getPlainText(full.payload);
        const allText   = subject + "\n" + plainText + "\n" +
                          fullHtml.replace(/<style[\s\S]*?<\/style>/gi, "")
                                  .replace(/<script[\s\S]*?<\/script>/gi, "")
                                  .replace(/<[^>]+>/g, " ")
                                  .replace(/\s+/g, " ");

        let parsed: ParsedFlight[] = [];

        // Strategy 1: microdata (Iberia, United, Turkish, Qatar, BA)
        if (fullHtml.includes("FlightReservation")) {
          parsed = extractMicrodata(fullHtml);
        }

        // Strategy 2: JSON-LD
        if (!parsed.length && fullHtml.includes("ld+json")) {
          parsed = extractJsonLd(fullHtml);
        }

        // Strategy 3: regex (KLM check-in, others)
        if (!parsed.length) {
          const f = extractRegex(allText, from);
          if (f) parsed.push(f);
        }

        // Fill missing dates from email header
        for (const pf of parsed) {
          if (!pf.date) {
            const d = new Date(dateHdr);
            if (!isNaN(d.getTime())) pf.date = d.toISOString().split("T")[0];
          }
        }

        for (const pf of parsed) {
          if (!pf.flightNumber || !pf.date) continue;
          const key = `${pf.flightNumber}-${pf.date}`;
          if (!flightMap.has(key)) {
            flightMap.set(key, {
              user_id: userId,
              airline: pf.airline,
              flight_number: pf.flightNumber,
              departure_airport: pf.dep,
              arrival_airport: pf.arr,
              departure_date: pf.date,
              raw_email_snippet: (full.snippet ?? "").slice(0, 200),
            });
          } else {
            const ex = flightMap.get(key)!;
            if (!ex.departure_airport && pf.dep) ex.departure_airport = pf.dep;
            if (!ex.arrival_airport   && pf.arr) ex.arrival_airport   = pf.arr;
          }
        }
      } catch { continue; }
    }

    const toInsert = [...flightMap.values()].filter(f =>
      f.flight_number && f.departure_date &&
      !isNaN(new Date(f.departure_date).getTime())
    );

    let actuallyInserted = 0;
    let insertError = null;
    if (toInsert.length) {
      const { data: ins, error: insErr } = await (supabase as any)
        .from("flights").upsert(toInsert, { onConflict: "user_id,flight_number,departure_date", ignoreDuplicates: true }).select();
      if (insErr) insertError = insErr.message;
      else actuallyInserted = ins?.length ?? 0;
    }

    return { detected: messages.length, parsed: toInsert.length, inserted: actuallyInserted, error: insertError };
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
