import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { listFlights, scanGmail } from "@/lib/flights.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/dashboard/flights")({
  head: () => ({ meta: [{ title: "My Flights — Flew" }] }),
  component: FlightsPage,
});

function FlightsPage() {
  const qc = useQueryClient();
  const flightsFn = useServerFn(listFlights);
  const scanFn = useServerFn(scanGmail);
  const flights = useQuery({ queryKey: ["flights"], queryFn: () => flightsFn() });
  const scan = useMutation({
    mutationFn: () => scanFn(),
    onSuccess: (r) => { toast.success(`${r.inserted} new flights`); qc.invalidateQueries({ queryKey: ["flights"] }); },
  });

  return (
    <div className="p-10 max-w-6xl">
      <div className="flex items-end justify-between mb-10">
        <div>
          <div className="label mb-2">// My Flights</div>
          <h1 className="font-display text-6xl">All flights</h1>
        </div>
        <button onClick={() => scan.mutate()} disabled={scan.isPending} className="btn-acid">
          <RefreshCw className={`w-4 h-4 ${scan.isPending ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="card-surface overflow-hidden">
        <table className="w-full font-mono text-sm">
          <thead>
            <tr className="border-b border-border">
              <Th>Flight</Th><Th>Route</Th><Th>Date</Th><Th>Airline</Th><Th>Status</Th><Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {flights.data?.map((f: any) => (
              <tr key={f.id} className="border-b border-border hover:bg-surface-2">
                <Td><span className="font-bold">{f.flight_number}</span></Td>
                <Td>{f.departure_airport} <span className="text-acid">→</span> {f.arrival_airport}</Td>
                <Td>{f.departure_date}</Td>
                <Td>{f.airline}</Td>
                <Td><span className="label">{f.delay_status ?? "unknown"}</span></Td>
                <Td><button className="label text-acid hover:underline">Check delay →</button></Td>
              </tr>
            ))}
            {flights.data?.length === 0 && (
              <tr><td colSpan={6} className="p-12 text-center text-muted-foreground text-sm">No flights yet — hit refresh.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) { return <th className="text-left p-4 label">{children}</th>; }
function Td({ children }: { children: React.ReactNode }) { return <td className="p-4">{children}</td>; }
