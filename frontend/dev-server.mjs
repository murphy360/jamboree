import http from "node:http";

import httpProxy from "http-proxy";
import { createServer as createViteServer } from "vite";

process.on("uncaughtException", (error) => {
  const maybeCode =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  if (maybeCode === "ECONNRESET") {
    // Ignore client socket resets so the dev server keeps running.
    return;
  }

  throw error;
});

const backendHttpProxy = httpProxy.createProxyServer({
  changeOrigin: true,
  secure: false,
});

const backendWsProxy = httpProxy.createProxyServer({
  changeOrigin: true,
  secure: false,
  ws: true,
});

backendHttpProxy.on("error", (error, request, response) => {
  if (response && "setHeader" in response && !response.headersSent) {
    response.statusCode = 502;
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end(`Backend proxy error: ${error instanceof Error ? error.message : String(error)}`);
  }
});

backendWsProxy.on("error", () => {
  // Keep the dev server alive if the backend is not ready yet.
});

const vite = await createViteServer({
  server: {
    middlewareMode: true,
    host: "0.0.0.0",
    port: 5174,
  },
});

const server = http.createServer((request, response) => {
  request.socket.on("error", () => {
    // Ignore client socket teardown errors.
  });

  const rawUrl = request.url ?? "";
  const requestUrl = new URL(rawUrl, "http://localhost");
  const pathname = requestUrl.pathname;

  if (pathname.startsWith("/api/")) {
    request.url = `${pathname.replace(/^\/api/, "")}${requestUrl.search}`;
    backendHttpProxy.web(
      request,
      response,
      {
        target: "http://backend:8000",
      },
      (error) => {
        if (!response.headersSent) {
          response.statusCode = 502;
          response.setHeader("Content-Type", "text/plain; charset=utf-8");
          response.end(`Backend proxy error: ${error instanceof Error ? error.message : String(error)}`);
        } else {
          response.end();
        }
      },
    );
    return;
  }

  vite.middlewares(request, response, (error) => {
    if (error) {
      response.statusCode = 500;
      response.end(error instanceof Error ? error.message : String(error));
      return;
    }

    response.statusCode = 404;
    response.end("Not found");
  });
});

server.on("upgrade", (request, socket, head) => {
  socket.on("error", () => {
    // Ignore client websocket teardown errors.
  });

  const rawUrl = request.url ?? "";
  const requestUrl = new URL(rawUrl, "http://localhost");

  if (requestUrl.pathname.startsWith("/ws/")) {
    backendWsProxy.ws(request, socket, head, {
      target: "ws://backend:8000",
    });
    return;
  }

  socket.destroy();
});

server.listen(5174, "0.0.0.0", () => {
  console.log("Frontend dev server listening on http://0.0.0.0:5174");
});
