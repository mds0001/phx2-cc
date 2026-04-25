# One Shot — Key Learnings

## What We Were Trying to Do

Write a JPEG image to the `ivnt_CatalogImage` field on an Ivanti ISM SaaS record (`FRS_PriceItem#`, `ItemName=MikeCata01`) using a standalone Python script.

---

## Dead Ends (What Did Not Work)

### 1. Web Upload Handler (`UploadImageHandler.ashx`)
The browser UI uploads images by:
1. Posting a multipart file to `/handlers/SessionStorage/UploadImageHandler.ashx` → gets a temp GUID back
2. Writing that GUID to the image field via a SOAP save call

We tried to replicate this pipeline. It failed at the upload step with **HTTP 551** ("session expired") every time.

**Why it failed:**
- 551 is Ivanti's custom "session invalid" code. The handler clears `SID` and `SA` cookies on the response, meaning it rejected the session before even checking the file.
- The handler requires cookies established by the Ivanti JavaScript SPA (`Ext.Frs.SessionController`), which calls `InitializeSession` and sets `Session.CsrfToken` — a token that must be echoed back as a hidden form field in the upload POST. This token is only available after the SPA boots in a real browser. It cannot be obtained by scraping HTML pages.
- `/Admin/` (where the tenant-app session was expected to be established) returns 404 on this tenant.
- The `AFT` cookie is not the right CSRF token for the upload handler.

**Lesson:** Don't try to replicate the browser's upload handler path from Python. The Ivanti SPA session lifecycle is not replicable without executing JavaScript.

### 2. OData REST API with SOAP Session Key
We tried using the SOAP `sessionKey` as a Bearer token against the OData REST API (`/api/odata/businessobject/...`).

**Why it failed:**
- OData returns **HTTP 401** ("Invalid Session key or Authentication token or Host") regardless of auth header format tried (Bearer, Token, Basic, X-Session-Key, etc.).
- The OData API authenticates via web session **cookies** (`SA`, `SID`), not the SOAP session key. Adding a Bearer token header actually breaks it even when valid cookies are present.

**Lesson:** SOAP session keys and OData session cookies are separate auth systems. Do not mix them.

### 3. `SaveDataExecuteAction` SOAP Method
The original script used `SaveDataExecuteAction` as its SOAP save method.

**Why it failed:**
- This method does not exist in the WSDL for this tenant's endpoint (`/ServiceAPI/FRSHEATIntegration.asmx`).
- The server returns HTTP 500: "Server did not recognize the value of HTTP Header SOAPAction."

**Lesson:** Always verify method names against the actual WSDL before writing SOAP calls.

### 4. `FetchData` SOAP Method
Tried as an alternative RecId lookup.

**Why it failed:** Also not in the WSDL. Same 500 error.

---

## What Worked — The Correct Strategy

### Rule 1: Read the WSDL First
Fetch `?WSDL` from the SOAP endpoint and enumerate the actual `<wsdl:operation>` names before writing any envelope. Every method name assumption was wrong until we did this.

```
GET https://{tenant}/ServiceAPI/FRSHEATIntegration.asmx?WSDL
```

The real methods on this tenant:
- `Connect` — authenticate, get sessionKey
- `FindSingleBusinessObjectByField` — look up a record by field/value, returns RecId
- `UpdateObject` — update fields on a record by RecId
- `UpsertObject` — update or create
- `AddAttachment` — attach a file to a record

### Rule 2: Use SOAP for Everything (No Web Session Needed)
The SOAP session key works for all SOAP methods. OData is a separate auth system. If you stay in SOAP, you never need a web login.

**RecId lookup via SOAP (not OData):**
```xml
<tns:FindSingleBusinessObjectByField>
  <tns:sessionKey>{key}</tns:sessionKey>
  <tns:tenantId>{tenant}</tns:tenantId>
  <tns:boType>FRS_PriceItem#</tns:boType>
  <tns:fieldName>ItemName</tns:fieldName>
  <tns:fieldValue>MikeCata01</tns:fieldValue>
</tns:FindSingleBusinessObjectByField>
```
Returns `WebServiceBusinessObject` with `RecID`.

### Rule 3: Use `BinaryData` for Image Fields
`ObjectCommandDataFieldValue` (used inside `UpdateObject`) has three value types:
- `Value` — plain string
- `BinaryData` — xs:base64Binary (use this for image/binary fields)
- `HtmlValue` — HTML string

For `ivnt_CatalogImage`, write the base64-encoded JPEG into `BinaryData`. Ivanti handles the storage internally and stores a compact reference value in the field.

**Write image via SOAP:**
```xml
<tns:UpdateObject>
  <tns:sessionKey>{key}</tns:sessionKey>
  <tns:tenantId>{tenant}</tns:tenantId>
  <tns:commandData>
    <tns:ObjectId>{recId}</tns:ObjectId>
    <tns:ObjectType>FRS_PriceItem#</tns:ObjectType>
    <tns:Fields>
      <tns:ObjectCommandDataFieldValue>
        <tns:Name>ivnt_CatalogImage</tns:Name>
        <tns:BinaryData>{base64-encoded JPEG}</tns:BinaryData>
      </tns:ObjectCommandDataFieldValue>
    </tns:Fields>
  </tns:commandData>
</tns:UpdateObject>
```

### Rule 4: OData Works — But Cookie-Only
If you do need OData (e.g., for querying), authenticate via web session cookies. Do **not** send an Authorization header — it breaks the request.

```python
# After web login (SA + SID cookies in session):
resp = session.get(odata_url, headers={"Accept": "application/json"})
# No Authorization header — cookies carry the auth
```

---

## Final Working Pipeline

```
1. SOAP Connect                          → sessionKey
2. SOAP FindSingleBusinessObjectByField  → RecId
3. base64.b64encode(image_bytes)         → b64 string
4. SOAP UpdateObject (BinaryData=b64)    → write ivnt_CatalogImage
5. SOAP FindSingleBusinessObjectByField  → verify field non-empty
```

No web login. No upload handler. No OData. ~150 lines of Python.

---

## Ivanti ISM SaaS Auth Quick Reference

| System | Auth mechanism | Notes |
|--------|---------------|-------|
| SOAP API (`/ServiceAPI/...`) | `sessionKey` from `Connect` | In envelope, not HTTP header |
| OData REST (`/api/odata/...`) | Web session cookies (`SA`, `SID`) | No Bearer token — it breaks |
| Upload handler (`/handlers/...`) | Web session + SPA CSRF token | Avoid from Python |
| OData + Bearer token | **Does not work** | 401 always |
