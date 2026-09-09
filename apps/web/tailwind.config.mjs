/** @type {import('tailwindcss').Config} */
export default {
  content: {
    relative: true,
    files: [
      "./app/**/*.{js,ts,jsx,tsx,mdx}",
      "./components/**/*.{js,ts,jsx,tsx,mdx}",
      "./src/**/*.{js,ts,jsx,tsx,mdx}",
      "!./**/*.test.{ts,tsx}",
    ],
  },
  corePlugins: { preflight: false },
  theme: {
    extend: {
      // Match the existing enterprise palette in app/globals.css.
      colors: {
        slate: { 500: "#8493a8", 950: "#0b0f19" },
        indigo: { 500: "#5b5cf6" },
        red: { 500: "#b91c1c" },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
