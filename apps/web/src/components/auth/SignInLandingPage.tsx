import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  LockKeyhole,
  ShieldCheck,
  Zap,
  BarChart3,
} from "lucide-react";

type SignInLandingPageProps = {
  onSignIn: () => void;
  error: string | null;
};

const features = [
  {
    icon: Zap,
    title: "Real-time operations",
    description: "Instant updates keep every team member aligned.",
  },
  {
    icon: ShieldCheck,
    title: "SLA confidence",
    description: "Track deadlines and ownership with full visibility.",
  },
  {
    icon: BarChart3,
    title: "Enterprise analytics",
    description: "Deep insights across agents, teams, and time.",
  },
];

export function SignInLandingPage({ onSignIn, error }: SignInLandingPageProps) {
  const [isSigningIn, setIsSigningIn] = useState(false);

  const handleSignIn = () => {
    if (isSigningIn) return;
    setIsSigningIn(true);
    onSignIn();
  };

  return (
    <div
      className="flex min-h-screen w-full items-center justify-center px-4"
      style={{ background: "hsl(var(--background))" }}
    >
      {/* Background radial glow */}
      <div
        className="pointer-events-none fixed inset-0 overflow-hidden"
        aria-hidden="true"
      >
        <div
          className="absolute -top-40 left-1/2 -translate-x-1/2 w-[800px] h-[500px] rounded-full opacity-[0.07] blur-[80px]"
          style={{
            background:
              "radial-gradient(ellipse at center, hsl(var(--primary)) 0%, transparent 70%)",
          }}
        />
        <div
          className="absolute bottom-0 left-0 w-[400px] h-[400px] rounded-full opacity-[0.04] blur-[60px]"
          style={{ background: "hsl(217 91% 60%)" }}
        />
      </div>

      <div
        className="relative w-full max-w-[960px] overflow-hidden rounded-2xl border shadow-elevated animate-fade-in"
        style={{
          background: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
        }}
      >
        <div className="flex min-h-[580px]">
          {/* ── Left: Branding ── */}
          <aside
            className="relative hidden w-[44%] flex-col justify-between p-12 lg:flex overflow-hidden border-r"
            style={{
              background: "hsl(222 52% 7%)",
              borderColor: "hsl(var(--border))",
            }}
          >
            {/* Decorative grid */}
            <div
              className="pointer-events-none absolute inset-0"
              aria-hidden="true"
              style={{
                backgroundImage:
                  "radial-gradient(hsl(var(--primary) / 0.08) 1px, transparent 1px)",
                backgroundSize: "28px 28px",
              }}
            />
            {/* Glow spot */}
            <div
              className="pointer-events-none absolute -top-20 -right-20 w-80 h-80 rounded-full opacity-10 blur-[60px]"
              style={{ background: "hsl(var(--primary))" }}
              aria-hidden="true"
            />

            <div className="relative z-10">
              {/* Logo */}
              <div className="inline-flex items-center gap-2.5 mb-12">
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-xl font-bold text-sm text-white shadow-glow-sm"
                  style={{
                    background:
                      "linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(217 91% 60%) 100%)",
                  }}
                >
                  T
                </div>
                <span className="text-[15px] font-semibold tracking-tight text-white">
                  Ticket
                </span>
              </div>

              <h1 className="text-[28px] font-bold tracking-tight text-white leading-[1.2]">
                The professional standard
                <br />
                <span style={{ color: "hsl(var(--primary))" }}>
                  for service teams.
                </span>
              </h1>
              <p className="mt-4 text-[14px] leading-relaxed text-white/50 max-w-[84%]">
                Resolve requests faster with a unified workspace built for
                high-confidence triage and collaboration.
              </p>
            </div>

            <div className="relative z-10 space-y-5">
              <p className="text-[10px] font-semibold tracking-widest uppercase text-white/25">
                Why teams choose Ticket
              </p>
              <ul className="space-y-4">
                {features.map((item) => (
                  <li key={item.title} className="flex items-start gap-4">
                    <div
                      className="flex items-center justify-center shrink-0 w-8 h-8 rounded-lg"
                      style={{
                        background: "hsl(var(--primary) / 0.12)",
                        color: "hsl(var(--primary))",
                      }}
                    >
                      <item.icon className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-[13px] font-semibold text-white/85">
                        {item.title}
                      </h3>
                      <p className="mt-0.5 text-[12px] text-white/40 leading-relaxed">
                        {item.description}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </aside>

          {/* ── Right: Sign-in form ── */}
          <main className="flex flex-col items-center justify-center w-full px-8 py-12 lg:w-[56%] lg:px-14">
            <div className="w-full max-w-[340px]">
              {/* Mobile branding */}
              <div className="flex flex-col items-center mb-10 lg:hidden">
                <div
                  className="flex items-center justify-center w-11 h-11 mb-4 rounded-xl font-bold text-sm text-white shadow-glow-sm"
                  style={{
                    background:
                      "linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(217 91% 60%) 100%)",
                  }}
                >
                  T
                </div>
                <h1 className="text-xl font-bold tracking-tight text-foreground">
                  Ticket
                </h1>
              </div>

              <div>
                <h2 className="text-[24px] font-bold tracking-tight text-foreground">
                  Welcome back
                </h2>
                <p className="mt-1.5 text-[14px] text-muted-foreground">
                  Sign in to continue to your workspace
                </p>
              </div>

              {/* Error */}
              {error && (
                <div
                  className="mt-6 rounded-xl border px-4 py-4"
                  role="alert"
                  aria-live="assertive"
                  style={{
                    background: "hsl(0 80% 60% / 0.08)",
                    borderColor: "hsl(0 80% 60% / 0.25)",
                  }}
                >
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--destructive))]" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[hsl(var(--destructive))]">
                        Sign-in failed
                      </p>
                      <p className="mt-1 text-sm text-foreground/70">{error}</p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Try again or contact your administrator.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Sign-in button */}
              <div className="mt-10">
                <button
                  type="button"
                  onClick={handleSignIn}
                  disabled={isSigningIn}
                  aria-busy={isSigningIn}
                  className="group relative flex items-center justify-center w-full h-[46px] gap-3 px-5 text-[14px] font-semibold text-foreground/85 transition-all rounded-xl border hover:border-white/[0.18] hover:text-foreground hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{
                    background: "hsl(var(--secondary))",
                    borderColor: "hsl(var(--border))",
                  }}
                >
                  {isSigningIn ? (
                    <span
                      className="w-5 h-5 border-2 rounded-full animate-spin"
                      style={{
                        borderColor: "hsl(var(--border))",
                        borderTopColor: "hsl(var(--primary))",
                      }}
                    />
                  ) : (
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 21 21"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      className="shrink-0"
                    >
                      <path d="M10 0H0V10H10V0Z" fill="#F25022" />
                      <path d="M21 0H11V10H21V0Z" fill="#7FBA00" />
                      <path d="M10 11H0V21H10V11Z" fill="#00A4EF" />
                      <path d="M21 11H11V21H21V11Z" fill="#FFB900" />
                    </svg>
                  )}
                  <span>
                    {isSigningIn ? "Redirecting..." : "Sign in with Microsoft"}
                  </span>
                  {!isSigningIn && (
                    <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 group-hover:text-foreground/60 transition-all" />
                  )}
                </button>
              </div>

              <div
                className="mt-8 pt-6 border-t text-center"
                style={{ borderColor: "hsl(var(--border))" }}
              >
                <p className="flex items-center justify-center gap-2 text-[12px] font-medium text-muted-foreground/60">
                  <LockKeyhole className="w-3.5 h-3.5" />
                  Single Sign-On · Enterprise Grade
                </p>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
