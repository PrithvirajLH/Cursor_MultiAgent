import { useState, useEffect } from 'react';
import { ArrowRight, LockKeyhole, LogIn, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '../ui/Button';

type SignInLandingPageProps = {
  onSignIn: () => void;
  error: string | null;
};

const trustHighlights = [
  {
    title: 'Real-time operations',
    description: 'Keep teams aligned with instant updates across tickets, queues, and escalations.',
    icon: ShieldCheck,
  },
  {
    title: 'SLA confidence',
    description: 'Monitor ownership and deadlines with clear, role-aware workflows.',
    icon: ArrowRight,
  },
  {
    title: 'Enterprise security',
    description: 'Authenticate with Microsoft SSO and enforce scoped, auditable access.',
    icon: LockKeyhole,
  },
];

export function SignInLandingPage({ onSignIn, error }: SignInLandingPageProps) {
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Prevent duplicate redirects while MSAL initializes the login flow.
  const handleSignIn = () => {
    if (isSigningIn) {
      return;
    }
    setIsSigningIn(true);
    onSignIn();
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-slate-950 font-sans selection:bg-cyan-500/30">
      {/* Animated Background Gradients */}
      <div className="absolute inset-0 z-0 overflow-hidden">
        <motion.div
          className="absolute -top-[40%] left-[20%] h-[80%] w-[60%] rounded-full bg-indigo-600/20 blur-[120px]"
          animate={{
            x: [0, 50, -50, 0],
            y: [0, -50, 50, 0],
            scale: [1, 1.1, 0.9, 1],
          }}
          transition={{ duration: 15, repeat: Infinity, ease: 'linear' }}
        />
        <motion.div
          className="absolute -bottom-[30%] -right-[10%] h-[70%] w-[50%] rounded-full bg-cyan-600/20 blur-[120px]"
          animate={{
            x: [0, -60, 40, 0],
            y: [0, 40, -60, 0],
            scale: [1, 1.2, 0.8, 1],
          }}
          transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
        />
        <motion.div
          className="absolute top-[20%] -left-[10%] h-[50%] w-[40%] rounded-full bg-violet-600/20 blur-[120px]"
          animate={{
            x: [0, 70, -30, 0],
            y: [0, 60, -40, 0],
            scale: [1, 0.9, 1.1, 1],
          }}
          transition={{ duration: 18, repeat: Infinity, ease: 'linear' }}
        />
        
        {/* Subtle grid pattern overlay */}
        <div 
          className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_80%_80%_at_50%_50%,#000_20%,transparent_100%)]"
        />
      </div>

      <div className="relative z-10 flex min-h-screen w-full items-center justify-center p-4 sm:p-6 lg:p-8">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="flex w-full max-w-6xl overflow-hidden rounded-[2.5rem] border border-white/10 bg-slate-900/50 shadow-2xl shadow-indigo-500/10 backdrop-blur-2xl xl:min-h-[700px]"
        >
          {/* Left Side: Branding & Value Props */}
          <aside className="relative hidden w-5/12 flex-col justify-between overflow-hidden bg-gradient-to-br from-slate-800/80 via-indigo-900/60 to-slate-900/80 p-12 lg:flex border-r border-white/5">
            {/* Interactive Glow following mouse */}
            <motion.div
              className="pointer-events-none absolute inset-0 z-0 opacity-40 transition-opacity duration-300"
              style={{
                background: `radial-gradient(400px circle at ${mousePosition.x}px ${mousePosition.y}px, rgba(99, 102, 241, 0.15), transparent 80%)`,
              }}
            />

            <div className="relative z-10">
              <motion.div 
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2, duration: 0.8 }}
                className="inline-flex items-center gap-2 rounded-full border border-indigo-400/20 bg-indigo-500/10 px-4 py-1.5 backdrop-blur-md"
              >
                <span className="h-2 w-2 rounded-full bg-indigo-400 shadow-[0_0_8px_rgba(129,140,248,0.8)]" />
                <span className="text-xs font-semibold uppercase tracking-widest text-indigo-300">
                  Codex Systems
                </span>
              </motion.div>
              
              <motion.h1 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 0.8 }}
                className="mt-8 text-4xl font-bold tracking-tight text-white xl:text-5xl lg:leading-[1.1]"
              >
                Elevate your <br/>
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 to-cyan-300">support operations.</span>
              </motion.h1>
              
              <motion.p 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4, duration: 0.8 }}
                className="mt-6 max-w-md text-base leading-relaxed text-slate-300"
              >
                Resolve requests faster with one unified workspace for triage, team collaboration, and strict service-level execution.
              </motion.p>
            </div>

            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.8 }}
              className="relative z-10 mt-12 rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl"
            >
              <p className="text-sm font-semibold tracking-wide text-indigo-200">Trusted by internal support teams</p>
              <ul className="mt-6 space-y-5">
                {trustHighlights.map((item, i) => (
                  <motion.li 
                    key={item.title} 
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.6 + i * 0.1, duration: 0.5 }}
                    className="group flex items-start gap-4 text-sm"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-indigo-400/20 bg-indigo-500/10 text-indigo-300 transition-colors group-hover:border-indigo-400/40 group-hover:bg-indigo-500/20 group-hover:text-indigo-200">
                      <item.icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-semibold text-slate-100">{item.title}</p>
                      <p className="mt-1 text-slate-400 leading-relaxed">{item.description}</p>
                    </div>
                  </motion.li>
                ))}
              </ul>
            </motion.div>
          </aside>

          {/* Right Side: Sign In Form */}
          <main className="relative flex w-full flex-col items-center justify-center bg-slate-900/40 p-8 sm:p-12 lg:w-7/12 lg:p-16">
            <div className="w-full max-w-md">
              {/* Mobile header (hidden on lg) */}
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1, duration: 0.6 }}
                className="mb-10 text-center lg:hidden"
              >
                <div className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-500/10">
                  <ShieldCheck className="h-6 w-6 text-indigo-400" />
                </div>
                <p className="text-xs font-semibold uppercase tracking-widest text-indigo-400">Codex Systems</p>
                <h2 className="mt-2 text-2xl font-bold text-white">Sign In</h2>
              </motion.div>

              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3, duration: 0.6 }}
                className="relative rounded-3xl border border-white/10 bg-slate-800/40 p-8 shadow-2xl backdrop-blur-xl sm:p-10"
              >
                <div className="absolute inset-x-0 -top-px h-px w-full bg-gradient-to-r from-transparent via-indigo-500/50 to-transparent" />
                
                <div className="text-center">
                  <h2 id="signin-title" className="text-2xl font-bold tracking-tight text-white">
                    Welcome back
                  </h2>
                  <p className="mt-3 text-sm text-slate-400">
                    Sign in with your work account to access your department queue and team dashboard.
                  </p>
                </div>

                {error && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="mt-6 overflow-hidden rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300 backdrop-blur-md"
                  >
                    <p role="alert" aria-live="assertive" className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
                      {error}
                    </p>
                  </motion.div>
                )}

                <div className="mt-8">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleSignIn}
                    disabled={isSigningIn}
                    aria-busy={isSigningIn}
                    className="group relative flex w-full items-center justify-center gap-3 overflow-hidden rounded-xl bg-white px-4 py-3.5 text-sm font-semibold text-slate-900 shadow-[0_0_20px_rgba(255,255,255,0.1)] transition-all hover:bg-slate-50 hover:shadow-[0_0_25px_rgba(255,255,255,0.2)] disabled:opacity-70 disabled:cursor-not-allowed"
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent opacity-0 transition-opacity group-hover:opacity-100 group-active:opacity-0" />
                    
                    {isSigningIn ? (
                      <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-800" />
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M10 0H0V10H10V0Z" fill="#F25022"/>
                        <path d="M21 0H11V10H21V0Z" fill="#7FBA00"/>
                        <path d="M10 11H0V21H10V11Z" fill="#00A4EF"/>
                        <path d="M21 11H11V21H21V11Z" fill="#FFB900"/>
                      </svg>
                    )}
                    <span>{isSigningIn ? 'Redirecting to Microsoft...' : 'Continue with Microsoft SSO'}</span>
                  </motion.button>
                </div>

                <div className="mt-8 pt-6 border-t border-white/10 text-center">
                  <p className="text-xs text-slate-500 flex items-center justify-center gap-2">
                    <LockKeyhole className="h-3.5 w-3.5" />
                    Secure Single Sign-On. Passwords never stored.
                  </p>
                  <p className="mt-2 text-[11px] text-slate-600">
                    By continuing, you agree to your organization's IT usage policies.
                  </p>
                </div>
              </motion.div>
            </div>
          </main>
        </motion.div>
      </div>
    </div>
  );
}

