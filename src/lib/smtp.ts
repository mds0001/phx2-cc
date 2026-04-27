/**
 * Minimal SMTP client built on Node.js built-in net/tls.
 * Supports:
 *   - Implicit TLS (port 465)
 *   - STARTTLS (port 587 / 25)
 *   - AUTH LOGIN
 *   - File attachments (multipart/mixed)
 */
import * as net from "net";
import * as tls from "tls";

export interface SmtpAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface SmtpSendOptions {
  server: string;
  port: number;
  login_name: string;
  password: string;
  from?: string;
  to: string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: SmtpAttachment[];
}

function b64(s: string): string {
  return Buffer.from(s).toString("base64");
}

function chunkBase64(buf: Buffer): string {
  const str = buf.toString("base64");
  const chunks: string[] = [];
  for (let i = 0; i < str.length; i += 76) chunks.push(str.slice(i, i + 76));
  return chunks.join("\r\n");
}

function buildMessage(opts: SmtpSendOptions): string {
  const CRLF = "\r\n";
  const from = opts.from ?? opts.login_name;
  const date = new Date().toUTCString();
  const hasHtml = !!opts.html;
  const hasAttachments = !!(opts.attachments && opts.attachments.length > 0);

  const baseHeaderLines = [
    "Date: " + date,
    "From: Threads by Cloud Weaver <" + from + ">",
    "To: " + opts.to.join(", "),
    "Subject: " + opts.subject,
    "MIME-Version: 1.0",
  ];

  if (!hasHtml && !hasAttachments) {
    baseHeaderLines.push("Content-Type: text/plain; charset=utf-8");
    return baseHeaderLines.join(CRLF) + CRLF + CRLF + opts.text;
  }

  if (!hasAttachments) {
    const bnd = "ALT" + Date.now();
    baseHeaderLines.push("Content-Type: multipart/alternative; boundary=\"" + bnd + "\"");
    const body = [
      "--" + bnd,
      "Content-Type: text/plain; charset=utf-8",
      "",
      opts.text,
      "--" + bnd,
      "Content-Type: text/html; charset=utf-8",
      "",
      opts.html!,
      "--" + bnd + "--",
    ].join(CRLF);
    return baseHeaderLines.join(CRLF) + CRLF + CRLF + body;
  }

  const mixBnd = "MIX" + Date.now();
  baseHeaderLines.push("Content-Type: multipart/mixed; boundary=\"" + mixBnd + "\"");

  const parts: string[] = [];

  if (hasHtml) {
    const altBnd = "ALT" + (Date.now() + 1);
    parts.push(
      "--" + mixBnd,
      "Content-Type: multipart/alternative; boundary=\"" + altBnd + "\"",
      "",
      "--" + altBnd,
      "Content-Type: text/plain; charset=utf-8",
      "",
      opts.text,
      "--" + altBnd,
      "Content-Type: text/html; charset=utf-8",
      "",
      opts.html!,
      "--" + altBnd + "--",
    );
  } else {
    parts.push(
      "--" + mixBnd,
      "Content-Type: text/plain; charset=utf-8",
      "",
      opts.text,
    );
  }

  for (const att of (opts.attachments ?? [])) {
    parts.push(
      "--" + mixBnd,
      "Content-Type: " + att.contentType + "; name=\"" + att.filename + "\"",
      "Content-Transfer-Encoding: base64",
      "Content-Disposition: attachment; filename=\"" + att.filename + "\"",
      "",
      chunkBase64(att.content),
    );
  }

  parts.push("--" + mixBnd + "--");

  return baseHeaderLines.join(CRLF) + CRLF + CRLF + parts.join(CRLF);
}

async function readResponse(socket: net.Socket | tls.TLSSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const handler = (chunk: Buffer) => {
      buffer += chunk.toString();
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
    setTimeout(() => {
      socket.off("data", handler);
      reject(new Error("SMTP response timeout"));
    }, 10000);
  });
}

function expectCode(response: string, code: string): void {
  const lines = response.trim().split("\r\n");
  const last = lines[lines.length - 1] ?? "";
  if (!last.startsWith(code)) {
    throw new Error("SMTP expected " + code + ", got: " + last);
  }
}

async function sendCommand(
  socket: net.Socket | tls.TLSSocket,
  cmd: string,
  expectedCode: string
): Promise<string> {
  await new Promise<void>((res, rej) => {
    socket.write(cmd + "\r\n", (err) => { if (err) rej(err); else res(); });
  });
  const resp = await readResponse(socket);
  expectCode(resp, expectedCode);
  return resp;
}

export async function sendSmtpEmail(opts: SmtpSendOptions): Promise<void> {
  const useImplicitTls = opts.port === 465;

  const rawSocket: net.Socket = await new Promise((resolve, reject) => {
    const s = net.createConnection({ host: opts.server, port: opts.port });
    s.once("connect", () => resolve(s));
    s.once("error", reject);
    setTimeout(() => reject(new Error("SMTP connect timeout to " + opts.server + ":" + opts.port)), 10000);
  });

  let socket: net.Socket | tls.TLSSocket = rawSocket;

  if (useImplicitTls) {
    socket = tls.connect({ socket: rawSocket, servername: opts.server });
    await new Promise<void>((resolve, reject) => {
      (socket as tls.TLSSocket).once("secureConnect", resolve);
      socket.once("error", reject);
    });
  }

  try {
    const greeting = await readResponse(socket);
    expectCode(greeting, "2");

    const ehloResp = await sendCommand(socket, "EHLO lumina", "250");

    if (!useImplicitTls && ehloResp.includes("STARTTLS")) {
      await sendCommand(socket, "STARTTLS", "220");
      const tlsSocket = tls.connect({ socket: rawSocket, servername: opts.server });
      await new Promise<void>((resolve, reject) => {
        tlsSocket.once("secureConnect", resolve);
        tlsSocket.once("error", reject);
      });
      socket = tlsSocket;
      await sendCommand(socket, "EHLO lumina", "250");
    }

    await sendCommand(socket, "AUTH LOGIN", "334");
    await sendCommand(socket, b64(opts.login_name), "334");
    await sendCommand(socket, b64(opts.password), "235");

    const from = opts.from ?? opts.login_name;
    await sendCommand(socket, "MAIL FROM:<" + from + ">", "250");
    for (const recipient of opts.to) {
      await sendCommand(socket, "RCPT TO:<" + recipient + ">", "250");
    }

    await sendCommand(socket, "DATA", "354");
    const message = buildMessage(opts);
    const stuffed = message.replace(/^\./gm, "..");
    await new Promise<void>((res, rej) => {
      socket.write(stuffed + "\r\n.\r\n", (err) => { if (err) rej(err); else res(); });
    });
    const dataResp = await readResponse(socket);
    expectCode(dataResp, "250");

    await sendCommand(socket, "QUIT", "221");
  } finally {
    socket.destroy();
  }
}
