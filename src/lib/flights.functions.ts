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
  if (payload?.body?.data) {
    try { text += base64Decode(payload.body.data); } catch { /* skip */ }
  }
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

// ─── STRATEGY 1: HTML MICRODATA (itemprop) ────────────────────────────────────
// Used by: Iberia, United, Turkish Airlines, British Airways

interface ParsedFlight {
  flightNumber: string;
  airline: string;
  dep: string | null;
  arr: string | null;
  date: string | null;
}

function extractFromMicrodata(html: string): ParsedFlight[] {
  const flights: ParsedFlight[] = [];

  // Find all FlightReservation blocks
  const reservationBlocks = html.matchAll(
    /itemtype=["'][^"']*FlightReservation["'][^>]*>([\s\S]*?)(?=itemtype=["'][^"']*FlightReservation["']|$)/gi
  );

  for (const block of reservationBlocks) {
    const content = block[1];
    const flight = parseItempropBlock(content);
    if (flight) flights.push(flight);
  }

  // Fallback: try whole HTML if no blocks found
  if (flights.length === 0) {
    const flight = parseItempropBlock(html);
    if (flight) flights.push(flight);
  }

  return flights;
}

function parseItempropBlock(html: string): ParsedFlight | null {
  // Extract itemprop meta values
  function getMeta(prop: string): string {
    const m = html.match(new RegExp(`itemprop=["']${prop}["'][^>]*content=["']([^"']+)["']`, "i"))
      || html.match(new RegExp(`content=["']([^"']+)["'][^>]*itemprop=["']${prop}["']`, "i"));
    return m ? m[1].trim() : "";
  }

  // Get all iataCode values in order: airline, departureAirport, arrivalAirport
  const iataCodes = [...html.matchAll(/itemprop=["']iataCode["'][^>]*content=["']([^"']+)["']/gi)]
    .map(m => m[1].trim().toUpperCase());

  if (iataCodes.length === 0) return null;

  // First iataCode is airline, second is departure airport, third is arrival airport
  const airlineCode = iataCodes[0];
  const dep = iataCodes[1] && ALL_AIRPORTS.has(iataCodes[1]) ? iataCodes[1] : null;
  const arr = iataCodes[2] && ALL_AIRPORTS.has(iataCodes[2]) ? iataCodes[2] : null;

  if (!AIRLINE_MAP[airlineCode]) return null;

  const rawFlightNum = getMeta("flightNumber");
  if (!rawFlightNum) return null;

  const flightNumber = `${airlineCode}${rawFlightNum.padStart(4, "0")}`;

  const depTime = getMeta("departureTime");
  let date: string | null = null;
  if (depTime) {
    const d = new Date(depTime);
    if (!isNaN(d.getTime())) date = d.toISOString().split("T")[0];
  }

  return {
    flightNumber,
    airline: AIRLINE_MAP[airlineCode],
    dep,
    arr,
    date,
  };
}

// ─── STRATEGY 2: JSON-LD ─────────────────────────────────────────────────────
// Some airlines do use JSON-LD, keep as backup

function extractFromJsonLd(html: string): ParsedFlight[] {
  const flights: ParsedFlight[] = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const json = JSON.parse(match[1].trim());
      const items = Array.isArray(json) ? json : [json];
      for (const item of items) {
        const nodes = item["@graph"] ? item["@graph"] : [item];
        for (const node of nodes) {
          const f = parseJsonLdNode(node);
          if (f) flights.push(f);
        }
      }
    } catch { /* skip */ }
  }
  return flights;
}

function parseJsonLdNode(node: any): ParsedFlight | null {
  if (!node || typeof node !== "object") return null;
  const reservationFor = node.reservationFor ?? node;
  const flight = node["@type"] === "Flight" ? node : reservationFor;
  if (!flight) return null;

  const rawNum = flight.flightNumber ?? "";
  const airlineObj = flight.airline ?? flight.operatingAirline ?? {};
  const iataCode = (airlineObj.iataCode ?? "").toUpperCase();
  if (!rawNum || !iataCode || !AIRLINE_MAP[iataCode]) return null;

  const flightNumber = `${iataCode}${String(rawNum).padStart(4, "0")}`;
  const dep = (flight.departureAirport?.iataCode ?? "").toUpperCase() || null;
  const arr = (flight.arrivalAirport?.iataCode ?? "").toUpperCase() || null;

  let date: string | null = null;
  const depTime = flight.departureTime ?? "";
  if (depTime) {
    const d = new Date(depTime);
    if (!isNaN(d.getTime())) date = d.toISOString().split("T")[0];
  }

  return {
    flightNumber,
    airline: AIRLINE_MAP[iataCode],
    dep: dep && ALL_AIRPORTS.has(dep) ? dep : null,
    arr: arr && ALL_AIRPORTS.has(arr) ? arr : null,
    date,
  };
}

// ─── STRATEGY 3: REGEX FALLBACK ──────────────────────────────────────────────
// For KLM check-in emails which have no structured data at all

function extractFromRegex(text: string, from: string): ParsedFlight | null {
  // Extract flight number
  const fnMatch = text.match(/\b([A-Z]{2})(\d{3,4})\b/);
  if (!fnMatch || !AIRLINE_MAP[fnMatch[1]]) return null;
  const flightNumber = fnMatch[1] + fnMatch[2];
  const airlineCode = fnMatch[1];

  // Extract route — look for "City (IATA)" pattern first (KLM uses this)
  const cityIataPattern = /([A-Z][a-zA-Z\s]+)\s*\(([A-Z]{3})\)/g;
  const routeCodes: string[] = [];
  for (const m of text.matchAll(cityIataPattern)) {
    const code = m[2].toUpperCase();
    if (ALL_AIRPORTS.has(code)) routeCodes.push(code);
  }

  let dep: string | null = routeCodes[0] ?? null;
  let arr: string | null = routeCodes[1] ?? null;

  // If no city(IATA) pattern, try bare IATA codes
  if (!dep || !arr) {
    const codes = [...text.matchAll(/\b([A-Z]{3})\b/g)]
      .map(m => m[1])
      .filter(c => ALL_AIRPORTS.has(c));
    const unique = [...new Set(codes)];
    dep = dep ?? unique[0] ?? null;
    arr = arr ?? unique[1] ?? null;
  }

  // Extract date
  const date = extractDate(text);

  const airline = guessAirlineFromSender(from) || AIRLINE_MAP[airlineCode] || airlineCode;

  if (!date) return null;

  return { flightNumber, airline, dep, arr, date };
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
  // KLM specific: "Thu 28 May 26" (short year)
  const p5 = /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{2})\b/gi;

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
  while ((m = p5.exec(text))) {
    // "Thu 28 May 26" → 2026-05-28
    const day = m[1].padStart(2,"0");
    const mo = MONTHS[m[2].toLowerCase()] || "01";
    const yr = parseInt(m[3]) >= 50 ? `19${m[3]}` : `20${m[3]}`;
    if (parseInt(yr) >= 2020 && parseInt(yr) <= 2027) candidates.push(`${yr}-${mo}-${day}`);
  }

  const valid = candidates.filter(d => !isNaN(new Date(d).getTime()));
  if (valid.length === 0) return null;
  valid.sort();
  return valid[0];
}

function guessAirlineFromSender(from: string): string | null {
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

    // flightMap key = "FLIGHTNUM-DATE" — no duplicates
    const flightMap = new Map<string, any>();

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

        // Skip noise emails
        const subj = subject.toLowerCase();
        if (["survey","newsletter","unsubscribe","miles earned","points earned",
             "feedback","satisfaction"].some(w => subj.includes(w))) continue;

        const htmlParts = getHtmlParts(full.payload);
        const fullHtml  = htmlParts.join("\n");
        const plainText = getPlainText(full.payload);
        const allText   = subject + "\n" + plainText + "\n" + fullHtml.replace(/<[^>]+>/g, " ");

        let parsedFlights: ParsedFlight[] = [];

        // Strategy 1: microdata (Iberia, United, Turkish)
        if (fullHtml.includes("itemprop") && fullHtml.includes("FlightReservation")) {
          parsedFlights = extractFromMicrodata(fullHtml);
        }

        // Strategy 2: JSON-LD
        if (parsedFlights.length === 0 && fullHtml.includes("application/ld+json")) {
          for (const html of htmlParts) {
            parsedFlights.push(...extractFromJsonLd(html));
          }
        }

        // Strategy 3: regex fallback (KLM check-in emails, others)
        if (parsedFlights.length === 0) {
          const f = extractFromRegex(allText, from);
          if (f) parsedFlights.push(f);
        }

        // Fix missing dates using email header date as fallback
        for (const pf of parsedFlights) {
          if (!pf.date) {
            const ed = new Date(dateHdr);
            if (!isNaN(ed.getTime())) pf.date = ed.toISOString().split("T")[0];
          }
        }

        // Add to map — dedup by FLIGHTNUM-DATE
        for (const pf of parsedFlights) {
          if (!pf.date || !pf.flightNumber) continue;
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
            const ex = flightMap.get(key);
            if (!ex.departure_airport && pf.dep) ex.departure_airport = pf.dep;
            if (!ex.arrival_airport && pf.arr) ex.arrival_airport = pf.arr;
          }
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
