import { ImageResponse } from "next/og";

export const alt = "Grace AI — Think clearly. Create freely.";
export const size = { height: 630, width: 1200 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    <div
      style={{
        background: "#0c0b10",
        color: "#f5f3fa",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        justifyContent: "center",
        padding: 96,
        width: "100%",
      }}
    >
      <div style={{ color: "#a99aff", fontSize: 26, letterSpacing: 5 }}>
        GRACE AI
      </div>
      <div style={{ fontSize: 72, marginTop: 32 }}>Think clearly.</div>
      <div style={{ fontSize: 72 }}>Create freely.</div>
      <div style={{ color: "#a6a0b3", fontSize: 24, marginTop: 48 }}>
        An AI workspace by Ritam Das · Huracan
      </div>
    </div>,
    size
  );
}
