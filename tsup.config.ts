import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    react: "src/react.tsx",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  // No source maps in the published tarball — keeps the source private and the
  // package lean. Flip to true locally when you need to debug the build.
  sourcemap: false,
  treeshake: true,
  external: ["react"],
});
