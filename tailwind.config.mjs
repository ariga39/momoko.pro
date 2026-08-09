/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,ts}"],
  theme: {
    extend: {
      colors: {
        // a11y: 与 bg 对比 ≥4.5:1（WCAG AA）
        bg: "#ffffff",
        surface: "#f6f4f0",
        text: "#1f2430",
        "text-secondary": "#4a5163",
        accent: "#8a2b3d",
        "accent-contrast": "#ffffff",
        link: "#1458a0",
        border: "#d8d4cc",
      },
      fontSize: {
        xs: "0.8rem",
        sm: "0.9rem",
        md: "1rem",
        lg: "1.25rem",
        xl: "1.75rem",
        "2xl": "2.25rem",
      },
      fontFamily: {
        body: [
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
      },
      maxWidth: {
        content: "60rem",
      },
      borderRadius: {
        DEFAULT: "6px",
      },
    },
  },
  plugins: [],
};
