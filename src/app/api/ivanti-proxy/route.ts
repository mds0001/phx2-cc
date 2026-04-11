import { NextRequest, NextResponse } from "next/server";

// Fallback API key (used when no Ivanti endpoint connection is configured on the task)
const FALLBACK_API_KEY = "251E668B0B42478EB3DA9D6E8446CA0B";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      ivantiUrl,
      data,
      apiKey,
      businessObject,
      tenantId,
    } = body as {
      ivantiUrl: string;
      data: Record<string, unknown>;
      apiKey?: string;
      businessObject?: string;
      tenantId?: string;
    };

    if (!ivantiUrl || !data) {
      return NextResponse.json(
        { error: "Missing required fields: ivantiUrl and data" },
        { status: 400 }
      );
    }

    const resolvedKey    = apiKey          ?? FALLBACK_API_KEY;
    const resolvedObject = businessObject  ?? "CI__Computers";
    const endpoint = `${ivantiUrl.replace(/\/$/, "")}/api/odata/businessobject/${resolvedObject}`;

    console.log("[ivanti-proxy] POST to:", endpoint);
    console.log("[ivanti-proxy] Business object:", resolvedObject);
    console.log("[ivanti-proxy] Payload:", JSON.stringify(data));

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `rest_api_key=${resolvedKey}`,
      Accept: "application/json",
    };

    if (tenantId) {
      headers["X-Tenant-Id"] = tenantId;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(data),
    });

    const contentType = response.headers.get("content-type") ?? "";
    const responseBody = contentType.includes("application/json")
      ? await response.json()
      : await response.text();

    console.log("[ivanti-proxy] Response status:", response.status);
    console.log("[ivanti-proxy] Response body:", JSON.stringify(responseBody));

    return NextResponse.json(
      {
        status: response.status,
        statusText: response.statusText,
        body: responseBody,
      },
      { status: response.ok ? 200 : response.status }
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown proxy error";
    console.error("[ivanti-proxy] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
