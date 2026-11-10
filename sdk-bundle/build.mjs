import * as esbuild from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("/out", { recursive: true });

// Page script (not a worker). Do not reference importScripts — it is undefined
// in a window and throws before the activity wrapper can run.
await esbuild.build({
  entryPoints: ["entry.js"],
  bundle: true,
  format: "iife",
  globalName: "DiscordEmbeddedAppSdk",
  outfile: "/out/discordSdk.vendor.js",
  platform: "browser",
  target: ["es2020"],
});
