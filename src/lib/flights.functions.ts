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
  "klm.com", "airfrance.com", "lufthansa.com", "iberia.com",
  "britishairways.com", "transavia.com", "norwegian.com", "tap.pt",
  "turkishairlines.com", "emirates.com", "aireuropa.com",
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

const CITY_IATA: Record<string, string> = {
  "madrid": "MAD", "amsterdam": "AMS", "barcelona": "BCN",
  "london": "LHR", "london heathrow": "LHR", "london gatwick": "LGW",
  "london stansted": "STN", "london luton": "LTN",
  "paris": "CDG", "paris charles de gaulle": "CDG", "paris orly": "ORY",
  "frankfurt": "FRA", "munich": "MUC", "berlin": "BER",
  "rome": "FCO", "milan": "MXP", "venice": "VCE", "naples": "NAP",
  "lisbon": "LIS", "porto": "OPO", "faro": "FAO",
  "istanbul": "IST", "istanbul ataturk": "IST", "istanbul sabiha": "SAW",
  "dubai": "DXB", "abu dhabi": "AUH", "doha": "DOH",
  "athens": "ATH", "vienna": "VIE", "zurich": "ZRH",
  "brussels": "BRU", "copenhagen": "CPH", "stockholm": "ARN",
  "oslo": "OSL", "helsinki": "HEL", "warsaw": "WAW",
  "dublin": "DUB", "new york": "JFK", "new york jfk": "JFK",
  "newark": "EWR", "new york newark": "EWR", "los angeles": "LAX",
  "chicago": "ORD", "miami": "MIA", "boston": "BOS",
  "san francisco": "SFO", "washington": "IAD", "houston": "IAH",
  "dallas": "DFW", "toronto": "YYZ", "mexico city": "MEX",
  "hong kong": "HKG", "singapore": "SIN", "bangkok": "BKK",
  "tokyo": "NRT", "seoul": "ICN", "kuala lumpur": "KUL",
  "delhi": "DEL", "mumbai": "BOM", "sydney": "SYD", "melbourne": "MEL",
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────

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

function extractBodyText(payload: any, depth = 0): string {
  if (depth > 4) return "";
  let text = "";
  if (payload?.body?.data) {
    try { text += base64Decode(payload.body.data); } catch { /* skip */ }
  }
  if (payload?.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        try { text += base64Decode(part.body.data) + "\n"; } catch { /* skip */ }
      } else if (part.mimeType?.startsWith("multipart/")) {
        text += extractBodyText(part, depth + 1);
      }
    }
    if (!text.trim()) {
      for (const part of payload.parts) {
        if (part.mimeType === "text/html" && part.body?.data) {
          try {
            text += base64Decode(part.body.data).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
          } catch { /* skip */ }
        }
      }
    }
  }
  return text;
}

function extractHtmlParts(payload: any, depth = 0): string[] {
  if (depth > 4) return [];
  const htmlParts: string[] = [];
  if (payload?.body?.data && payload?.mimeType === "text/html") {
    try { htmlParts.push(base64Decode(payload.body.data)); } catch { /* skip */ }
  }
  if (payload?.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        try { htmlParts.push(base64Decode(part.body.data)); } catch { /* skip */ }
      } else if (part.mimeType?.startsWith("multipart/")) {
        htmlParts.push(...extractHtmlParts(part, depth + 1));
      }
    }
  }
  return htmlParts;
}

// ─── STRUCTURED DATA EXTRACTION (JSON-LD / Schema.org) ───────────────────────
// This reads the Google flight widgets embedded in airline emails
// Returns array of flights (one email can have multiple e.g. layovers, round trips)

interface ParsedFlight {
  flightNumber: string;
  airline: string;
  dep: string | null;
  arr: string | null;
  date: string | null;
  confirmationCode?: string;
}

