#!/usr/bin/env python3
"""
one_shot.py -- Write a JPEG to ivnt_CatalogImage on an Ivanti ISM SaaS record.

Pipeline (pure SOAP, no web session required):
    1. SOAP Connect                          -> sessionKey
    2. SOAP FindSingleBusinessObjectByField  -> RecId for ItemName='MikeCata01'
    3. Base64-encode the JPEG
    4. SOAP UpdateObject                     -> write ivnt_CatalogImage (BinaryData)
    5. SOAP FindSingleBusinessObjectByField  -> verify field is non-empty

Usage:
    python one_shot.py <path_to_image.jpeg>
"""

import base64
import os
import sys
import xml.etree.ElementTree as ET

import requests

# ── Config ────────────────────────────────────────────────────────────────────
BASE_URL  = "https://cleardata-stg.saasit.com"
TENANT    = "cleardata-stg.saasit.com"
USERNAME  = "mike"
PASSWORD  = "Password1!"
ROLE      = "ivnt_AssetAdministrator"

SOAP_URL  = f"{BASE_URL}/ServiceAPI/FRSHEATIntegration.asmx"

BO_NAME     = "FRS_PriceItem#"
ITEM_NAME   = "MikeCata01"
IMAGE_FIELD = "ivnt_CatalogImage"

SOAP_NS = "SaaS.Services"
UA      = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
           "AppleWebKit/537.36 (KHTML, like Gecko) "
           "Chrome/124.0.0.0 Safari/537.36")

# ── Helpers ───────────────────────────────────────────────────────────────────
def xml_escape(s: str) -> str:
    return (s.replace("&", "&amp;").replace("<", "&lt;")
             .replace(">", "&gt;").replace('"', "&quot;")
             .replace("'", "&apos;"))


def die(stage: str, resp=None, extra: str = ""):
    print(f"\n[X] FAILED at: {stage}")
    if resp is not None:
        print(f"    HTTP {resp.status_code}  url={resp.url}")
        print(f"    Body (first 2000):\n{(resp.text or '')[:2000]}")
    if extra:
        print(f"    {extra}")
    sys.exit(1)


def soap_post(session: requests.Session, action: str, envelope: str) -> ET.Element:
    resp = session.post(
        SOAP_URL,
        data=envelope.encode("utf-8"),
        headers={
            "Content-Type": "text/xml; charset=utf-8",
            "SOAPAction":   f'"SaaS.Services/{action}"',
            "User-Agent":   UA,
        },
        timeout=60,
    )
    if not resp.ok:
        die(f"SOAP {action}", resp)
    try:
        root = ET.fromstring(resp.text)
    except ET.ParseError as exc:
        die(f"SOAP {action} parse", extra=f"{exc}\n{resp.text[:1000]}")
    # Surface SOAP faults
    fault = root.findtext(".//{http://schemas.xmlsoap.org/soap/envelope/}faultstring")
    if fault:
        die(f"SOAP {action}", extra=f"Fault: {fault}")
    return root


# ── Step 1: Connect ───────────────────────────────────────────────────────────
def soap_connect(session: requests.Session) -> str:
    print("[1] SOAP Connect ...")
    root = soap_post(session, "Connect", (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"'
        ' xmlns:tns="SaaS.Services"><soap:Body><tns:Connect>'
        f"<tns:userName>{xml_escape(USERNAME)}</tns:userName>"
        f"<tns:password>{xml_escape(PASSWORD)}</tns:password>"
        f"<tns:tenantId>{xml_escape(TENANT)}</tns:tenantId>"
        f"<tns:role>{xml_escape(ROLE)}</tns:role>"
        "</tns:Connect></soap:Body></soap:Envelope>"
    ))
    status = root.findtext(f".//{{{SOAP_NS}}}connectionStatus")
    key    = root.findtext(f".//{{{SOAP_NS}}}sessionKey")
    if status != "Success" or not key:
        die("SOAP Connect", extra=f"connectionStatus={status!r}  sessionKey={key!r}")
    print(f"    sessionKey = {key}")
    return key


# ── Step 2: FindSingleBusinessObjectByField → RecId ───────────────────────────
def find_rec_id(session: requests.Session, key: str) -> str:
    print(f"\n[2] FindSingleBusinessObjectByField: ItemName='{ITEM_NAME}' ...")
    root = soap_post(session, "FindSingleBusinessObjectByField", (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"'
        ' xmlns:tns="SaaS.Services"><soap:Body>'
        "<tns:FindSingleBusinessObjectByField>"
        f"<tns:sessionKey>{xml_escape(key)}</tns:sessionKey>"
        f"<tns:tenantId>{xml_escape(TENANT)}</tns:tenantId>"
        f"<tns:boType>{xml_escape(BO_NAME)}</tns:boType>"
        "<tns:fieldName>ItemName</tns:fieldName>"
        f"<tns:fieldValue>{xml_escape(ITEM_NAME)}</tns:fieldValue>"
        "</tns:FindSingleBusinessObjectByField>"
        "</soap:Body></soap:Envelope>"
    ))
    status = root.findtext(f".//{{{SOAP_NS}}}status")
    reason = root.findtext(f".//{{{SOAP_NS}}}exceptionReason") or ""
    rec_id = root.findtext(f".//{{{SOAP_NS}}}RecID")
    if status != "Success" or not rec_id:
        die("FindSingleBusinessObjectByField",
            extra=f"status={status!r}  reason={reason!r}  RecID={rec_id!r}")
    print(f"    status = {status}  RecId = {rec_id}")
    return rec_id


