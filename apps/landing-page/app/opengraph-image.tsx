import { ImageResponse } from "next/og";

// Generated share-card for link previews (Open Graph + Twitter).
// `force-static` so it pre-renders to a PNG at build time (output: "export").
export const dynamic = "force-static";
export const alt = "CodeVetter — Vet AI-generated code before it ships";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background:
            "radial-gradient(60% 60% at 30% 20%, #1a2238 0%, #0e0f13 70%)",
          color: "#e6e8ee",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            fontSize: "26px",
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "#d4a039",
          }}
        >
          <div
            style={{
              width: "18px",
              height: "18px",
              borderRadius: "9999px",
              background: "#d4a039",
            }}
          />
          CodeVetter
        </div>
        <div
          style={{
            marginTop: "32px",
            fontSize: "78px",
            fontWeight: 800,
            lineHeight: 1.05,
            maxWidth: "900px",
          }}
        >
          Stop merging unreviewed AI code.
        </div>
        <div
          style={{
            marginTop: "28px",
            fontSize: "32px",
            color: "#9aa0ad",
            maxWidth: "880px",
          }}
        >
          Desktop code review for agent-generated diffs. Runs offline. Bring
          your own LLM key.
        </div>
      </div>
    ),
    { ...size },
  );
}