function extractFromJsonLd(htmlParts: string[]): ParsedFlight[] {
  const flights: ParsedFlight[] = [];

  for (const html of htmlParts) {
    // Find all <script type="application/ld+json"> blocks
    const scriptMatches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    for (const match of scriptMatches) {
      try {
        const json = JSON.parse(match[1].trim());
        const items = Array.isArray(json) ? json : [json];

        for (const item of items) {
          // Handle @graph arrays (some airlines wrap in @graph)
          const nodes = item["@graph"] ? item["@graph"] : [item];

          for (const node of nodes) {
            const reservations = Array.isArray(node) ? node : [node];
            for (const res of reservations) {
              const parsed = parseReservationNode(res);
              if (parsed) flights.push(parsed);
            }
          }
        }
      } catch { /* invalid JSON, skip */ }
    }
  }

  return flights;
}

function parseReservationNode(node: any): ParsedFlight | null {
  if (!node || typeof node !== "object") return null;

  // Support FlightReservation, ReservationPackage, or direct Flight objects
  const type = node["@type"] ?? "";
  const reservationFor = node.reservationFor ?? node;

  // Handle arrays of reservations (round trips)
  if (Array.isArray(node.reservationFor)) {
    // Return first leg only — each will be processed separately
    return parseReservationNode({ ...node, reservationFor: node.reservationFor[0] });
  }

  const flight = type === "Flight" ? node : reservationFor;
  if (!flight) return null;

  // Extract flight number
  const rawNum = flight.flightNumber ?? flight.flight_number ?? "";
  const airlineObj = flight.airline ?? flight.operatingAirline ?? {};
  const iataCode = airlineObj.iataCode ?? airlineObj.iata_code ?? "";

  if (!rawNum && !iataCode) return null;

  const flightNumber = iataCode && rawNum
    ? `${iataCode}${rawNum}`
    : (rawNum || "").toString();

  if (!flightNumber || !AIRLINE_MAP[flightNumber.slice(0, 2)]) return null;

  // Extract airports
  const depObj = flight.departureAirport ?? flight.departure_airport ?? {};
  const arrObj = flight.arrivalAirport ?? flight.arrival_airport ?? {};
  const dep = depObj.iataCode ?? depObj.iata_code ?? null;
  const arr = arrObj.iataCode ?? arrObj.iata_code ?? null;

  // Extract date from departureTime
  const depTime = flight.departureTime ?? flight.departure_time ?? "";
  let date: string | null = null;
  if (depTime) {
    const d = new Date(depTime);
    if (!isNaN(d.getTime())) {
      date = d.toISOString().split("T")[0];
    }
  }

  // Confirmation / booking reference
  const confirmationCode = node.reservationNumber ?? node.reservationId ?? node.bookingReference ?? undefined;

  const airlineName = AIRLINE_MAP[flightNumber.slice(0, 2)] ?? iataCode;

  return {
    flightNumber: flightNumber.toUpperCase(),
    airline: airlineName,
    dep: dep ? dep.toUpperCase() : null,
    arr: arr ? arr.toUpperCase() : null,
    date,
    confirmationCode,
  };
}

// ─── FALLBACK: regex-based extraction ────────────────────────────────────────

function extractFlightNumbers(text: string): string[] {
  const results: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/\b([A-Z]{2})(\d{3,4})\b/g)) {
    const full = m[1] + m[2];
    if (AIRLINE_MAP[m[1]] && !seen.has(full)) { seen.add(full); results.push(full); }
  }
  return results;
}

