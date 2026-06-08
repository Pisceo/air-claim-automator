import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Check, X, Plane, Mail, FileText, Upload } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Flew — Set it once. Get paid forever." },
      { name: "description", content: "Zero-touch EU261 flight compensation. Connect Gmail, we monitor every flight, file every claim, deposit every payout." },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* NAV */}
      <header className="border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-7 h-7 bg-acid flex items-center justify-center">
              <Plane className="w-4 h-4 text-background" strokeWidth={2.5} />
            </div>
            <span className="font-display text-2xl tracking-wide">FLEW</span>
          </Link>
          <nav className="hidden md:flex items-center gap-8 label">
            <a href="#how">How it works</a>
            <a href="#compare">Compare</a>
            <a href="#waitlist">Waitlist</a>
          </nav>
          <Link to="/auth" className="btn-acid">Sign in</Link>
        </div>
      </header>

      {/* HERO */}
      <section className="relative grid-bg border-b border-border overflow-hidden">
        <div className="max-w-7xl mx-auto px-6 py-24 md:py-32 grid md:grid-cols-2 gap-16 items-center">
          <div>
            <div className="label mb-6 flex items-center gap-3">
              <span className="w-2 h-2 bg-acid"></span>
              EU261 · Compensation Engine
            </div>
            <h1 className="font-display text-6xl md:text-8xl leading-[0.95] mb-6">
              Set it once.<br/>
              Get paid <span className="text-acid">forever.</span>
            </h1>
            <p className="text-muted-foreground text-lg max-w-md mb-10">
              Flew watches your inbox for delayed and cancelled flights, files every EU261 claim automatically, and deposits the cash. You don't lift a finger.
            </p>
            <div className="flex flex-wrap gap-4 items-center">
              <Link to="/auth" className="btn-acid">
                Connect Gmail & start <ArrowRight className="w-4 h-4" />
              </Link>
              <span className="label">15% fee · only if you win</span>
            </div>
          </div>

          {/* PHONE MOCKUP */}
          <div className="relative mx-auto">
            <div className="w-[300px] h-[600px] bg-[#0d0d0d] rounded-[40px] border border-border p-3 shadow-2xl">
              <div className="w-full h-full bg-background rounded-[32px] overflow-hidden relative border border-border">
                <div className="p-5 border-b border-border">
                  <div className="label">Flew · Dashboard</div>
                  <div className="font-display text-3xl mt-2">€1,200</div>
                  <div className="label text-acid">+€400 this week</div>
                </div>
                <div className="p-4 space-y-3">
                  <DemoNotif airline="Ryanair" route="MAD → STN" amount="+€250" status="WON" />
                  <DemoNotif airline="easyJet" route="AMS → BCN" amount="+€400" status="WON" />
                  <DemoNotif airline="Vueling" route="CDG → MAD" amount="Filed" status="FILED" />
                  <DemoNotif airline="Lufthansa" route="FRA → LHR" amount="+€600" status="WON" />
                  <DemoNotif airline="Iberia" route="MAD → AMS" amount="Monitoring" status="WATCH" />
                </div>
              </div>
            </div>
            <div className="absolute -bottom-4 -right-4 bg-acid text-background px-3 py-2 font-mono text-xs tracking-wider">
              LIVE
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-24">
          <div className="label mb-4">// How it works</div>
          <h2 className="font-display text-5xl md:text-6xl mb-16 max-w-2xl">Three steps. Then never again.</h2>
          <div className="grid md:grid-cols-3 gap-6">
            <Step n="01" icon={<Mail />} title="Connect Gmail" desc="One click. We scan your inbox for booking confirmations from every major EU carrier." />
            <Step n="02" icon={<Upload />} title="Upload passport + IBAN" desc="Once. Forever. We attach them to every claim, so airlines can't stall on paperwork." />
            <Step n="03" icon={<FileText />} title="We file everything" desc="Delays, cancellations, denied boarding. Filed within 24h. Escalated to court if needed." />
          </div>
        </div>
      </section>

      {/* COMPARE */}
      <section id="compare" className="border-b border-border bg-surface-2">
        <div className="max-w-7xl mx-auto px-6 py-24">
          <div className="label mb-4">// Compare</div>
          <h2 className="font-display text-5xl md:text-6xl mb-16 max-w-2xl">Flew is the only one that's actually automatic.</h2>

          <div className="overflow-x-auto">
            <table className="w-full border border-border">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-5 label">Feature</th>
                  <th className="p-5 label text-acid border-l border-border">Flew</th>
                  <th className="p-5 label border-l border-border">AirHelp</th>
                  <th className="p-5 label border-l border-border">DIY</th>
                </tr>
              </thead>
              <tbody className="font-mono text-sm">
                <Row label="Auto-detects delayed flights" v={[true, false, false]} />
                <Row label="Zero-touch filing" v={[true, false, false]} />
                <Row label="Fee" v={["15%", "35%", "0%"]} />
                <Row label="Documents uploaded once" v={[true, false, false]} />
                <Row label="Monitors future flights" v={[true, false, false]} />
                <Row label="Court escalation included" v={[true, true, false]} />
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* WAITLIST */}
      <section id="waitlist" className="border-b border-border">
        <div className="max-w-3xl mx-auto px-6 py-24 text-center">
          <div className="label mb-4">// Join the waitlist</div>
          <h2 className="font-display text-5xl md:text-7xl mb-6">
            Get the next <span className="text-acid">€600</span> back.
          </h2>
          <p className="text-muted-foreground mb-10">Sign in with Google. We'll start monitoring immediately.</p>
          <Link to="/auth" className="btn-acid">
            Connect Gmail & start <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="max-w-7xl mx-auto px-6 py-8 flex justify-between items-center label">
          <span>© Flew · EU261/2004</span>
          <span>Built for the long haul</span>
        </div>
      </footer>
    </div>
  );
}

