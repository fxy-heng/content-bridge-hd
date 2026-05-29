import express from "express";
import cors from "cors";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import credentialsRouter from "./routes/credentials.js";
import wechatRouter from "./routes/wechat.js";
import zhihuRouter from "./routes/zhihu.js";
import bilibiliRouter from "./routes/bilibili.js";
import rednoteRouter from "./routes/rednote.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const root = join(__dirname, "..");
export const dataRoot = join(__dirname, "data");

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (req, res) => {
    res.json({
      ok: true,
      name: "ContentBridge backend",
      version: "0.2.0",
      realPublish: ["wechat", "zhihu", "bilibili", "rednote"]
    });
  });

  app.use("/api/credentials", credentialsRouter);
  app.use("/api/wechat", wechatRouter);
  app.use("/api/zhihu", zhihuRouter);
  app.use("/api/bilibili", bilibiliRouter);
  app.use("/api/rednote", rednoteRouter);

  app.use(express.static(root, {
    extensions: ["html"],
    setHeaders(res, filePath) {
      if (filePath.endsWith(".webmanifest")) {
        res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
      }
    }
  }));

  app.use((req, res) => {
    res.status(404).json({ ok: false, error: "Not found" });
  });

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(err.status || 500).json({
      ok: false,
      error: err.message || "Internal server error"
    });
  });

  return app;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] === currentFile) {
  const port = Number(process.env.PORT || 5173);
  createApp().listen(port, () => {
    console.log(`ContentBridge backend is running at http://localhost:${port}`);
  });
}