function extractRoute(text: string): { dep: string | null; arr: string | null } {
  for (const re of [
    /\b([A-Z]{3})\s*(?:→|->|➜|⟶)\s*([A-Z]{3})\b/g,
    /\b([A-Z]{3})\s*[-–—]\s*([A-Z]{3})\b/g,
  ]) {
    const m = re.exec(text);
    if (m && ALL_AIRPORTS.has(m[1]) && ALL_AIRPORTS.has(m[2]) && m[1] !== m[2]) {
      return { dep: m[1], arr: m[2] };
    }
  }
  const cityArrow = /\b([A-Za-z][a-z]+(?: [A-Za-z][a-z]+)*)\s*(?:→|->|to)\s*([A-Za-z][a-z]+(?: [A-Za-z][a-z]+)*)/gi;
  for (const m of text.matchAll(cityArrow)) {
    const dep = CITY_IATA[m[1].toLowerCase().trim()];
    const arr = CITY_IATA[m[2].toLowerCase().trim()];
    if (dep && arr && dep !== arr) return { dep, arr };
  }
  const codes = [...text.matchAll(/\b([A-Z]{3})\b/g)].map(m => m[1]).filter(c => ALL_AIRPORTS.has(c));
  const unique = [...new Set(codes)];
  return unique.length >= 2 ? { dep: unique[0], arr: unique[1] } : { dep: null, arr: null };
}

