import { NextResponse } from "next/server";

/**
 * Dial-tone / heartbeat endpoint.
 *
 * Purpose: a stable, self-hosted "I'm here" endpoint that Cloud Weaver owns.
 * Used as a reachable target for SOAP/.NET validators that parse the
 * response as a WSDL document (e.g. Ivanti NFSM Web Service Connection
 * Manager rejects non-WSDL XML with "Invalid Web Service Description").
 *
 * Returns a minimal valid WSDL describing a single no-op "Ping" operation.
 * NFSM-style validators should accept this and populate their method list
 * with "Ping". Actual SOAP invocation is not implemented — this endpoint is
 * a placeholder to get a Service Reference saved; the real script inside
 * the Integration/Quick Action is expected to do its own work without
 * calling the ping operation.
 *
 * Design:
 * - Accepts any HTTP verb — validators vary in which method they use.
 * - ALWAYS returns the same WSDL body regardless of Accept/query.
 * - Permissive CORS. No auth. Zero attack surface.
 * - No caching so the timestamp in the WSDL comment is fresh per call
 *   (useful when debugging whether a request actually reached this route).
 */

const WSDL_HEADERS: Record<string, string> = {
  "Content-Type": "text/xml; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Cache-Control": "no-store",
};

function wsdlBody(method: string): string {
  const stamp = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Cloud Weaver ping WSDL. method=${method} receivedAt=${stamp} -->
<wsdl:definitions
    xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"
    xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
    xmlns:tns="http://cloudweavr.com/ping/"
    targetNamespace="http://cloudweavr.com/ping/"
    name="PingService">
  <wsdl:types>
    <xs:schema targetNamespace="http://cloudweavr.com/ping/" elementFormDefault="qualified">
      <xs:element name="Ping">
        <xs:complexType>
          <xs:sequence/>
        </xs:complexType>
      </xs:element>
      <xs:element name="PingResponse">
        <xs:complexType>
          <xs:sequence>
            <xs:element name="ok" type="xs:boolean"/>
            <xs:element name="message" type="xs:string"/>
            <xs:element name="receivedAt" type="xs:string"/>
          </xs:sequence>
        </xs:complexType>
      </xs:element>
    </xs:schema>
  </wsdl:types>
  <wsdl:message name="PingSoapIn">
    <wsdl:part name="parameters" element="tns:Ping"/>
  </wsdl:message>
  <wsdl:message name="PingSoapOut">
    <wsdl:part name="parameters" element="tns:PingResponse"/>
  </wsdl:message>
  <wsdl:portType name="PingSoap">
    <wsdl:operation name="Ping">
      <wsdl:input message="tns:PingSoapIn"/>
      <wsdl:output message="tns:PingSoapOut"/>
    </wsdl:operation>
  </wsdl:portType>
  <wsdl:binding name="PingSoap" type="tns:PingSoap">
    <soap:binding transport="http://schemas.xmlsoap.org/soap/http" style="document"/>
    <wsdl:operation name="Ping">
      <soap:operation soapAction="http://cloudweavr.com/ping/Ping"/>
      <wsdl:input>
        <soap:body use="literal"/>
      </wsdl:input>
      <wsdl:output>
        <soap:body use="literal"/>
      </wsdl:output>
    </wsdl:operation>
  </wsdl:binding>
  <wsdl:service name="PingService">
    <wsdl:port name="PingSoap" binding="tns:PingSoap">
      <soap:address location="https://threads.cloudweavr.com/api/ping"/>
    </wsdl:port>
  </wsdl:service>
</wsdl:definitions>`;
}

function respond(method: string) {
  return new NextResponse(wsdlBody(method), { status: 200, headers: WSDL_HEADERS });
}

export async function GET() {
  return respond("GET");
}

export async function POST() {
  return respond("POST");
}

export async function PUT() {
  return respond("PUT");
}

export async function DELETE() {
  return respond("DELETE");
}

export async function PATCH() {
  return respond("PATCH");
}

export async function HEAD() {
  return new NextResponse(null, { status: 200, headers: WSDL_HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Max-Age": "86400",
    },
  });
}
