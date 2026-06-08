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
    let cancelled = false;

    async function completeOAuthRedirect() {
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const searchParams = new URLSearchParams(window.location.search);
      const oauthError = hashParams.get("error") ?? searchParams.get("error");
      const accessToken = hashParams.get("access_token") ?? searchParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token") ?? searchParams.get("refresh_token");

      if (oauthError) {
        const description = hashParams.get("error_description") ?? searchParams.get("error_description") ?? oauthError;
        window.history.replaceState(null, "", window.location.pathname);
        toast.error("Sign-in failed", { description });
        return;
      }

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        window.history.replaceState(null, "", window.location.pathname);
        if (error) {
          toast.error("Sign-in failed", { description: error.message });
          return;
        }
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: profile } = await (supabase as any).from("profiles").select("onboarding_complete").eq("id", user.id).maybeSingle();
          if (!cancelled) navigate({ to: profile?.onboarding_complete ? "/dashboard" : "/onboarding" });
        }
        return;
      }

      const { data } = await supabase.auth.getSession();
      if (!cancelled && data.session) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: profile } = await (supabase as any).from("profiles").select("onboarding_complete").eq("id", user.id).maybeSingle();
          if (!cancelled) navigate({ to: profile?.onboarding_complete ? "/dashboard" : "/onboarding" });
        }
      }
    }

    completeOAuthRedirect();
    return () => { cancelled = true; };
  }, [navigate]);

  async function signIn() {
    setLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: "https://air-claim-automator.lovable.app/auth",
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
