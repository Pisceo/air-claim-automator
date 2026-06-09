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

// ─── GMAIL BATCH ─────────────────────────────────────────────────────────────
// Pack multiple Gmail API calls into one fetch() = 1 Cloudflare subrequest

async function gmailBatch(
  requests: { id: string; path: string }[],
  token: string
): Promise<Map<string, any>> {
  const boundary = "flew_" + Math.random().toString(36).slice(2);
  const body = requests.map(r =>
    `--${boundary}\r\nContent-Type: application/http\r\nContent-ID: <${r.id}>\r\n\r\nGET ${r.path}\r\n`
  ).join("") + `--${boundary}--`;

  const res = await fetch("https://gmail.googleapis.com/batch/gmail/v1", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": `multipart/mixed; boundary=${boundary}`,
    },
    body,
  });

  if (!res.ok) {
    console.error("Batch failed:", res.status, await res.text());
    return new Map();
  }

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

// JSON-LD parser
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

// Microdata parser
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

function parseFlightsFromPayload(payload: any): ParsedFlight[] {
  const html = getHtml(payload);
  if (!html) return [];
  // Try JSON-LD first, then microdata
  if (html.includes("application/ld+json")) {
    const r = extractJsonLd(html);
    if (r.length) return r;
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

    // Subrequest 1: list threads
    const threadsRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads?q=${encodeURIComponent("category:reservations newer_than:1095d")}&maxResults=40`,
      { headers: { Authorization: `Bearer ${googleToken}` } }
    );
    if (!threadsRes.ok) {
      if (threadsRes.status === 401) return { detected: 0, inserted: 0, error: "Gmail token expired — sign out and back in" };
      return { detected: 0, inserted: 0, error: `Gmail error ${threadsRes.status}` };
    }
    const threads: any[] = (await threadsRes.json()).threads ?? [];
    if (!threads.length) return { detected: 0, inserted: 0, error: "No reservation emails found in Gmail" };

    // Subrequest 2: batch get metadata for ALL threads
    const metaBatch = await gmailBatch(
      threads.map(t => ({
        id: t.id,
        path: `/gmail/v1/users/me/threads/${t.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
      })),
      googleToken
    );

    // For each thread, collect ALL message IDs (not just first)
    // We'll try first message, but fall back to others if no structured data
    const SKIP = ["hotel", "car hire", "car rental", "restaurant", "train", "bus", "ferry", "cruise"];
    const threadMessageIds: { threadId: string; messageIds: string[] }[] = [];

    for (const thread of threads) {
      const td = metaBatch.get(thread.id);
      if (!td?.messages?.length) continue;
      const subjectHeader = td.messages[0].payload?.headers?.find((h: any) => h.name === "Subject");
      const subject = (subjectHeader?.value ?? "").toLowerCase();
      if (SKIP.some(w => subject.includes(w))) continue;
      // Collect up to 3 message IDs per thread (first booking email + maybe a second format)
      const ids = td.messages.slice(0, 3).map((m: any) => m.id);
      threadMessageIds.push({ threadId: thread.id, messageIds: ids });
    }

    if (!threadMessageIds.length) return { detected: threads.length, inserted: 0, error: "No flight threads found" };

    // Subrequest 3: batch fetch full content of first message of each thread
    const allFirstIds = threadMessageIds.map(t => t.messageIds[0]);
    const firstBatch = await gmailBatch(
      allFirstIds.map(id => ({ id, path: `/gmail/v1/users/me/messages/${id}?format=full` })),
      googleToken
    );

    // Parse flights from first messages
    const flightMap = new Map<string, ParsedFlight>();
    const threadsNeedingFallback: string[] = [];
    const parseDebug: string[] = [];

    for (const { threadId, messageIds } of threadMessageIds) {
      const msgData = firstBatch.get(messageIds[0]);
      if (!msgData?.payload) { parseDebug.push(`${messageIds[0]}: NO PAYLOAD`); continue; }
      const html = getHtml(msgData.payload);
      const hasJsonLd = html.includes("application/ld+json");
      const hasMicrodata = html.includes("FlightReservation");
      const hasWidget = html.includes("itemprop");
      const flights = parseFlightsFromPayload(msgData.payload);
      const subj = metaBatch.get(threadId)?.messages?.[0]?.payload?.headers?.find((h: any) => h.name === "Subject")?.value ?? "?";
      parseDebug.push(`${subj.slice(0,40)} | jsonld:${hasJsonLd} micro:${hasMicrodata} itemprop:${hasWidget} flights:${flights.length}`);
      if (flights.length === 0 && messageIds.length > 1) {
        threadsNeedingFallback.push(...messageIds.slice(1));
        continue;
      }
      for (const f of flights) {
        if (!f.flight_number) continue;
        const key = `${f.flight_number}-${f.departure_date ?? "nodate"}`;
        if (!flightMap.has(key)) flightMap.set(key, f);
        else {
          const ex = flightMap.get(key)!;
          if (!ex.departure_airport && f.departure_airport) ex.departure_airport = f.departure_airport;
          if (!ex.arrival_airport   && f.arrival_airport)   ex.arrival_airport   = f.arrival_airport;
        }
      }
    }

    // Subrequest 4 (optional): batch fetch fallback messages for threads with no data
    if (threadsNeedingFallback.length > 0) {
      const fallbackBatch = await gmailBatch(
        threadsNeedingFallback.slice(0, 40).map(id => ({
          id,
          path: `/gmail/v1/users/me/messages/${id}?format=full`,
        })),
        googleToken
      );
      for (const [, msgData] of fallbackBatch) {
        if (!msgData?.payload) continue;
        const flights = parseFlightsFromPayload(msgData.payload);
        for (const f of flights) {
          if (!f.flight_number) continue;
          const key = `${f.flight_number}-${f.departure_date ?? "nodate"}`;
          if (!flightMap.has(key)) flightMap.set(key, f);
          else {
            const ex = flightMap.get(key)!;
            if (!ex.departure_airport && f.departure_airport) ex.departure_airport = f.departure_airport;
            if (!ex.arrival_airport   && f.arrival_airport)   ex.arrival_airport   = f.arrival_airport;
          }
        }
      }
    }

    if (!flightMap.size) {
      return { detected: threads.length, inserted: 0, error: "No structured flight data found in reservation emails" };
    }

    const toInsert = [...flightMap.values()].map(f => ({
      user_id:           userId,
      flight_number:     f.flight_number,
      airline:           f.airline,
      departure_airport: f.departure_airport,
      arrival_airport:   f.arrival_airport,
      departure_date:    f.departure_date,
    }));

    // Use the SECURITY DEFINER function to bypass RLS
    // This is safe — the function is scoped to the user_id we pass in
    const { error: rpcErr } = await (supabase as any).rpc("upsert_flights", {
      p_flights: toInsert,
    });

    return {
      detected: threads.length,
      parsed: toInsert.length,
      inserted: toInsert.length,
      error: rpcErr?.message ?? null,
      debug: {
        parseDebug,
        threadSubjects: [...metaBatch.entries()].slice(0, 40).map(([id, td]) => {
          const subj = td?.messages?.[0]?.payload?.headers?.find((h: any) => h.name === "Subject")?.value ?? "NO SUBJECT";
          const from = td?.messages?.[0]?.payload?.headers?.find((h: any) => h.name === "From")?.value ?? "NO FROM";
          const msgCount = td?.messages?.length ?? 0;
          return `${subj} | FROM: ${from} | MSGS: ${msgCount}`;
        }),
        threadsWithNoStructuredData: threadsNeedingFallback.length,
        flightMapKeys: [...flightMap.keys()],
      },
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
