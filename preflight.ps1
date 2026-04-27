# preflight.ps1
# Verifies the system is ready for the 24-hour Habit RPG overnight build.
# Exit 0 = ready to launch. Exit 1 = something is broken; fix before starting.
#
# Usage:
#   cd C:\projects\habit-rpg
#   .\preflight.ps1
#
# Or to skip the live API checks (faster, does not burn quota):
#   .\preflight.ps1 -SkipApiChecks

param(
    [switch]$SkipApiChecks
)

$ErrorActionPreference = "Continue"
$script:failures = @()
$script:warnings = @()

function Write-Check {
    param($Name, $Status, $Detail = "")
    $icon = switch ($Status) {
        "ok" { "[ OK ]" }
        "fail" { "[FAIL]" }
        "warn" { "[WARN]" }
    }
    $color = switch ($Status) {
        "ok" { "Green" }
        "fail" { "Red" }
        "warn" { "Yellow" }
    }
    Write-Host "$icon  $Name" -ForegroundColor $color -NoNewline
    if ($Detail) { Write-Host "  ($Detail)" -ForegroundColor DarkGray }
    else { Write-Host "" }
}

function Test-CommandExists {
    param($Cmd)
    $null = Get-Command $Cmd -ErrorAction SilentlyContinue
    return $?
}

Write-Host ""
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "  Habit RPG - Overnight Build Preflight" -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------------
# 1. Core tools on PATH
# ---------------------------------------------------------------
Write-Host "Core tools" -ForegroundColor White

if (Test-CommandExists "node") {
    $nodeVersion = (node --version) -replace '^v', ''
    $major = [int]($nodeVersion.Split('.')[0])
    if ($major -ge 22) {
        Write-Check "node" "ok" "v$nodeVersion"
    }
    elseif ($major -ge 20) {
        Write-Check "node" "warn" "v$nodeVersion - Codex needs 22+, may fail"
        $script:warnings += "Node $nodeVersion is below Codex minimum of 22"
    }
    else {
        Write-Check "node" "fail" "v$nodeVersion - too old, need 22+"
        $script:failures += "Node.js too old (need 22+)"
    }
}
else {
    Write-Check "node" "fail" "not on PATH"
    $script:failures += "Node.js not installed or not on PATH"
}

if (Test-CommandExists "npm") {
    Write-Check "npm" "ok" (npm --version)
}
else {
    Write-Check "npm" "fail" "not on PATH"
    $script:failures += "npm not on PATH"
}

if (Test-CommandExists "git") {
    Write-Check "git" "ok" ((git --version) -replace 'git version ', '')
}
else {
    Write-Check "git" "fail" "not on PATH"
    $script:failures += "Git not installed"
}

if (Test-CommandExists "gh") {
    Write-Check "gh" "ok" ((gh --version | Select-Object -First 1) -replace 'gh version ', '')
}
else {
    Write-Check "gh" "warn" "GitHub CLI not installed (recommended)"
    $script:warnings += "gh not installed - agents can still push via git, but PR/Actions checks will be manual"
}

# Git Bash for Claude Code
$gitBash = "C:\Program Files\Git\bin\bash.exe"
if (Test-Path $gitBash) {
    Write-Check "Git Bash" "ok" $gitBash
}
else {
    Write-Check "Git Bash" "warn" "not at default path"
    $script:warnings += "Git Bash not at C:\Program Files\Git\bin\bash.exe - set CLAUDE_CODE_GIT_BASH_PATH in ~/.claude/settings.json"
}

Write-Host ""

# ---------------------------------------------------------------
# 2. AI CLIs installed
# ---------------------------------------------------------------
Write-Host "AI CLIs" -ForegroundColor White

if (Test-CommandExists "claude") {
    $cv = (claude --version 2>&1)
    Write-Check "claude" "ok" $cv
}
else {
    Write-Check "claude" "fail" "not on PATH"
    $script:failures += "Claude Code not installed or PATH issue (try: irm https://claude.ai/install.ps1 | iex)"
}

if (Test-CommandExists "codex") {
    $cxv = (codex --version 2>&1)
    Write-Check "codex" "ok" $cxv
}
else {
    Write-Check "codex" "fail" "not on PATH"
    $script:failures += "Codex CLI not installed (try: npm install -g @openai/codex)"
}