function extractDate(text: string): string | null {
  const MONTHS: Record<string, string> = {
    jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",
    jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12",
    january:"01",february:"02",march:"03",april:"04",june:"06",
    july:"07",august:"08",september:"09",october:"10",november:"11",december:"12",
  };
  const candidates: string[] = [];
  const p1 = /\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(20\d{2})\b/gi;
  const p2 = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})[,\s]+(20\d{2})\b/gi;
  const p3 = /\b(20\d{2})-(\d{2})-(\d{2})\b/g;
  const p4 = /\b(\d{2})\/(\d{2})\/(20\d{2})\b/g;
  let m;
  while ((m = p1.exec(text))) {
    const y = m[3], mo = MONTHS[m[2].toLowerCase().slice(0,3)] || "01", d = m[1].padStart(2,"0");
    if (parseInt(y) >= 2020 && parseInt(y) <= 2027) candidates.push(`${y}-${mo}-${d}`);
  }
  while ((m = p2.exec(text))) {
    const y = m[3], mo = MONTHS[m[1].toLowerCase().slice(0,3)] || "01", d = m[2].padStart(2,"0");
    if (parseInt(y) >= 2020 && parseInt(y) <= 2027) candidates.push(`${y}-${mo}-${d}`);
  }
  while ((m = p3.exec(text))) {
    if (parseInt(m[1]) >= 2020 && parseInt(m[1]) <= 2027) candidates.push(`${m[1]}-${m[2]}-${m[3]}`);
  }
  while ((m = p4.exec(text))) {
    if (parseInt(m[3]) >= 2020 && parseInt(m[3]) <= 2027) candidates.push(`${m[3]}-${m[2]}-${m[1]}`);
  }
  const valid = candidates.filter(d => !isNaN(new Date(d).getTime()));
  if (valid.length === 0) return null;
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
  if (f.includes("tap.pt")) return "TAP";
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

    // 1 subrequest: list emails
    const domainQuery = AIRLINE_DOMAINS.map(d => `from:${d}`).join(" OR ");
    const q = `(${domainQuery}) newer_than:1095d`;

    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=35`,
      { headers: { Authorization: `Bearer ${googleToken}` } }
    );

    if (!listRes.ok) {
      if (listRes.status === 401) return { detected: 0, inserted: 0, error: "Gmail token expired — sign out and back in" };
      return { detected: 0, inserted: 0, error: `Gmail error ${listRes.status}` };
    }

    const messages: any[] = (await listRes.json()).messages ?? [];
    if (messages.length === 0) return { detected: 0, inserted: 0, error: "No matching emails found" };

    // Clear old flights
    await (supabase as any).from("flights").delete().eq("user_id", userId);

    // flightMap key = "FLIGHTNUM-DATE" — deduplicates across multiple emails for same flight
    const flightMap = new Map<string, any>();

    // Up to 35 subrequests for full email content — total stays under 50
    for (const msg of messages) {
      try {
        const res = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
          { headers: { Authorization: `Bearer ${googleToken}` } }
        );
        if (!res.ok) continue;
        const full = await res.json();

        const hdrs = full.payload?.headers ?? [];
        const subject = hdrs.find((h: any) => h.name === "Subject")?.value ?? "";
        const from    = hdrs.find((h: any) => h.name === "From")?.value ?? "";
        const dateHdr = hdrs.find((h: any) => h.name === "Date")?.value ?? "";

        // Skip clearly non-booking emails
        const subj = subject.toLowerCase();
        if (["survey","newsletter","unsubscribe","miles earned","points earned",
             "feedback","satisfaction"].some(w => subj.includes(w))) continue;

        // ── Strategy 1: extract JSON-LD structured data (most reliable) ──
        const htmlParts = extractHtmlParts(full.payload);
        const structuredFlights = extractFromJsonLd(htmlParts);

        if (structuredFlights.length > 0) {
          // We got clean structured data — use it directly
          for (const sf of structuredFlights) {
            if (!sf.date) {
              // Fall back to email date if JSON-LD missing date
              const ed = new Date(dateHdr);
              if (!isNaN(ed.getTime())) sf.date = ed.toISOString().split("T")[0];
            }
            if (!sf.date) continue;

            const key = `${sf.flightNumber}-${sf.date}`;
            if (!flightMap.has(key)) {
              flightMap.set(key, {
                user_id: userId,
                airline: sf.airline,
                flight_number: sf.flightNumber,
                departure_airport: sf.dep,
                arrival_airport: sf.arr,
                departure_date: sf.date,
                raw_email_snippet: (full.snippet ?? "").slice(0, 200),
              });
            } else {
              // Enrich missing fields
              const ex = flightMap.get(key);
              if (!ex.departure_airport && sf.dep) ex.departure_airport = sf.dep;
              if (!ex.arrival_airport && sf.arr) ex.arrival_airport = sf.arr;
            }
          }
          continue; // Don't also do regex for this email
        }

        // ── Strategy 2: regex fallback for emails without JSON-LD ──
        const body = extractBodyText(full.payload);
        const all  = subject + "\n" + body;

        const fns = extractFlightNumbers(all);
        if (fns.length === 0) continue;

        const { dep, arr } = extractRoute(all);
        let flightDate = extractDate(all);
        if (!flightDate) {
          const ed = new Date(dateHdr);
          if (!isNaN(ed.getTime())) flightDate = ed.toISOString().split("T")[0];
        }
        if (!flightDate) continue;

        const airline = guessAirline(from) || AIRLINE_MAP[fns[0].slice(0,2)] || fns[0].slice(0,2);
        const fn  = fns[0];
        const key = `${fn}-${flightDate}`;

        if (!flightMap.has(key)) {
          flightMap.set(key, {
            user_id: userId, airline, flight_number: fn,
            departure_airport: dep, arrival_airport: arr,
            departure_date: flightDate,
            raw_email_snippet: (full.snippet ?? "").slice(0, 200),
          });
        } else {
          const ex = flightMap.get(key);
          if (!ex.departure_airport && dep) ex.departure_airport = dep;
          if (!ex.arrival_airport && arr) ex.arrival_airport = arr;
        }
      } catch { continue; }
    }

    const toInsert = [...flightMap.values()].filter(f => {
      if (!f.flight_number || !f.departure_date) return false;
      const d = new Date(f.departure_date);
      return !isNaN(d.getTime()) && d.getFullYear() >= 2020 && d.getFullYear() <= 2027;
    });

    let actuallyInserted = 0;
    let insertError = null;

    if (toInsert.length > 0) {
      const { data: ins, error: insErr } = await (supabase as any)
        .from("flights").insert(toInsert).select();
      if (insErr) { insertError = insErr.message; }
      else { actuallyInserted = ins?.length ?? 0; }
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
