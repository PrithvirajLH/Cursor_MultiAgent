import { useState } from "react";
import { ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";

type SignInLandingPageProps = {
  onSignIn: () => void;
  error: string | null;
};

const trustHighlights = [
  {
    title: "Real-time operations",
    description: "Keep teams aligned with instant updates.",
    icon: ShieldCheck,
  },
  {
    title: "SLA confidence",
    description: "Monitor ownership and strict deadlines.",
    icon: ArrowRight,
  },
  {
    title: "Enterprise security",
    description: "Enforce scoped, auditable access.",
    icon: LockKeyhole,
  },
];

export function SignInLandingPage({ onSignIn, error }: SignInLandingPageProps) {
  const [isSigningIn, setIsSigningIn] = useState(false);

  const handleSignIn = () => {
    if (isSigningIn) {
      return;
    }
    setIsSigningIn(true);
    onSignIn();
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#f8fafc] font-sans selection:bg-blue-100">
      {/* 
        Main Container:
        A pristine, crisp white card floating over a soft slate-50 background.
        Subtle but deep shadows for realistic elevation.
      */}
      <div className="flex w-full max-w-[1000px] overflow-hidden rounded-[20px] bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] sm:m-6 lg:min-h-[600px] border border-slate-100">
        {/* Left Side: Professional Branding Accent */}
        <aside className="relative flex-col justify-between hidden w-[45%] bg-[#f1f5f9] p-12 lg:flex border-r border-slate-100/50">
          {/* Subtle geometric background decoration replacing the neon orbs */}
          <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none opacity-40">
            <svg
              className="absolute -top-24 -left-24 w-96 h-96 text-blue-200"
              viewBox="0 0 100 100"
              fill="currentColor"
            >
              <circle cx="50" cy="50" r="50" />
            </svg>
            <svg
              className="absolute bottom-0 right-0 w-64 h-64 text-slate-200 translate-x-1/3 translate-y-1/3"
              viewBox="0 0 100 100"
              fill="currentColor"
            >
              <circle cx="50" cy="50" r="50" />
            </svg>
          </div>

          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 mb-10">
              <div className="flex items-center justify-center w-8 h-8 rounded bg-blue-600 text-white shadow-sm">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <span className="text-sm font-bold tracking-widest text-slate-800 uppercase">
                Ticketing Systems
              </span>
            </div>

            <h1 className="text-3xl font-bold tracking-tight text-slate-900 leading-[1.2]">
              The professional standard
              <br />
              <span className="text-blue-600">for service teams.</span>
            </h1>

            <p className="mt-4 text-[15px] leading-relaxed text-slate-600 max-w-[85%]">
              Resolve requests faster with a unified workspace built for
              high-confidence triage and collaboration.
            </p>
          </div>

          <div className="relative z-10 mt-12 space-y-6">
            <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Enterprise Grade
            </p>
            <ul className="space-y-5">
              {trustHighlights.map((item) => (
                <li key={item.title} className="flex items-start gap-4">
                  <div className="flex items-center justify-center shrink-0 w-8 h-8 mt-0.5 rounded-full bg-blue-50 text-blue-600">
                    <item.icon className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      {item.title}
                    </h3>
                    <p className="mt-0.5 text-sm text-slate-600">
                      {item.description}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* Right Side: Clean Login Form */}
        <main className="flex flex-col items-center justify-center w-full px-8 py-12 lg:w-[55%] lg:px-16 bg-white">
          <div className="w-full max-w-[360px]">
            {/* Mobile Branding (Visible only on small screens) */}
            <div className="flex flex-col items-center mb-10 lg:hidden">
              <div className="flex items-center justify-center w-12 h-12 mb-4 rounded-lg bg-blue-600 text-white shadow-sm">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <h1 className="text-2xl font-bold text-slate-900">
                Ticketing Systems
              </h1>
            </div>

            <div className="text-center lg:text-left">
              <h2 className="text-[26px] font-semibold tracking-tight text-slate-900">
                Sign in
              </h2>
              <p className="mt-2 text-[15px] text-slate-600">
                to continue to your workspace
              </p>
            </div>

            {error && (
              <div className="p-3 mt-6 text-sm border rounded-lg bg-red-50 border-red-100/50 text-red-700">
                <p
                  role="alert"
                  aria-live="assertive"
                  className="flex items-center gap-2"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                  {error}
                </p>
              </div>
            )}

            <div className="mt-8">
              <button
                type="button"
                onClick={handleSignIn}
                disabled={isSigningIn}
                aria-busy={isSigningIn}
                className="relative flex items-center justify-center w-full h-12 gap-3 px-4 text-[15px] font-medium text-slate-700 transition-colors bg-white border border-slate-300 rounded-md shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {isSigningIn ? (
                  <span className="w-5 h-5 border-2 rounded-full animate-spin border-slate-300 border-t-slate-600" />
                ) : (
                  <svg
                    width="21"
                    height="21"
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
              </button>
            </div>

            <div className="pt-6 mt-8 text-center border-t border-slate-100">
              <p className="flex items-center justify-center gap-1.5 text-xs font-medium text-slate-500">
                <LockKeyhole className="w-3.5 h-3.5" />
                Single Sign-On Enabled
              </p>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