if (Test-CommandExists "gemini") {
    $gv = (gemini --version 2>&1)
    Write-Check "gemini" "ok" $gv
}
else {
    Write-Check "gemini" "warn" "not on PATH (tiebreaker only - not fatal)"
    $script:warnings += "Gemini CLI not installed - orchestration will fall back to Claude own decision on disagreements"
}

Write-Host ""

# ---------------------------------------------------------------
# 3. Auth files present
# ---------------------------------------------------------------
Write-Host "Authentication" -ForegroundColor White

$claudeAuthDir = "$env:USERPROFILE\.claude"
if (Test-Path $claudeAuthDir) {
    Write-Check "Claude auth dir" "ok" $claudeAuthDir
}
else {
    Write-Check "Claude auth dir" "fail" "missing - run 'claude' once to authenticate"
    $script:failures += "Claude Code not authenticated"
}

$codexAuthFile = "$env:USERPROFILE\.codex\auth.json"
$codexApiKey = $null
if ($env:OPENAI_API_KEY) { $codexApiKey = $env:OPENAI_API_KEY }
elseif ($env:CODEX_API_KEY) { $codexApiKey = $env:CODEX_API_KEY }

if (Test-Path $codexAuthFile) {
    Write-Check "Codex auth.json" "ok" "ChatGPT login persisted"
}
elseif ($codexApiKey) {
    Write-Check "Codex API key" "ok" "OPENAI_API_KEY set"
}
else {
    Write-Check "Codex auth" "fail" "no auth.json and no OPENAI_API_KEY"
    $script:failures += "Codex not authenticated - run 'codex' once or set OPENAI_API_KEY"
}

$geminiAuthDir = "$env:USERPROFILE\.gemini"
if (Test-CommandExists "gemini") {
    if (Test-Path $geminiAuthDir) {
        Write-Check "Gemini auth dir" "ok" $geminiAuthDir
    }
    elseif ($env:GEMINI_API_KEY) {
        Write-Check "Gemini API key" "ok" "GEMINI_API_KEY set"
    }
    else {
        Write-Check "Gemini auth" "warn" "not authenticated - tiebreaker calls will fail"
        $script:warnings += "Gemini not authenticated - run 'gemini' once or set GEMINI_API_KEY"
    }
}

Write-Host ""

# ---------------------------------------------------------------
# 4. Live API check (round-trip a real call)
# ---------------------------------------------------------------
if (-not $SkipApiChecks) {
    Write-Host "Live API round-trip (small call to each)" -ForegroundColor White

    if (Test-CommandExists "claude") {
        try {
            $reply = claude -p "Reply with exactly the word: PONG" 2>&1 | Out-String
            if ($reply -match "PONG") {
                Write-Check "Claude round-trip" "ok" "responded"
            }
            else {
                Write-Check "Claude round-trip" "warn" "responded but not as expected"
                $script:warnings += "Claude responded but did not echo PONG - check it is actually working"
            }
        }
        catch {
            Write-Check "Claude round-trip" "fail" $_.Exception.Message
            $script:failures += "Claude API call failed: $_"
        }
    }

    if (Test-CommandExists "codex") {
        try {
            $reply = codex exec --skip-git-repo-check "Reply with exactly the word: PONG" 2>&1 | Out-String
            if ($reply -match "PONG") {
                Write-Check "Codex round-trip" "ok" "responded"
            }
            else {
                Write-Check "Codex round-trip" "warn" "responded but not as expected"
                $script:warnings += "Codex responded but did not echo PONG - check output above"
            }
        }
        catch {
            Write-Check "Codex round-trip" "fail" $_.Exception.Message
            $script:failures += "Codex API call failed: $_"
        }
    }

    if (Test-CommandExists "gemini") {
        try {
            $reply = gemini -p "Reply with exactly the word: PONG" 2>&1 | Out-String
            if ($reply -match "PONG") {
                Write-Check "Gemini round-trip" "ok" "responded"
            }
            else {
                Write-Check "Gemini round-trip" "warn" "responded but not as expected"
            }
        }
        catch {
            Write-Check "Gemini round-trip" "warn" "call failed (tiebreaker only)"
        }
    }

    Write-Host ""
}
else {
    Write-Host "Live API checks skipped (-SkipApiChecks flag set)" -ForegroundColor DarkGray
    Write-Host ""
}

