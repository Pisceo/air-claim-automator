import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

function getHtml(payload: any, depth = 0): string {
  if (depth > 4) return "";
  let html = "";
  if (payload?.mimeType === "text/html" && payload?.body?.data) {
    try { html += base64Decode(payload.body.data); } catch { /* skip */ }
  }
  if (payload?.parts) {
    for (const p of payload.parts) {
      if (p.mimeType === "text/html" && p.body?.data) {
        try { html += base64Decode(p.body.data); } catch { /* skip */ }
      } else if (p.mimeType?.startsWith("multipart/")) {
        html += getHtml(p, depth + 1);
      }
    }
  }
  return html;
}

function normalizeFlightNumber(fn: string): string {
  const clean = fn.toUpperCase().replace(/\s+/g, "");
  const match = clean.match(/^([A-Z]{2,3})0*(\d+)$/);
  if (match) {
    return `${match[1]}${match[2]}`;
  }
  return clean;
}

function extractDateFromText(text: string, defaultYear: string): string | null {
  let m = text.match(/\b(202[3-9])[-/](1[0-2]|0?[1-9])[-/](3[01]|[12]\d|0?[1-9])\b/);
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;

  m = text.match(/\b(3[01]|[12]\d|0?[1-9])[-/](1[0-2]|0?[1-9])[-/](202[3-9])\b/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;

  const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const monthRegex = months.join("|");
  const ddmmyyyy = new RegExp(`\\b(3[01]|[12]\\d|0?[1-9])\\s+(${monthRegex})[A-Z]*\\s*(202[3-9])?\\b`, 'i');
  m = text.match(ddmmyyyy);
  if (m) {
    const day = m[1].padStart(2, '0');
    const monthIdx = months.indexOf(m[2].toUpperCase()) + 1;
    const month = monthIdx.toString().padStart(2, '0');
    const year = m[3] || defaultYear;
    return `${year}-${month}-${day}`;
  }

  return null;
}

// ─── GMAIL BATCH ─────────────────────────────────────────────────────────────

async function gmailBatch(requests: { id: string; path: string }[], token: string): Promise<Map<string, any>> {
  const boundary = "flew_" + Math.random().toString(36).slice(2);
  const body = requests.map(r => `--${boundary}\r\nContent-Type: application/http\r\nContent-ID: <${r.id}>\r\n\r\nGET ${r.path}\r\n`).join("") + `--${boundary}--`;

  const res = await fetch("https://gmail.googleapis.com/batch/gmail/v1", {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": `multipart/mixed; boundary=${boundary}` },
    body,
  });

  if (!res.ok) return new Map();

  const text = await res.text();
  const results = new Map<string, any>();
  const parts = text.split(/--[^\r\n]+\r\n/).slice(1);

  for (const part of parts) {
    if (!part || part.trim() === "--") continue;
    try {
      const idMatch = part.match(/Content-ID:\s*<response-([^>]+)>/i);
      if (!idMatch) continue;
      const jsonStart = part.indexOf("\r\n\r\n", part.indexOf("HTTP/1.1"));
      if (jsonStart === -1) continue;
      const jsonStr = part.slice(jsonStart).trim();
      if (!jsonStr || jsonStr.startsWith("--")) continue;
      results.set(idMatch[1], JSON.parse(jsonStr));
    } catch { continue; }
  }
  return results;
}

// ─── STRUCTURED DATA PARSERS ─────────────────────────────────────────────────

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

const VALID_IATA_CODES = new Set([
  "MAD", "AMS", "STN", "LHR", "LGW", "BGY", "IST", "BRU", "CDG", "FRA", "MUC", "BCN", 
  "FCO", "MXP", "ATH", "LIS", "VIE", "CPH", "OSL", "ARN", "HEL", "DUB", "ZRH", "GVA", 
  "WAW", "PRG", "BUD", "OTP", "PMI", "AGP", "ALC", "VLC", "SVQ", "BIO", "EDI", "MAN",
  "JFK", "IAH", "SAL", "EWR", "ORD", "LAX", "SFO", "MIA", "BOS", "IAD", "YYZ", "YVR", 
  "MEX", "BOG", "GRU", "EZE", "SCL", "LIM", "PTY", "ATL", "DFW", "DEN", "SEA", "MSY",
  "HKG", "DOH", "DXB", "NRT", "HND", "ICN", "PEK", "PVG", "SIN", "BKK", "KUL", "CGK", 
  "SYD", "MEL", "AKL", "DEL", "BOM", "AUH", "JED", "RUH",
  "JNB", "CPT", "CAI", "CMN", "ADD", "NBO"
]);

// Global city mapper to instantly extract routes from high-confidence subject lines
const CITY_TO_IATA: Record<string, string> = {
  "MADRID": "MAD", "AMSTERDAM": "AMS", "STANSTED": "STN", "LONDON": "STN",
  "HONG KONG": "HKG", "HONGKONG": "HKG", "ISTANBUL": "IST", "BRUSSELS": "BRU", 
  "HOUSTON": "IAH", "SAN SALVADOR": "SAL", "NEW ORLEANS": "MSY", "DOHA": "DOH"
};

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
            if (Array.isArray(res?.subReservation)) {
              for (const sub of res.subReservation) {
                const sf = parseJsonLdNode(sub);
                if (sf) results.push(sf);
              }
            }
          }
        }
      }
    } catch { /* skip */ }
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

