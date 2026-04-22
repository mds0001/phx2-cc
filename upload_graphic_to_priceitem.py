import base64
import sys
import requests
from zeep import Client
from zeep.transports import Transport

# ==================== CONFIGURATION ====================
BASE_URL = "https://cleardata-stg.saasit.com"
TENANT = "cleardata-stg.saasit.com"
USERNAME = "mike"
PASSWORD = "Password1!"
TARGET_ROLE = "ivnt_AssetAdministrator"
ITEM_NAME = "MikeCata01"
IMAGE_FILE = "MikeCata01.jpg"
# ======================================================

WSDL_URL = f"{BASE_URL}/ServiceAPI/FRSHEATIntegration.asmx?wsdl"

print("=== Ivanti Neurons for Service - Upload Graphic to FRS_PriceItem (Fixed) ===")
print(f"Target: FRS_PriceItem where ivnt_ItemName = '{ITEM_NAME}'")
print(f"Image: {IMAGE_FILE}\n")

# 1. Load image
try:
    with open(IMAGE_FILE, "rb") as f:
        image_bytes = f.read()
    image_base64 = base64.b64encode(image_bytes).decode("ascii")
    print(f"✓ Image loaded and base64-encoded ({len(image_base64):,} characters)")
except FileNotFoundError:
    print(f"❌ ERROR: '{IMAGE_FILE}' not found in the current folder.")
    sys.exit(1)

# 2. SOAP Client
session = requests.Session()
client = Client(WSDL_URL, transport=Transport(session=session))

# 3. Connect
print("Connecting to Ivanti...")
connect_response = client.service.Connect(
    userName=USERNAME,
    password=PASSWORD,
    tenantId=TENANT,
    role=TARGET_ROLE
)

if getattr(connect_response, "connectionStatus", None) != "Success":
    print("❌ Connection failed!")
    print(connect_response)
    sys.exit(1)

session_key = connect_response.sessionKey
print("✓ Connected successfully.")

# 4. Search for existing record (most reliable method)
print(f"Searching for record with ivnt_ItemName='{ITEM_NAME}'...")
found_recid = None
try:
    search_response = client.service.FindSingleBusinessObjectByField(
        sessionKey=session_key,
        tenantId=TENANT,
        boType="FRS_PriceItem",
        fieldName="ivnt_ItemName",
        fieldValue=ITEM_NAME
    )

    if hasattr(search_response, "obj") and search_response.obj is not None:
        for field in getattr(search_response.obj, "FieldValues", []):
            if getattr(field, "Name", None) in ("RecID", "recId"):
                found_recid = field.Value
                break
        if found_recid:
            print(f"✓ Found existing record (RecID: {found_recid})")
        else:
            print("✓ Record found, but RecID extraction failed.")
    else:
        print("No existing record found → will create new one.")
except Exception as e:
    print(f"Search did not find record (normal if new): {e}")

# 5. Prepare command data
ObjectCommandData = client.get_type("ns0:ObjectCommandData")
ObjectCommandDataFieldValue = client.get_type("ns0:ObjectCommandDataFieldValue")

fields = [
    ObjectCommandDataFieldValue(Name="ivnt_ItemName", Value=ITEM_NAME),
    ObjectCommandDataFieldValue(Name="ivnt_CatalogImage", Value=image_base64),
]

command_data = ObjectCommandData(ObjectType="FRS_PriceItem", Fields=fields)

# 6. Update or Create
if found_recid:
    print("Updating existing record with graphic...")
    fields.append(ObjectCommandDataFieldValue(Name="RecID", Value=found_recid))
    command_data.Fields = fields
    response = client.service.UpdateObject(
        sessionKey=session_key,
        tenantId=TENANT,
        commandData=command_data
    )
else:
    print("Creating new FRS_PriceItem record...")
    response = client.service.CreateObject(
        sessionKey=session_key,
        tenantId=TENANT,
        commandData=command_data
    )

# 7. Check result
status = getattr(response, "status", None) or getattr(response, "Success", None)
rec_id = getattr(response, "recId", None) or getattr(response, "RecID", None)

if status == "Success" or rec_id is not None:
    print("✅ SUCCESS! The graphic has been uploaded to the FRS_PriceItem record.")
    print(f"   Record RecID: {rec_id or 'N/A'}")
else:
    print("⚠️ Operation failed or had issues:")
    print(response)

# Clean up
try:
    client.service.Disconnect(sessionKey=session_key)
except:
    pass

print("\n=== Script finished ===")