# ---------------------------------------------------------------
# 5. Project repo state
# ---------------------------------------------------------------
Write-Host "Project repo" -ForegroundColor White

if (Test-Path ".git") {
    Write-Check "Git repo" "ok" (Get-Location).Path
}
else {
    Write-Check "Git repo" "fail" "current dir is not a git repo"
    $script:failures += "Run preflight from inside the cloned habit-rpg repo"
}

$gitUserName = git config user.name 2>$null
$gitUserEmail = git config user.email 2>$null
if ($gitUserName -and $gitUserEmail) {
    Write-Check "Git identity" "ok" "$gitUserName <$gitUserEmail>"
}
else {
    Write-Check "Git identity" "fail" "user.name or user.email not set"
    $script:failures += "Set git config: git config --global user.name 'Your Name'; git config --global user.email 'you@example.com'"
}

$remote = git remote get-url origin 2>$null
if ($remote) {
    Write-Check "Git remote" "ok" $remote
}
else {
    Write-Check "Git remote" "fail" "no 'origin' remote"
    $script:failures += "Add a remote: git remote add origin https://github.com/<you>/habit-rpg.git"
}

# Check the planning docs are present
$requiredDocs = @("01_KICKOFF.md", "02_DESIGN_DAY1.md", "03_ORCHESTRATION.md", "04_PHASE_PLAN.md")
$missingDocs = $requiredDocs | Where-Object { -not (Test-Path $_) }
if ($missingDocs.Count -eq 0) {
    Write-Check "Planning docs" "ok" "all 4 present"
}
else {
    Write-Check "Planning docs" "fail" ("missing: " + ($missingDocs -join ', '))
    $script:failures += "Planning docs not in repo root - copy them in and commit"
}

# Optional: GitHub Pages enabled (best-effort via gh)
if ((Test-CommandExists "gh") -and $remote) {
    try {
        $repoInfo = gh repo view --json name, owner 2>$null | ConvertFrom-Json
        if ($repoInfo) {
            $apiPath = "repos/" + $repoInfo.owner.login + "/" + $repoInfo.name + "/pages"
            $null = gh api $apiPath 2>$null
            if ($LASTEXITCODE -eq 0) {
                Write-Check "GitHub Pages" "ok" "configured"
            }
            else {
                Write-Check "GitHub Pages" "warn" "not enabled - set Source to 'GitHub Actions' in repo settings"
                $script:warnings += "GitHub Pages not yet enabled - agents cannot deploy until you turn it on"
            }
        }
    }
    catch {
        Write-Check "GitHub Pages" "warn" "could not verify"
    }
}

Write-Host ""

# ---------------------------------------------------------------
# Summary
# ---------------------------------------------------------------
Write-Host "===================================================" -ForegroundColor Cyan
if ($script:failures.Count -eq 0) {
    if ($script:warnings.Count -eq 0) {
        Write-Host "  READY - all checks passed." -ForegroundColor Green
        Write-Host "===================================================" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Launch the overnight run with:" -ForegroundColor White
        Write-Host "  claude --dangerously-skip-permissions" -ForegroundColor Yellow
        Write-Host "Then paste the kickoff prompt from 01_KICKOFF.md" -ForegroundColor White
        Write-Host ""
        exit 0
    }
    else {
        Write-Host "  READY (with warnings)" -ForegroundColor Yellow
        Write-Host "===================================================" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Warnings:" -ForegroundColor Yellow
        $script:warnings | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
        Write-Host ""
        Write-Host "Safe to launch, but address warnings if possible." -ForegroundColor White
        Write-Host ""
        exit 0
    }
}
else {
    Write-Host ("  NOT READY - " + $script:failures.Count + " failure(s)") -ForegroundColor Red
    Write-Host "===================================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Fix these before launching:" -ForegroundColor Red
    $script:failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    if ($script:warnings.Count -gt 0) {
        Write-Host ""
        Write-Host "Plus warnings:" -ForegroundColor Yellow
        $script:warnings | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
    }
    Write-Host ""
    exit 1
}