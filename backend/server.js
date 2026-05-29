import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const port = Number(process.env.PORT || 5173);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

const apiRoutes = {};

function addRoute(method, path, handler) {
  apiRoutes[`${method}:${path}`] = handler;
}

function parseBody(request) {
  return new Promise((resolve) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        resolve(null);
      }
    });
  });
}

function sendJson(response, data, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

// Health check
addRoute("GET", "/api/health", (req, res) => {
  sendJson(res, { ok: true, version: "0.1.0" });
});

// Import route modules
import("./routes/wechat.js");
import("./routes/bilibili.js");
import("./routes/credentials.js");

createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://localhost:${port}`);
  const pathname = decodeURIComponent(url.pathname);

  // API routes
  const routeKey = `${request.method}:${pathname}`;
  if (apiRoutes[routeKey]) {
    try {
      const body = request.method === "POST" || request.method === "PUT" ? await parseBody(request) : {};
      request.body = body;
      request.query = Object.fromEntries(url.searchParams);
      await apiRoutes[routeKey](request, response);
    } catch (err) {
      console.error(err);
      sendJson(response, { error: err.message || "Internal error" }, 500);
    }
    return;
  }

  // Static file serving
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = normalize(join(root, requested));

  if (!filePath.startsWith(root) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream"
  });
  createReadStream(filePath).pipe(response);
}).listen(port, () => {
  console.log(`ContentBridge is running at http://localhost:${port}`);
});

export { addRoute, sendJson, root };