# ── Steps 3+4: Base64-encode then UpdateObject ────────────────────────────────
def write_image(session: requests.Session, key: str,
                rec_id: str, image_path: str) -> None:
    print(f"\n[3] Base64-encoding {image_path} ...")
    with open(image_path, "rb") as fh:
        b64 = base64.b64encode(fh.read()).decode("ascii")
    print(f"    encoded length = {len(b64):,} chars")

    print(f"\n[4] SOAP UpdateObject -> {IMAGE_FIELD} ...")
    field_xml = (
        "<tns:ObjectCommandDataFieldValue>"
        f"<tns:Name>{xml_escape(IMAGE_FIELD)}</tns:Name>"
        f"<tns:BinaryData>{b64}</tns:BinaryData>"
        "</tns:ObjectCommandDataFieldValue>"
    )
    root = soap_post(session, "UpdateObject", (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"'
        ' xmlns:tns="SaaS.Services"><soap:Body><tns:UpdateObject>'
        f"<tns:sessionKey>{xml_escape(key)}</tns:sessionKey>"
        f"<tns:tenantId>{xml_escape(TENANT)}</tns:tenantId>"
        "<tns:commandData>"
        f"<tns:ObjectId>{xml_escape(rec_id)}</tns:ObjectId>"
        f"<tns:ObjectType>{xml_escape(BO_NAME)}</tns:ObjectType>"
        f"<tns:Fields>{field_xml}</tns:Fields>"
        "</tns:commandData>"
        "</tns:UpdateObject></soap:Body></soap:Envelope>"
    ))
    status = root.findtext(f".//{{{SOAP_NS}}}status")
    reason = root.findtext(f".//{{{SOAP_NS}}}exceptionReason") or ""
    print(f"    status = {status!r}  reason = {reason!r}")
    if status != "Success":
        raw = ET.tostring(root, encoding="unicode")
        die("UpdateObject", extra=f"status={status!r}  reason={reason!r}\n{raw[:1000]}")


# ── Step 5: Verify via FindSingleBusinessObjectByField ────────────────────────
def verify(session: requests.Session, key: str, rec_id: str) -> None:
    print(f"\n[5] Verify: re-fetch {IMAGE_FIELD} ...")
    root = soap_post(session, "FindSingleBusinessObjectByField", (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"'
        ' xmlns:tns="SaaS.Services"><soap:Body>'
        "<tns:FindSingleBusinessObjectByField>"
        f"<tns:sessionKey>{xml_escape(key)}</tns:sessionKey>"
        f"<tns:tenantId>{xml_escape(TENANT)}</tns:tenantId>"
        f"<tns:boType>{xml_escape(BO_NAME)}</tns:boType>"
        "<tns:fieldName>RecID</tns:fieldName>"
        f"<tns:fieldValue>{xml_escape(rec_id)}</tns:fieldValue>"
        "</tns:FindSingleBusinessObjectByField>"
        "</soap:Body></soap:Envelope>"
    ))
    # Walk FieldValues looking for ivnt_CatalogImage
    val = ""
    for fv in root.iter(f"{{{SOAP_NS}}}WebServiceFieldValue"):
        name  = fv.findtext(f"{{{SOAP_NS}}}Name") or ""
        value = fv.findtext(f"{{{SOAP_NS}}}Value") or ""
        if name == IMAGE_FIELD:
            val = value
            break
    # Also check BinaryData on the field
    if not val:
        for fv in root.iter(f"{{{SOAP_NS}}}WebServiceFieldValue"):
            name = fv.findtext(f"{{{SOAP_NS}}}Name") or ""
            if name == IMAGE_FIELD:
                val = fv.findtext(f"{{{SOAP_NS}}}BinaryValue") or ""
                break

    print(f"    {IMAGE_FIELD} length = {len(val)}")
    print(f"    preview: {val[:120]}")
    if not val:
        # Print full raw response for debugging
        print(f"    Full response:\n{ET.tostring(root, encoding='unicode')[:3000]}")
        die("Verify", extra=f"{IMAGE_FIELD} is still empty after save.")
    print("\n[+] SUCCESS -- ivnt_CatalogImage is populated.")


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    if len(sys.argv) < 2:
        print("Usage: python one_shot.py <path_to_image.jpeg>")
        sys.exit(1)
    image_path = sys.argv[1]
    if not os.path.isfile(image_path):
        print(f"[X] File not found: {image_path}")
        sys.exit(1)

    print(f"[+] Tenant : {TENANT}")
    print(f"[+] Record : {BO_NAME}  ItemName='{ITEM_NAME}'")
    print(f"[+] Field  : {IMAGE_FIELD}")
    print(f"[+] Image  : {image_path}  ({os.path.getsize(image_path):,} bytes)")

    session = requests.Session()
    key     = soap_connect(session)
    rec_id  = find_rec_id(session, key)
    write_image(session, key, rec_id, image_path)
    verify(session, key, rec_id)


if __name__ == "__main__":
    main()
