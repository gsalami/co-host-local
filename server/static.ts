import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "..", "dist", "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // BASE_PATH can be set via env, e.g. "/co-host". Defaults to "/" (root).
  const basePath = (process.env.BASE_PATH || "/").replace(/\/+$/, "") || "/";

  app.use(basePath, express.static(distPath));

  // SPA fallback: serve index.html for any non-file request under basePath
  const sendIndex = (_req: express.Request, res: express.Response) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  };

  if (basePath !== "/") {
    app.get(basePath, sendIndex);
    app.get(`${basePath}/*`, sendIndex);
    // Redirect root to basePath
    app.get("/", (_req, res) => {
      res.redirect(basePath);
    });
  } else {
    app.get("*", sendIndex);
  }
}
