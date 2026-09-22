"""Apply the security binding patch to the pinned upstream GhidraMCP 1.4 source."""
import argparse
import hashlib
from pathlib import Path

EXPECTED = "9f5d8722ee6070ce081f0464f34e47f5e16a959f24711b533a89a724d3cc66d5"

SUPPORT = r'''
    private volatile Program dshProgram;
    private final String dshToken = System.getenv("DSH_GHIDRA_TOKEN");
    private final String dshHash = System.getenv("DSH_GHIDRA_SHA256");
    private final String dshPath = System.getenv("DSH_GHIDRA_PROGRAM");

    private void dshContext(String path, com.sun.net.httpserver.HttpHandler handler) {
        server.createContext(path, exchange -> {
            String supplied = exchange.getRequestHeaders().getFirst("Authorization");
            if (supplied == null || !java.security.MessageDigest.isEqual(
                    supplied.getBytes(StandardCharsets.UTF_8),
                    ("Bearer " + dshToken).getBytes(StandardCharsets.UTF_8))) {
                dshError(exchange, 401, "unauthorized");
                return;
            }
            Program program = getCurrentProgram();
            if (program == null) {
                dshError(exchange, 409, "bound_program_unavailable");
                return;
            }
            if (!dshHash.equals(exchange.getRequestHeaders().getFirst("X-DSH-SHA256")) ||
                    !dshPath.equals(java.net.URLDecoder.decode(
                        java.util.Objects.toString(exchange.getRequestHeaders().getFirst("X-DSH-Program"), ""), StandardCharsets.UTF_8))) {
                dshError(exchange, 409, "program_identity_mismatch");
                return;
            }
            exchange.getResponseHeaders().set("X-DSH-SHA256", dshHash);
            exchange.getResponseHeaders().set("X-DSH-Ghidra-Version", ghidra.framework.Application.getApplicationVersion());
            try {
                if (path.equals("/dsh/identity")) {
                    sendResponse(exchange, dshHash + "\n" + dshPath + "\n" + program.getLanguageID());
                } else {
                    handler.handle(exchange);
                }
            } catch (Exception error) {
                dshError(exchange, 500, "analysis_failed");
            } finally {
                exchange.close();
            }
        });
    }

    private void dshError(HttpExchange exchange, int status, String code) throws IOException {
        byte[] bytes = ("{\"error\":\"" + code + "\"}").getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream output = exchange.getResponseBody()) { output.write(bytes); }
    }
'''
PROGRAM = r'''    public synchronized Program getCurrentProgram() {
        if (dshProgram != null) {
            return !dshProgram.isClosed() && dshHash.equals(dshProgram.getExecutableSHA256())
                && dshPath.equals(dshProgram.getDomainFile().getPathname()) ? dshProgram : null;
        }
        ProgramManager manager = tool.getService(ProgramManager.class);
        if (manager == null) return null;
        for (Program candidate : manager.getAllOpenPrograms()) {
            if (dshHash.equals(candidate.getExecutableSHA256())
                    && dshPath.equals(candidate.getDomainFile().getPathname())) {
                dshProgram = candidate;
                return candidate;
            }
        }
        return null;
    }'''


def patch(source: bytes) -> str:
    """Refuse source drift before changing listener, request admission and identity."""
    if hashlib.sha256(source).hexdigest() != EXPECTED:
        raise ValueError("Expected unmodified GhidraMCP 1.4 source; verify upstream before updating this patch")
    text = source.decode("utf-8").replace("exchange.getRequestURI().getQuery()", "exchange.getRequestURI().getRawQuery()")
    text = text.replace("    private HttpServer server;", "    private HttpServer server;\n" + SUPPORT)
    text = text.replace("        server = HttpServer.create(new InetSocketAddress(port), 0);", r'''
        if (dshToken == null || dshToken.length() < 32 || dshHash == null
                || !dshHash.matches("[a-f0-9]{64}") || dshPath == null || dshPath.isBlank()) {
            throw new IOException("DSH_GHIDRA_TOKEN, DSH_GHIDRA_SHA256 and DSH_GHIDRA_PROGRAM are required");
        }
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
        dshContext("/dsh/identity", exchange -> {});
''')
    text = text.replace("int port = options.getInt(PORT_OPTION_NAME, DEFAULT_PORT);",
        'int port = Integer.parseInt(java.util.Objects.requireNonNull(System.getenv("DSH_GHIDRA_PORT"), "DSH_GHIDRA_PORT"));')
    text = text.replace("        server.start();", r"""
        server.start();
        String readyPath = System.getenv("DSH_GHIDRA_READY");
        if (readyPath != null) {
            java.nio.file.Files.writeString(java.nio.file.Path.of(readyPath),
                Integer.toString(server.getAddress().getPort()), StandardCharsets.UTF_8,
                java.nio.file.StandardOpenOption.CREATE_NEW);
        }
""")
    # The inserted helper keeps the real createContext call.
    before, body = text.split("    private void startServer()", 1)
    body = body.replace("server.createContext(", "dshContext(")
    text = before + "    private void startServer()" + body
    old = """    public Program getCurrentProgram() {
        ProgramManager pm = tool.getService(ProgramManager.class);
        return pm != null ? pm.getCurrentProgram() : null;
    }"""
    if old not in text:
        raise ValueError("Pinned program accessor was not found")
    return text.replace(old, PROGRAM)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    result = patch(args.source.read_bytes())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x", encoding="utf-8", newline="\n") as output:
        output.write(result)


if __name__ == "__main__":
    main()
