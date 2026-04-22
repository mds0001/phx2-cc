# One Shot — Ivanti Catalog Image Writer

Standalone script to write a single JPEG directly to `ivnt_CatalogImage` on an Ivanti ISM SaaS record via SOAP.

## Connection Info

| Field      | Value                             |
|------------|-----------------------------------|
| URL        | https://cleardata-stg.saasit.com  |
| Tenant ID  | cleardata-stg.saasit.com          |
| Login      | mike                              |
| Password   | Password1!                        |
| Auth Type  | Internal                          |
| Role       | ivnt_AssetAdministrator           |

## Target Record

| Field        | Value              |
|--------------|--------------------|
| BO Name      | FRS_PriceItem#     |
| Key Field    | ItemName           |
| Key Value    | MikeCata01         |
| Image Field  | ivnt_CatalogImage  |

## Usage

Save the image you want to upload somewhere on disk, then run:

```bash
cd C:\Users\mdsto\projects\phx2
python one_shot.py "C:\path\to\your\image.jpeg"
```

## What it does

1. SOAP `Connect` → get session key
2. OData GET → resolve `ItemName = 'MikeCata01'` → `RecId`
3. SOAP `SaveDataExecuteAction` → write base64-encoded image to `ivnt_CatalogImage`
4. OData GET → verify field was written

## Script

See `one_shot.py` in the same folder.
