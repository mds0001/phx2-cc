# test-agent.ps1 -- Section 3 agent API tests
# Usage: .\test-agent.ps1 [-BaseUrl "https://your-url.vercel.app"]

param(
    [string]$BaseUrl = "http://localhost:3000"
)

$Token   = "14a5298aaf8d485f8a87afd5dbb505e1d184079ca5de16db"
$AgentId = $null
$ApiKey  = $null
$JobId   = $null

function Pass { param($msg) Write-Host "  PASS  $msg" -ForegroundColor Green }
function Fail { param($msg) Write-Host "  FAIL  $msg" -ForegroundColor Red }
function Skip { param($msg) Write-Host "  SKIP  $msg" -ForegroundColor Yellow }
function Step { param($msg) Write-Host "" ; Write-Host "--- $msg" -ForegroundColor Cyan }
function Info { param($msg) Write-Host "       $msg" -ForegroundColor Gray }

# ── 3.1  Register with valid token ──────────────────────────────────────────
Step "3.1  Register with valid token"
$body = '{"token":"' + $Token + '","name":"Test Agent","version":"0.1.0","platform":"windows"}'
try {
    $r = Invoke-RestMethod -Method POST -Uri "$BaseUrl/api/agent/register" -ContentType "application/json" -Body $body
    $AgentId = $r.agent_id
    $ApiKey  = $r.api_key
    Info "agent_id : $AgentId"
    Info "api_key  : $($ApiKey.Substring(0,8))..."
    if ($AgentId -and $ApiKey) { Pass "Got agent_id and api_key" }
    else { Fail "Missing agent_id or api_key in response" }
} catch {
    Fail "HTTP error -- $($_.Exception.Message)"
}

# ── 3.2  Register with already-used token ──────────────────────────────────
Step "3.2  Register with already-used token -- expect 401"
try {
    Invoke-RestMethod -Method POST -Uri "$BaseUrl/api/agent/register" -ContentType "application/json" -Body $body | Out-Null
    Fail "Should have returned 401 but got 200"
} catch {
    $code = [int]$_.Exception.Response.StatusCode
    if ($code -eq 401) { Pass "Correctly rejected used token -- 401" }
    else { Fail "Expected 401 got $code" }
}

# ── 3.4  Heartbeat with valid credentials ──────────────────────────────────
Step "3.4  Heartbeat with valid credentials"
if (-not $AgentId) { Skip "No agent_id -- 3.1 failed" }
else {
    $hbBody = '{"status":"online"}'
    $hbHeaders = @{ "X-Agent-Id" = $AgentId; "X-Agent-Key" = $ApiKey }
    try {
        $r = Invoke-RestMethod -Method POST -Uri "$BaseUrl/api/agent/heartbeat" -ContentType "application/json" -Body $hbBody -Headers $hbHeaders
        if ($null -ne $r.jobs) { Pass "Got jobs array -- count $($r.jobs.Count)" }
        else { Fail "No jobs array in response" }
    } catch {
        Fail "HTTP error -- $($_.Exception.Message)"
    }
}

# ── 3.5  Heartbeat with wrong key ──────────────────────────────────────────
Step "3.5  Heartbeat with wrong key -- expect 401"
if (-not $AgentId) { Skip "No agent_id -- 3.1 failed" }
else {
    $badHeaders = @{ "X-Agent-Id" = $AgentId; "X-Agent-Key" = "wrongkey" }
    try {
        Invoke-RestMethod -Method POST -Uri "$BaseUrl/api/agent/heartbeat" -ContentType "application/json" -Body '{"status":"online"}' -Headers $badHeaders | Out-Null
        Fail "Should have returned 401 but got 200"
    } catch {
        $code = [int]$_.Exception.Response.StatusCode
        if ($code -eq 401) { Pass "Correctly rejected bad key -- 401" }
        else { Fail "Expected 401 got $code" }
    }
}

