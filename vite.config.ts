import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Never emit source maps to the client: shipping them would hand attackers the readable
  // original source (comments, names). Production is already minified; this keeps it guaranteed.
  build: { sourcemap: false },
  plugins: [
    tailwindcss(),
    vinext(),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
  // Pre-bundle client libraries up front so the dev server never re-optimises mid-session
  // (which can load two copies of React).
  optimizeDeps: {
    include: [
      "@tanstack/react-query",
      "zustand",
      "recharts",
      "cmdk",
      "vaul",
      "radix-ui",
      "sonner",
      "react-hook-form",
      "@hookform/resolvers/zod",
      "idb-keyval",
      "lucide-react",
      "clsx",
      "tailwind-merge",
      "class-variance-authority",
      "zod",
    ],
  },
});
