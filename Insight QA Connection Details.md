# Insight QA Connection Details

## Credentials

| Field | Value |
|---|---|
| Key (client_id) | Fa9iSboRSC4N7Z5a1Maaxf4yHYko39Jk |
| Secret (client_secret) | WAeG3xsQVPQm7qgH |
| ClientID (payload header) | 9373908 |

## Endpoints

| Name | URL |
|---|---|
| OAuth Token | `https://insight-qa2.test01.apimanagement.us20.hana.ondemand.com/oauth/token?grant_type=client_credentials` |
| Customer Invoice | `https://insight-qa2.test01.apimanagement.us20.hana.ondemand.com/NA/CustomerInvoice` |
| Status | `https://insight-qa2.test01.apimanagement.us20.hana.ondemand.com/NA/GetStatus` |

## Notes

- OAuth grant type: `client_credentials`
- Basic Auth header: `base64(client_id:client_secret)`
- `ClientID` must be sent as a request header on CustomerInvoice calls
- QA environment only — do not use in production