# ── 3.6  Insert pending job then heartbeat ──────────────────────────────────
Step "3.6  Pending job returned in heartbeat"
Write-Host ""
Write-Host "  ACTION: In Supabase insert a row into agent_jobs:" -ForegroundColor Yellow
Write-Host "    agent_id  =  $AgentId" -ForegroundColor Yellow
Write-Host "    status    =  pending" -ForegroundColor Yellow
Write-Host "    payload   =  {}" -ForegroundColor Yellow
Write-Host ""
Read-Host "  Press Enter when done"

if (-not $AgentId) { Skip "No agent_id -- 3.1 failed" }
else {
    $hbHeaders = @{ "X-Agent-Id" = $AgentId; "X-Agent-Key" = $ApiKey }
    try {
        $r = Invoke-RestMethod -Method POST -Uri "$BaseUrl/api/agent/heartbeat" -ContentType "application/json" -Body '{"status":"online"}' -Headers $hbHeaders
        if ($r.jobs.Count -gt 0) {
            $JobId = $r.jobs[0].id
            Info "job_id : $JobId"
            Pass "Pending job returned and marked running"
        } else {
            Fail "No jobs returned -- check the row was inserted correctly"
        }
    } catch {
        Fail "HTTP error -- $($_.Exception.Message)"
    }
}

# ── 3.7  Job complete -- success ────────────────────────────────────────────
Step "3.7  Job complete -- success"
if (-not $JobId) { Skip "No job_id -- 3.6 failed" }
else {
    $jcHeaders = @{ "X-Agent-Id" = $AgentId; "X-Agent-Key" = $ApiKey }
    $jcBody = '{"job_id":"' + $JobId + '","status":"completed","result":{"rows_extracted":100,"rows_sent":100,"duration_ms":4200}}'
    try {
        $r = Invoke-RestMethod -Method POST -Uri "$BaseUrl/api/agent/job-complete" -ContentType "application/json" -Body $jcBody -Headers $jcHeaders
        if ($r.ok) { Pass "Job marked completed" }
        else { Fail "Unexpected response" }
    } catch {
        Fail "HTTP error -- $($_.Exception.Message)"
    }
}

# ── 3.9  Data route -- no destination ──────────────────────────────────────
Step "3.9  Data route -- small payload"
Write-Host ""
Write-Host "  ACTION: In Supabase insert another row into agent_jobs:" -ForegroundColor Yellow
Write-Host "    agent_id  =  $AgentId" -ForegroundColor Yellow
Write-Host "    status    =  running" -ForegroundColor Yellow
Write-Host "    payload   =  {}" -ForegroundColor Yellow
Write-Host ""
$newJobId = Read-Host "  Paste the new job_id"

if (-not $newJobId) { Skip "No job_id provided" }
else {
    $dataHeaders = @{ "X-Agent-Id" = $AgentId; "X-Agent-Key" = $ApiKey }
    $dataBody = '{"job_id":"' + $newJobId + '","chunk_index":0,"total_chunks":1,"rows":[{"AssetTag":"PC-001","Name":"Test PC 1"},{"AssetTag":"PC-002","Name":"Test PC 2"},{"AssetTag":"PC-003","Name":"Test PC 3"}]}'
    try {
        $r = Invoke-RestMethod -Method POST -Uri "$BaseUrl/api/agent/data" -ContentType "application/json" -Body $dataBody -Headers $dataHeaders
        if ($r.rows_accepted -eq 3) { Pass "3 rows accepted" }
        else { Fail "Expected rows_accepted=3 got $($r.rows_accepted)" }
    } catch {
        Fail "HTTP error -- $($_.Exception.Message)"
    }
}

# ── Summary ─────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Section 3 complete. Verify in Supabase:" -ForegroundColor Cyan
Write-Host "  - agents row: status=online, last_seen updated" -ForegroundColor Cyan
Write-Host "  - agent_jobs: status=completed for $JobId" -ForegroundColor Cyan
Write-Host "  - task_logs:  AGENT_CHUNK entry written" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
