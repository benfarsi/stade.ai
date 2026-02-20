"use client";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const supabase = createClient();

  async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,300&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #F7F5F0; font-family: 'DM Sans', sans-serif; }
      `}</style>
      <div style={{
        minHeight: "100vh",
        background: "#F7F5F0",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'DM Sans', sans-serif",
        padding: "24px",
      }}>
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 32,
          width: "100%",
          maxWidth: 400,
        }}>
          {/* Logo */}
          <div style={{ textAlign: "center" }}>
            <h1 style={{
              fontFamily: "'Instrument Serif', serif",
              fontSize: 64,
              lineHeight: 1,
              letterSpacing: "-2px",
              color: "#1a1a1a",
              margin: 0,
            }}>
              Stad<em style={{ fontStyle: "italic", color: "#5B6AF0" }}>e</em>
            </h1>
            <p style={{
              fontSize: 15,
              color: "#999",
              marginTop: 8,
              fontFamily: "'DM Sans', sans-serif",
            }}>
              Turn your notes into exam-ready questions, instantly.
            </p>
          </div>

          {/* Card */}
          <div style={{
            background: "#fff",
            borderRadius: 20,
            border: "1px solid #E8E4DD",
            padding: "32px 28px",
            width: "100%",
            boxShadow: "0 1px 12px rgba(0,0,0,0.04)",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}>
            <p style={{
              textAlign: "center",
              fontSize: 11,
              color: "#C0BAB0",
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}>
              Sign in to continue
            </p>

            <button
              onClick={signInWithGoogle}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                width: "100%",
                padding: "13px 20px",
                border: "1.5px solid #E8E4DD",
                borderRadius: 12,
                background: "#FAFAF8",
                fontSize: 15,
                fontWeight: 600,
                cursor: "pointer",
                color: "#1a1a1a",
                fontFamily: "'DM Sans', sans-serif",
                transition: "all 0.15s",
              }}
              onMouseOver={e => {
                e.currentTarget.style.background = "#F0EDE8";
                e.currentTarget.style.borderColor = "#D4CFC7";
              }}
              onMouseOut={e => {
                e.currentTarget.style.background = "#FAFAF8";
                e.currentTarget.style.borderColor = "#E8E4DD";
              }}
            >
              <svg width="18" height="18" viewBox="0 0 48 48">
                <path fill="#FFC107" d="M43.6 20H24v8h11.3C33.6 33.1 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.5 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 20-9 20-20 0-1.3-.1-2.7-.4-4z"/>
                <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 15.1 18.9 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.5 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
                <path fill="#4CAF50" d="M24 44c5.2 0 9.9-1.9 13.5-5l-6.2-5.2C29.4 35.6 26.8 36 24 36c-5.2 0-9.6-2.9-11.3-7.1l-6.6 4.8C9.8 39.8 16.4 44 24 44z"/>
                <path fill="#1976D2" d="M43.6 20H24v8h11.3c-.9 2.5-2.6 4.6-4.8 6l6.2 5.2C40.2 35.7 44 30.3 44 24c0-1.3-.1-2.7-.4-4z"/>
              </svg>
              Continue with Google
            </button>
          </div>

          <p style={{ fontSize: 12, color: "#C0BAB0", textAlign: "center" }}>
            By signing in, you agree to our terms of service.
          </p>
        </div>
      </div>
    </>
  );
}
