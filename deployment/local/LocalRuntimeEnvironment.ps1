# MB-UX-QUALITY-001 L07. Import only server-owned runtime settings.
function Get-LocalRuntimeEnvironment {
    param(
        [scriptblock]$ReadEnvironment = {
            param([string]$Name, [string]$Target)
            [Environment]::GetEnvironmentVariable($Name, $Target)
        }
    )
    $runtime = @{}
    $names = @(
        'MATCHBASE_DATABASE_URL',
        'MATCHBASE_DIGEST_KEY',
        'MATCHBASE_OPENROUTER_API_KEY',
        'MATCHBASE_PROVIDER_GOOGLE',
        'MATCHBASE_PROVIDER_OPENAI',
        'MATCHBASE_PROVIDER_ANTHROPIC',
        'MATCHBASE_PROVIDER_DEEPSEEK',
        'MATCHBASE_PROVIDER_XAI',
        'MATCHBASE_PROVIDER_ROUTES',
        'MATCHBASE_MODEL_GEMINI',
        'MATCHBASE_MODEL_OPENAI',
        'MATCHBASE_MODEL_PREPARATION',
        'MATCHBASE_MODEL_SYNTHESIS'
    )
    foreach ($name in $names) {
        $value = & $ReadEnvironment $name 'User'
        if (-not $value) { $value = & $ReadEnvironment $name 'Process' }
        if ($value) { $runtime[$name] = $value }
    }
    return $runtime
}

function Get-LocalTestEnvironmentNames {
    param([string[]]$ExistingNames)
    $required = @('DATABASE_URL', 'MATCHBASE_DATABASE_URL', 'MATCHBASE_CONSULTANT_TEST_DATABASE_URL', 'MATCHBASE_DISPOSABLE_TEST_DATABASE_URL', 'MATCHBASE_TEST_DATABASE_GUARD')
    # Models must not make fixture tests inherit the operator's live selection.
    $inherited = @($ExistingNames | Where-Object { $_ -match 'DATABASE_URL|OPENROUTER|API_KEY|^PG(HOST|PORT|DATABASE|USER|PASSWORD|SERVICE|SERVICEFILE)$|^MATCHBASE_(PROVIDER|MODEL)_' })
    return @($required + $inherited | Select-Object -Unique)
}
