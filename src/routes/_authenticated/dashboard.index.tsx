import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Plane, RefreshCw, Inbox } from "lucide-react";
import { listFlights, listClaims, scanGmail } from "@/lib/flights.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/dashboard/")({
  head: () => ({ meta: [{ title: "Dashboard — Flew" }] }),
  component: DashboardHome,
});

function DashboardHome() {
  const qc = useQueryClient();
  const flightsFn = useServerFn(listFlights);
  const claimsFn = useServerFn(listClaims);
  const scanFn = useServerFn(scanGmail);

  const flights = useQuery({
    queryKey: ["flights"],
    queryFn: () => flightsFn(),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const claims = useQuery({
    queryKey: ["claims"],
    queryFn: () => claimsFn(),
    staleTime: 0,
  });

  const scan = useMutation({
    mutationFn: () => scanFn(),
    onSuccess: async (r: any) => {
      if (r?.error) {
        toast.error("Scan issue", { description: r.error });
      } else {
        toast.success("Inbox scanned", { description: JSON.stringify(r.debug?.threadSubjects?.slice(0, 5)) });
console.log("SCAN DEBUG:", JSON.stringify(r.debug, null, 2));
      }
      // Wait for DB write to complete then force fresh fetch
      await new Promise(resolve => setTimeout(resolve, 1500));
      qc.removeQueries({ queryKey: ["flights"] });
      qc.removeQueries({ queryKey: ["claims"] });
      await qc.fetchQuery({ queryKey: ["flights"], queryFn: () => flightsFn(), staleTime: 0 });
    },
    onError: (e: any) => toast.error("Scan failed", { description: e.message }),
  });

  useEffect(() => {
    if (flights.data && flights.data.length === 0 && !scan.isPending && !scan.isSuccess) {
      scan.mutate();
    }
  }, [flights.data]);

  const totalEarned = (claims.data ?? [])
    .filter((c: any) => c.status === "won")
    .reduce((s: number, c: any) => s + (c.amount_eur ?? 0), 0);
  const wonCount = (claims.data ?? []).filter((c: any) => c.status === "won").length;

  return (
    <div className="p-10 max-w-6xl">
      <div className="flex items-end justify-between mb-10">
        <div>
          <div className="label mb-2">// Dashboard</div>
          <h1 className="font-display text-6xl">Overview</h1>
        </div>
        <button onClick={() => scan.mutate()} disabled={scan.isPending} className="btn-acid">
          <RefreshCw className={`w-4 h-4 ${scan.isPending ? "animate-spin" : ""}`} />
          {scan.isPending ? "Scanning..." : "Scan inbox"}
        </button>
      </div>

      <div className="grid md:grid-cols-3 gap-6 mb-12">
        <Stat label="Total earned" value={`€${totalEarned.toLocaleString()}`} accent />
        <Stat label="Claims won" value={String(wonCount)} />
        <Stat label="Flights monitored" value={String(flights.data?.length ?? 0)} />
      </div>

      <section className="mb-12">
        <div className="flex items-baseline justify-between mb-6">
          <h2 className="font-display text-3xl">Monitored flights</h2>
          <span className="label">{flights.data?.length ?? 0} total</span>
        </div>
        {flights.isLoading || scan.isPending ? (
          <div className="card-surface p-12 text-center">
            <RefreshCw className="w-8 h-8 mx-auto mb-4 text-muted-foreground animate-spin" />
            <div className="label">{scan.isPending ? "Scanning Gmail..." : "Loading flights..."}</div>
          </div>
        ) : (flights.data?.length ?? 0) === 0 ? (
          <EmptyState icon={<Plane />} title="No flights detected yet" desc="Click 'Scan inbox' to fetch booking confirmations from Gmail." />
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {flights.data?.map((f: any) => <FlightCard key={f.id} flight={f} />)}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-display text-3xl mb-6">Recent notifications</h2>
        <EmptyState icon={<Inbox />} title="No claims yet" desc="We're watching your flights. We'll notify you the moment something is delayed or cancelled." />
      </section>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="card-surface p-6">
      <div className="label mb-3">{label}</div>
      <div className={`font-display text-5xl ${accent ? "text-acid" : ""}`}>{value}</div>
    </div>
  );
}

export function FlightCard({ flight }: { flight: any }) {
  return (
    <div className="card-surface p-5">
      <div className="flex justify-between items-start">
        <div>
          <div className="label">{flight.airline}</div>
          <div className="font-mono text-lg mt-1">{flight.flight_number}</div>
        </div>
        <span className="label">
  {flight.departure_date
    ? new Date(flight.departure_date + "T12:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    : "—"}
      </span>
      </div>
      <div className="mt-4 flex items-center gap-3 font-display text-3xl">
        <span>{flight.departure_airport ?? "?"}</span>
        <span className="text-acid">→</span>
        <span>{flight.arrival_airport ?? "?"}</span>
      </div>
      <div className="mt-4 flex justify-between items-center">
        <span className="label">Status: {flight.delay_status ?? "unknown"}</span>
        <button className="label text-acid hover:underline">Check delay →</button>
      </div>
    </div>
  );
}

function EmptyState({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="card-surface p-12 text-center">
      <div className="w-12 h-12 mx-auto mb-4 text-muted-foreground">{icon}</div>
      <div className="font-display text-2xl mb-2">{title}</div>
      <div className="text-muted-foreground text-sm max-w-md mx-auto">{desc}</div>
    </div>
  );
}
