/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,ts}"],
  theme: {
    extend: {
      colors: {
        paper: "#fffaf4",
        "paper-deep": "#f1e5d5",
        ink: "#25212a",
        "ink-soft": "#5b5460",
        "momoko-pink": "#8f294b",
        "momoko-pink-dark": "#6f1f3a",
        brass: "#7a581d",
        line: "#d8c8bc",
        bg: "#fffaf4",
        surface: "#f1e5d5",
        text: "#25212a",
        "text-secondary": "#5b5460",
        accent: "#8f294b",
        "accent-contrast": "#ffffff",
        link: "#0b5575",
        border: "#d8c8bc",
      },
      fontSize: {
        xs: ["0.75rem", { lineHeight: "1.1" }],
        sm: ["0.875rem", { lineHeight: "1.4" }],
        base: ["1rem", { lineHeight: "1.6" }],
        lg: ["1.125rem", { lineHeight: "1.6" }],
        xl: ["clamp(1.25rem, 1.6vw + 1rem, 1.6rem)", { lineHeight: "1.2" }],
        "2xl": ["clamp(1.75rem, 2vw + 1.2rem, 2.5rem)", { lineHeight: "1.08" }],
        "display": ["clamp(2.5rem, 5vw + 1rem, 5.5rem)", { lineHeight: "0.95" }],
      },
      fontFamily: {
        display: ["Iowan Old Style", "Baskerville", "Times New Roman", "serif"],
        body: [
          "ui-sans-serif",
          "system-ui",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "PingFang SC",
          "Hiragino Sans",
          "Noto Sans CJK",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      maxWidth: {
        content: "72rem",
      },
      borderRadius: {
        DEFAULT: "0.75rem",
        card: "0.75rem",
      },
      boxShadow: {
        paper: "0 1px 0 rgba(37, 33, 42, 0.08), 0 12px 32px rgba(111, 31, 58, 0.08)",
      },
      transitionDuration: {
        state: "180ms",
        entrance: "420ms",
      },
    },
  },
  plugins: [],
};