function extractMicrodata(html: string): ParsedFlight[] {
  const results: ParsedFlight[] = [];
  for (const open of html.matchAll(/<[^>]+itemtype=["'][^"']*FlightReservation["'][^>]*>/gi)) {
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

  const seen = new Set<string>();
  const codes = [
    ...block.matchAll(/itemprop=["']iataCode["'][^>]*content=["']([A-Z]{2,3})["']/gi),
    ...block.matchAll(/content=["']([A-Z]{2,3})["'][^>]*itemprop=["']iataCode["']/gi),
  ].map(m => m[1].toUpperCase()).filter(c => { if (seen.has(c)) return false; seen.add(c); return true; });

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

// ─── UNIVERSAL PARSER ────────────────────────────────────────────────────────

function parseFlightsFromPayload(payload: any, subject: string = "", fallbackDate: string | null = null): ParsedFlight[] {
  const html = getHtml(payload);
  if (!html) return [];
  
  let flights: ParsedFlight[] = [];
  
  if (html.includes("application/ld+json")) flights = flights.concat(extractJsonLd(html));
  if (html.includes("FlightReservation")) flights = flights.concat(extractMicrodata(html));

  let rawTextOriginal = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
                            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
                            .replace(/<[^>]+>/g, ' ');
  
  const subjectUpper = subject.toUpperCase();
  const combinedText = `${subjectUpper} ${rawTextOriginal}`;
  const defaultYear = fallbackDate ? fallbackDate.substring(0, 4) : "2026";

  // Phase 1: Scan the subject line for high-confidence explicit city routes
  const subjectAirports: string[] = [];
  for (const [city, code] of Object.entries(CITY_TO_IATA)) {
    if (subjectUpper.includes(city)) {
      subjectAirports.push(code);
    }
  }

  // If structured data exists, patch missing holes using high-confidence subject maps
  if (flights.length > 0) {
    for (const f of flights) {
      if (!f.departure_airport && subjectAirports[0]) f.departure_airport = subjectAirports[0];
      if (!f.arrival_airport && subjectAirports[1]) f.arrival_airport = subjectAirports[1];
      
      if (!f.departure_airport || !f.arrival_airport) {
        const globalAirports = [...combinedText.matchAll(/\b([A-Z]{3})\b/g)]
          .map(m => m[1].toUpperCase()).filter(code => VALID_IATA_CODES.has(code));
        if (globalAirports.length > 0) {
          if (!f.departure_airport) f.departure_airport = globalAirports[0];
          if (!f.arrival_airport && globalAirports.length > 1) f.arrival_airport = globalAirports[1];
        }
      }
      if (!f.departure_date) {
        f.departure_date = extractDateFromText(combinedText.toUpperCase(), defaultYear) || fallbackDate;
      }
    }
    return flights;
  }

  // Phase 2: Text Fallback Path (KLM, EasyJet, etc.)
  const validCodes = Object.keys(AIRLINE_NAMES).join('|');
  const flightRegex = new RegExp(`\\b(${validCodes})\\s*(\\d{2,4})\\b`, 'gi');
  const flightMatches = [...combinedText.matchAll(flightRegex)];

  if (flightMatches.length > 0) {
    const uniqueFlights = new Map<string, ParsedFlight>();
    
    // Scan the entire document for valid uppercase IATA codes up front
    const allBodyAirports = [...rawTextOriginal.matchAll(/\b([A-Z]{3})\b/g)]
      .map(m => m[1].toUpperCase())
      .filter(code => VALID_IATA_CODES.has(code) && code !== "SEA"); // Hard block conversational acronym leaks

    for (const m of flightMatches) {
      const iata = m[1].toUpperCase();
      const num = m[2];
      const flightNumber = `${iata}${num}`;

      // Set baseline target airports using high-confidence subject line routing map
      let dep = subjectAirports[0] || null;
      let arr = subjectAirports[1] || null;

      // If subject line is blind, scan local proximity chunk windows
      const chunk = combinedText.substring(Math.max(0, m.index! - 200), Math.min(combinedText.length, m.index! + 200));
      let localAirports = [...chunk.matchAll(/\b([A-Z]{3})\b/g)]
        .map(a => a[1].toUpperCase())
        .filter(code => VALID_IATA_CODES.has(code) && code !== "SEA");

      if (!dep && localAirports[0]) dep = localAirports[0];
      if (!arr && localAirports.length > 1) arr = localAirports.find(a => a !== dep) || null;

      // If proximity chunk is blind (KLM open-table rows), scale out to the entire text block assets
      if ((!dep || !arr) && flightMatches.length === 1) {
        if (!dep && allBodyAirports[0]) dep = allBodyAirports[0];
        if (!arr && allBodyAirports.length > 1) arr = allBodyAirports.find(a => a !== dep) || null;
      }

      let flightDate = extractDateFromText(chunk.toUpperCase(), defaultYear);
      if (!flightDate) flightDate = extractDateFromText(combinedText.toUpperCase(), defaultYear);
      if (!flightDate) flightDate = fallbackDate;

      // Ensure we have a valid structural definition before building database entries
      if (dep && arr && flightDate) {
        if (!uniqueFlights.has(flightNumber)) {
           uniqueFlights.set(flightNumber, {
             flight_number: flightNumber,
             airline: AIRLINE_NAMES[iata] || iata,
             departure_airport: dep,
             arrival_airport: arr,
             departure_date: flightDate
           });
        }
      }
    }
    return Array.from(uniqueFlights.values());
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

    const threadsRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads?q=${encodeURIComponent("category:reservations newer_than:1095d")}&maxResults=85`,
      { headers: { Authorization: `Bearer ${googleToken}` } }
    );
    if (!threadsRes.ok) {
      return { detected: 0, inserted: 0, error: `Gmail error ${threadsRes.status}` };
    }
    const threads: any[] = (await threadsRes.json()).threads ?? [];
    if (!threads.length) return { detected: 0, inserted: 0, error: "No reservation emails found in Gmail" };

    const metaBatch = await gmailBatch(
      threads.map(t => ({
        id: t.id,
        path: `/gmail/v1/users/me/threads/${t.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
      })),
      googleToken
    );

    const SKIP = ["hotel", "car hire", "car rental", "restaurant", "train", "bus", "ferry", "cruise"];
    const threadMessageIds: { threadId: string; messageIds: string[] }[] = [];

    for (const thread of threads) {
      const td = metaBatch.get(thread.id);
      if (!td?.messages?.length) continue;
      const subjectHeader = td.messages[0].payload?.headers?.find((h: any) => h.name === "Subject");
      const subject = (subjectHeader?.value ?? "").toLowerCase();
      if (SKIP.some(w => subject.includes(w))) continue;
      
      const ids = td.messages.slice(0, 3).map((m: any) => m.id);
      threadMessageIds.push({ threadId: thread.id, messageIds: ids });
    }

    if (!threadMessageIds.length) return { detected: threads.length, inserted: 0, error: "No flight threads found" };

    const allFirstIds = threadMessageIds.map(t => t.messageIds[0]);
    const firstBatch = await gmailBatch(
      allFirstIds.map(id => ({ id, path: `/gmail/v1/users/me/messages/${id}?format=full` })),
      googleToken
    );

    const flightMap = new Map<string, ParsedFlight>();
    const threadsNeedingFallback: string[] = [];

    for (const { threadId, messageIds } of threadMessageIds) {
      const msgData = firstBatch.get(messageIds[0]);
      if (!msgData?.payload) continue;
      
      const td = metaBatch.get(threadId);
      const subject = td?.messages?.[0]?.payload?.headers?.find((h: any) => h.name === "Subject")?.value ?? "?";
      let fallbackDate: string | null = null;
      if (msgData.internalDate) {
        fallbackDate = new Date(parseInt(msgData.internalDate)).toISOString().split("T")[0];
      }
      
      const flights = parseFlightsFromPayload(msgData.payload, subject, fallbackDate);
      
      if (flights.length === 0 && messageIds.length > 1) {
        threadsNeedingFallback.push(...messageIds.slice(1));
        continue;
      }
      
      for (const f of flights) {
        if (!f.flight_number || !f.departure_date) continue;
        
        const cleanFlight = normalizeFlightNumber(f.flight_number);
        const key = `${cleanFlight}-${f.departure_date}`;
        
        if (!flightMap.has(key)) {
          f.flight_number = cleanFlight;
          flightMap.set(key, f);
        } else {
          const ex = flightMap.get(key)!;
          if (!ex.departure_airport && f.departure_airport) ex.departure_airport = f.departure_airport;
          if (!ex.arrival_airport && f.arrival_airport) ex.arrival_airport = f.arrival_airport;
          if (!ex.airline && f.airline) ex.airline = f.airline;
        }
      }
    }

    const validFlights = [...flightMap.values()];
    if (validFlights.length === 0) {
      return { detected: threads.length, inserted: 0, error: "No flights detected" };
    }

    const toInsert = validFlights.map(f => ({
      user_id:           userId,
      flight_number:     f.flight_number,
      airline:           f.airline,
      departure_airport: f.departure_airport,
      arrival_airport:   f.arrival_airport,
      departure_date:    f.departure_date,
    }));

    const { error: rpcErr } = await (supabase as any).rpc("upsert_flights", { p_flights: toInsert });

    return {
      detected: threads.length,
      parsed: toInsert.length,
      inserted: toInsert.length,
      error: rpcErr?.message ?? null,
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
    const { data, error } = await (supabase as any).from("flights").select("*").eq("user_id", userId).order("departure_date", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listClaims = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await (supabase as any).from("claims").select("*, flights(airline, flight_number, departure_airport, arrival_airport, departure_date)").eq("user_id", userId).order("filed_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await (supabase as any).from("profiles").select("*").eq("id", userId).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });
