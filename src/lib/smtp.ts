/**
 * Minimal SMTP client built on Node.js built-in net/tls.
 * Supports:
 *   - Implicit TLS (port 465)
 *   - STARTTLS (port 587 / 25)
 *   - AUTH LOGIN
 */
import * as net from "net";
import * as tls from "tls";

export interface SmtpSendOptions {
  server: string;
  port: number;
  login_name: string;
  password: string;
  from?: string;       // defaults to login_name
  to: string[];
  subject: string;
  text: string;
  html?: string;
}

function b64(s: string): string {
  return Buffer.from(s).toString("base64");
}

function buildMessage(opts: SmtpSendOptions): string {
  const from = opts.from ?? opts.login_name;
  const boundary = `--LGBND${Date.now()}`;
  const hasHtml = !!opts.html;
  const date = new Date().toUTCString();

  const headers = [
    `Date: ${date}`,
    `From: LuminaGrid <${from}>`,
    `To: ${opts.to.join(", ")}`,
    `Subject: ${opts.subject}`,
    `MIME-Version: 1.0`,
  ];

  let body: string;
  if (hasHtml) {
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    body = [
      `--${boundary}`,
      `Content-Type: text/plain; charset=utf-8`,
      ``,
      opts.text,
      `--${boundary}`,
      `Content-Type: text/html; charset=utf-8`,
      ``,
      opts.html!,
      `--${boundary}--`,
    ].join("\r\n");
  } else {
    headers.push(`Content-Type: text/plain; charset=utf-8`);
    body = opts.text;
  }

  return headers.join("\r\n") + "\r\n\r\n" + body;
}

// Read lines from a socket until we get a complete SMTP response (no continuation hyphen).
async function readResponse(socket: net.Socket | tls.TLSSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const handler = (chunk: Buffer) => {
      buffer += chunk.toString();
      // SMTP multi-line: continuation lines have "NNN-" prefix; final has "NNN "
      const lines = buffer.split("\r\n");
      for (const line of lines) {
        if (line.length >= 4 && line[3] === " ") {
          socket.off("data", handler);
          resolve(buffer);
          return;
        }
      }
    };
    socket.on("data", handler);
    socket.once("error", reject);
    setTimeout(() => { socket.off("data", handler); reject(new Error("SMTP response timeout")); }, 10_000);
  });
}

function expectCode(response: string, code: string): void {
  const lines = response.trim().split("\r\n");
  const last = lines[lines.length - 1] ?? "";
  if (!last.startsWith(code)) {
    throw new Error(`SMTP expected ${code}, got: ${last}`);
  }
}

async function sendCommand(
  socket: net.Socket | tls.TLSSocket,
  cmd: string,
  expectedCode: string
): Promise<string> {
  await new Promise<void>((res, rej) => { socket.write(cmd + "\r\n", (err) => { if (err) rej(err); else res(); }); });
  const resp = await readResponse(socket);
  expectCode(resp, expectedCode);
  return resp;
}

export async function sendSmtpEmail(opts: SmtpSendOptions): Promise<void> {
  const useImplicitTls = opts.port === 465;

  // Create socket
  const rawSocket: net.Socket = await new Promise((resolve, reject) => {
    const s = net.createConnection({ host: opts.server, port: opts.port });
    s.once("connect", () => resolve(s));
    s.once("error", reject);
    setTimeout(() => reject(new Error(`SMTP connect timeout to ${opts.server}:${opts.port}`)), 10_000);
  });

  let socket: net.Socket | tls.TLSSocket = rawSocket;

  if (useImplicitTls) {
    // Wrap immediately in TLS
    socket = tls.connect({ socket: rawSocket, servername: opts.server });
    await new Promise<void>((resolve, reject) => {
      (socket as tls.TLSSocket).once("secureConnect", resolve);
      socket.once("error", reject);
    });
  }

  try {
    // Greeting
    const greeting = await readResponse(socket);
    expectCode(greeting, "2");

    // EHLO
    const ehloResp = await sendCommand(socket, `EHLO lumina`, "250");

    if (!useImplicitTls && ehloResp.includes("STARTTLS")) {
      // Upgrade to TLS
      await sendCommand(socket, "STARTTLS", "220");
      const tlsSocket = tls.connect({ socket: rawSocket, servername: opts.server });
      await new Promise<void>((resolve, reject) => {
        tlsSocket.once("secureConnect", resolve);
        tlsSocket.once("error", reject);
      });
      socket = tlsSocket;
      // Re-EHLO after TLS
      await sendCommand(socket, `EHLO lumina`, "250");
    }

    // AUTH LOGIN
    await sendCommand(socket, "AUTH LOGIN", "334");
    await sendCommand(socket, b64(opts.login_name), "334");
    await sendCommand(socket, b64(opts.password), "235");

    // Envelope
    const from = opts.from ?? opts.login_name;
    await sendCommand(socket, `MAIL FROM:<${from}>`, "250");
    for (const recipient of opts.to) {
      await sendCommand(socket, `RCPT TO:<${recipient}>`, "250");
    }

    // Data
    await sendCommand(socket, "DATA", "354");
    const message = buildMessage(opts);
    // Dot-stuffing: per RFC 5321, any line beginning with "." must have an extra "." prepended
    const stuffed = message.replace(/^\./gm, "..");
    await new Promise<void>((res, rej) => { socket.write(stuffed + "\r\n.\r\n", (err) => { if (err) rej(err); else res(); }); });
    const dataResp = await readResponse(socket);
    expectCode(dataResp, "250");

    await sendCommand(socket, "QUIT", "221");
  } finally {
    socket.destroy();
  }
}