function DemoNotif({ airline, route, amount, status }: { airline: string; route: string; amount: string; status: string }) {
  const color = status === "WON" ? "text-acid" : status === "FILED" ? "text-foreground" : "text-muted-foreground";
  return (
    <div className="card-surface p-3">
      <div className="flex justify-between items-start">
        <div>
          <div className="label">{airline}</div>
          <div className="font-mono text-sm mt-1">{route}</div>
        </div>
        <div className="text-right">
          <div className={`font-mono text-sm ${color}`}>{amount}</div>
          <div className="label mt-1">{status}</div>
        </div>
      </div>
    </div>
  );
}

function Step({ n, icon, title, desc }: { n: string; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="card-surface p-8 relative">
      <div className="font-display text-6xl text-muted-foreground/30 absolute top-4 right-6">{n}</div>
      <div className="w-10 h-10 bg-acid text-background flex items-center justify-center mb-6">
        <div className="w-5 h-5">{icon}</div>
      </div>
      <h3 className="font-display text-3xl mb-3">{title}</h3>
      <p className="text-muted-foreground text-sm">{desc}</p>
    </div>
  );
}

function Row({ label, v }: { label: string; v: (boolean | string)[] }) {
  const render = (val: boolean | string, isFlew: boolean) => {
    if (typeof val === "boolean") {
      return val ? <Check className={`w-5 h-5 mx-auto ${isFlew ? "text-acid" : "text-foreground"}`} /> : <X className="w-5 h-5 mx-auto text-muted-foreground" />;
    }
    return <span className={isFlew ? "text-acid font-bold" : "text-foreground"}>{val}</span>;
  };
  return (
    <tr className="border-b border-border">
      <td className="p-5">{label}</td>
      <td className="p-5 text-center border-l border-border bg-acid/5">{render(v[0], true)}</td>
      <td className="p-5 text-center border-l border-border">{render(v[1], false)}</td>
      <td className="p-5 text-center border-l border-border">{render(v[2], false)}</td>
    </tr>
  );
}
