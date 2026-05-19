# Set encoding to UTF-8 to prevent Korean characters from breaking
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "   smart-pdf-ai-merger Git 수동 동기화 도구" -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host " 원격 저장소(GitHub)와 로컬 파일의 소스 코드를"
Write-Host " 안전하게 양방향 백업 및 최신화합니다."
Write-Host "==================================================="
Write-Host ""

# 1. Git 실행 파일 경로 자동 검색 (Windows)
$gitPath = "git"
if (Test-Path "C:\Program Files\Git\cmd\git.exe") {
    $gitPath = "C:\Program Files\Git\cmd\git.exe"
} elseif (Test-Path "C:\Program Files (x86)\Git\cmd\git.exe") {
    $gitPath = "C:\Program Files (x86)\Git\cmd\git.exe"
} elseif (Test-Path "$env:USERPROFILE\AppData\Local\Programs\Git\cmd\git.exe") {
    $gitPath = "$env:USERPROFILE\AppData\Local\Programs\Git\cmd\git.exe"
}

# Git 존재 확인
try {
    & $gitPath --version > $null
} catch {
    Write-Host "❌ [오류] PC에서 Git 설치 경로를 찾을 수 없습니다." -ForegroundColor Red
    Write-Host "Git이 설치되어 있는지 확인해 주세요." -ForegroundColor Yellow
    exit 1
}

$gitDir = Join-Path $PSScriptRoot ".git"
$warningFilePath = Join-Path $PSScriptRoot "깃_충돌_경고_우선확인.txt"

# 충돌 발생 여부 확인 함수
function Has-Conflicts {
    (Test-Path (Join-Path $gitDir "MERGE_HEAD")) -or `
    (Test-Path (Join-Path $gitDir "rebase-merge")) -or `
    (Test-Path (Join-Path $gitDir "rebase-apply"))
}

# 충돌 상태 체크
if (Has-Conflicts) {
    Write-Host "⚠️ [경고] 현재 저장소에 해결되지 않은 깃 충돌(Conflict)이 존재합니다." -ForegroundColor Yellow
    Write-Host "임시 경고 파일이 프로젝트 루트 폴더에 생성되었습니다. 확인 후 충돌을 해결해 주세요." -ForegroundColor Yellow
    [console]::beep(1000, 500)
    exit 1
}

# 경고 파일이 존재한다면 삭제
if (Test-Path $warningFilePath) {
    Remove-Item $warningFilePath -Force
}

# 현재 활성화된 브랜치명 추출
$branch = (& $gitPath rev-parse --abbrev-ref HEAD).Trim()
Write-Host "👉 현재 사용 중인 깃 브랜치: [$branch]" -ForegroundColor Green

# 1. 로컬 수정 사항 감지 및 반영
$status = (& $gitPath status --porcelain).Trim()
$hasLocalChanges = $status.Length -gt 0

if ($hasLocalChanges) {
    Write-Host "📝 감지된 파일 변경 내역:" -ForegroundColor Yellow
    Write-Host $status
    Write-Host "📦 변경 사항 백업 커밋 작성 중..." -ForegroundColor Cyan
    
    & $gitPath add -A
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    & $gitPath commit -m "수동 업데이트: $timestamp"
    Write-Host "✅ 로컬 커밋 완료!" -ForegroundColor Green
} else {
    Write-Host "✨ 수정된 로컬 파일이 없습니다. (커밋 생략)" -ForegroundColor Gray
}

# 2. 원격 최신 갱신 (Pull with Rebase)
Write-Host "📥 원격 저장소(GitHub)로부터 최신 코드 가져오는 중 (git pull --rebase)..." -ForegroundColor Cyan
try {
    & $gitPath pull --rebase origin $branch
    Write-Host "✅ 원격 저장소 동기화 완료!" -ForegroundColor Green
} catch {
    if (Has-Conflicts) {
        Write-Host "❌ [에러] 최신 코드를 당겨오는 중 충돌이 발생했습니다!" -ForegroundColor Red
        Write-Host "이전 히스토리를 보존하기 위해 리베이스 작업을 안전하게 취소하고 경고 메시지를 띄웁니다." -ForegroundColor Yellow
        
        try {
            & $gitPath rebase --abort
            Write-Host "ℹ️ 리베이스 작업을 안전하게 취소(Abort) 처리했습니다." -ForegroundColor Gray
        } catch {
            Write-Host "❌ 리베이스 취소 실패" -ForegroundColor Red
        }

        $warningMsg = "[깃 동기화 충돌 안내]`n" +
                      "원격 저장소의 최신 코드를 가져오던 중 충돌(Conflict)이 발생했습니다.`n" +
                      "서로 다른 PC에서 같은 파일의 같은 위치를 동시에 수정했을 때 주로 발생합니다.`n`n" +
                      "해결 방법:`n" +
                      "1. VS Code 등의 편집기에서 깃허브 변경 사항과 로컬 코드를 대조 및 해결합니다.`n" +
                      "2. 해결 후 터미널에 아래 명령어를 실행하여 수동으로 깃허브에 밀어 넣어주세요:`n" +
                      "   git add .`n" +
                      "   git commit -m `"충돌 해결 수동 커밋`"`n" +
                      "   git pull --rebase origin $branch`n" +
                      "   git push origin $branch`n`n" +
                      "수동 정리가 완료되면 이 안내 파일은 다음 동기화 시 자동으로 지워집니다."
                      
        Set-Content -Path $warningFilePath -Value $warningMsg -Encoding utf8
        [console]::beep(1000, 500)
        exit 1
    } else {
        Write-Host "❌ [오류] 원격 소스를 가져오는데 실패했습니다: $_" -ForegroundColor Red
        exit 1
    }
}

# 3. 깃허브 원격 업로드 (Push)
Write-Host "📤 원격 저장소(GitHub)로 업로드 중 (git push)..." -ForegroundColor Cyan
try {
    & $gitPath push origin $branch
    Write-Host "🎉 [성공] 모든 소스 코드가 깃허브와 완벽하게 양방향 연동되었습니다!" -ForegroundColor Green
} catch {
    Write-Host "❌ [오류] 원격 업로드(Push) 실패: $_" -ForegroundColor Red
    Write-Host "인터넷 연결을 확인하거나 권한을 체크해 주세요." -ForegroundColor Yellow
    exit 1
}

