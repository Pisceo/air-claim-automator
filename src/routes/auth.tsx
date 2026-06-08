import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plane, ArrowRight } from "lucide-react";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Sign in — Flew" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/onboarding" });
    });
  }, [navigate]);

  async function signIn() {
    setLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin + "/onboarding",
      extraParams: {
        scope: "openid email profile https://www.googleapis.com/auth/gmail.readonly",
        access_type: "offline",
        prompt: "consent",
      },
    });
    if (result.error) {
      toast.error("Sign-in failed", { description: String(result.error) });
      setLoading(false);
      return;
    }
    if (result.redirected) return;
    navigate({ to: "/onboarding" });
  }

  return (
    <div className="min-h-screen flex flex-col bg-background grid-bg">
      <header className="border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-7 h-7 bg-acid flex items-center justify-center">
              <Plane className="w-4 h-4 text-background" strokeWidth={2.5} />
            </div>
            <span className="font-display text-2xl">FLEW</span>
          </Link>
          <Link to="/" className="label">← Back</Link>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-md card-surface p-10">
          <div className="label mb-4">// Step 0 of 3</div>
          <h1 className="font-display text-5xl mb-3">Connect Gmail.</h1>
          <p className="text-muted-foreground mb-10 text-sm">
            We need read access to scan booking confirmations and delay notifications. We never send mail from your account.
          </p>

          <button onClick={signIn} disabled={loading} className="btn-acid w-full">
            {loading ? "Connecting..." : (<>Continue with Google <ArrowRight className="w-4 h-4" /></>)}
          </button>

          <div className="mt-8 pt-6 border-t border-border label leading-relaxed">
            By continuing you agree to Flew filing EU261 claims on your behalf. 15% success fee. No upfront cost.
          </div>
        </div>
      </main>
    </div>
  );
}
