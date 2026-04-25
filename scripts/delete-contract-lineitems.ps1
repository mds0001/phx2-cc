$IVANTI = "https://cleardata-stg.saasit.com"
$KEY    = "251E668B0B42478EB3DA9D6E8446CA0B"

$headers = @{
    "Authorization" = "rest_api_key=$KEY"
    "Accept"        = "application/json"
}

$SUBTYPES = @(
    "ivnt_Entitlement",
    "ivnt_ExtendedWarranty",
    "ivnt_Lease",
    "ivnt_Maintenance",
    "ivnt_NDA",
    "ivnt_Purchase",
    "ivnt_Service",
    "ivnt_Support",
    "ivnt_VolumePurchase"
)

$deleted = 0; $notFound = 0; $errors = 0

foreach ($subtype in $SUBTYPES) {
    # Build URL with %23 but send via HttpWebRequest to avoid PowerShell re-encoding
    $rawUrl  = "$IVANTI/api/odata/businessobject/ivnt_ContractLineItem%23$subtype`?`$select=RecId,DisplayName&`$top=50"
    Write-Host "`n--- $subtype ---"

    try {
        $req = [System.Net.HttpWebRequest]::Create($rawUrl)
        $req.Method  = "GET"
        $req.Headers.Add("Authorization", "rest_api_key=$KEY")
        $req.Accept  = "application/json"

        $resp   = $req.GetResponse()
        $stream = $resp.GetResponseStream()
        $reader = [System.IO.StreamReader]::new($stream)
        $body   = $reader.ReadToEnd()
        $reader.Close(); $resp.Close()

        $data    = $body | ConvertFrom-Json
        $records = $data.value
        Write-Host "  Found $($records.Count) record(s)"
    } catch {
        Write-Host "  LIST error: $_"
        $errors++
        continue
    }

    foreach ($rec in $records) {
        $recId  = $rec.RecId
        $name   = if ($rec.DisplayName) { $rec.DisplayName } else { $recId }
        $delRaw = "$IVANTI/api/odata/businessobject/ivnt_ContractLineItem%23$subtype('$recId')"

        try {
            $delReq = [System.Net.HttpWebRequest]::Create($delRaw)
            $delReq.Method = "DELETE"
            $delReq.Headers.Add("Authorization", "rest_api_key=$KEY")
            $delReq.Accept = "application/json"

            $delResp = $delReq.GetResponse()
            $code    = [int]$delResp.StatusCode
            $delResp.Close()

            Write-Host "  [$code] Deleted `"$name`" ($recId)"
            $deleted++
        } catch [System.Net.WebException] {
            $code = [int]$_.Exception.Response.StatusCode
            if ($code -eq 404) {
                Write-Host "  [404] Not found `"$name`" ($recId)"
                $notFound++
            } else {
                Write-Host "  [ERR $code] `"$name`": $_"
                $errors++
            }
        } catch {
            Write-Host "  [ERR] `"$name`": $_"
            $errors++
        }
    }
}

Write-Host "`nDone - Deleted: $deleted | Not found: $notFound | Errors: $errors"
