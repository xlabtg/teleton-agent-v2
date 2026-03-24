# Windows Installation Guide

This guide covers how to install and run Teleton Agent V2 on Windows 10/11.

## Prerequisites

- **Node.js 20+** — Download from [nodejs.org](https://nodejs.org/) or use `winget install OpenJS.NodeJS`
- **npm 10+** — Included with Node.js
- **Git** — Download from [git-scm.com](https://git-scm.com/download/win) or `winget install Git.Git`

## Installation

### Option A: PowerShell (recommended)

```powershell
# Clone the repository
git clone https://github.com/xlabtg/teleton-agent-v2.git
cd teleton-agent-v2

# Install dependencies
npm install

# Copy the example config
Copy-Item config.example.yaml -Destination $env:USERPROFILE\.teleton-v2\config.yaml

# Edit config with your editor of choice
notepad $env:USERPROFILE\.teleton-v2\config.yaml
```

### Option B: Command Prompt (CMD)

```cmd
git clone https://github.com/xlabtg/teleton-agent-v2.git
cd teleton-agent-v2

npm install

mkdir %USERPROFILE%\.teleton-v2
copy config.example.yaml %USERPROFILE%\.teleton-v2\config.yaml

notepad %USERPROFILE%\.teleton-v2\config.yaml
```

## Running

### Development mode

```powershell
# PowerShell
npm run dev

# CMD
npm run dev
```

### Production build

```powershell
npm run build:v2
node dist/apps/agent/index.js
```

### Web UI

```powershell
npm run dev:web
```

## Common Issues

### Environment variables with special characters

**PowerShell:**

```powershell
$env:NODE_OPTIONS = "--trace-warnings"
npm run dev
```

**CMD** (no quotes around the value):

```cmd
set NODE_OPTIONS=--trace-warnings
npm run dev
```

### Config file not found

The agent searches for config files in this order:

1. Path passed via CLI argument
2. `%USERPROFILE%\.teleton-v2\config.yaml` (e.g. `C:\Users\YourName\.teleton-v2\config.yaml`)
3. `.\configs\default.yaml` (relative to working directory)

If you see `No configuration file found`, make sure the config exists at one of these paths.

### File encoding issues (esbuild errors with emoji)

If you edit TypeScript files with Notepad and see esbuild errors like `ERROR: Unexpected "✅"`, the file was likely saved with a **UTF-8 BOM** header. To fix:

1. Open the file in **VS Code** or **Notepad++**
2. In VS Code: click the `UTF-8 with BOM` indicator in the bottom right → select `Save with Encoding` → `UTF-8`
3. In Notepad++: `Encoding` menu → `Encode in UTF-8` (without BOM)

To prevent this, add a `.editorconfig` file (already included in this repo) and use an editor that respects it.

### Path separator issues

The codebase uses `path.join()` and `path.resolve()` throughout, so paths work correctly on both Windows and Unix. If you encounter hardcoded `/` separators in a script, please open an issue.

### WSL (Windows Subsystem for Linux)

Running inside WSL is fully supported and is the most straightforward option if you encounter Windows-specific issues. Follow the standard Linux installation instructions in that case.

## Verifying the installation

After starting with `npm run dev`, verify the server is running:

```powershell
# PowerShell - check port is listening
netstat -ano | Select-String ":3001"

# Check health endpoint
Invoke-WebRequest -Uri http://localhost:3001/health | Select-Object -ExpandProperty Content

# Test login
Invoke-WebRequest -Uri http://localhost:3001/api/auth/login `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"username":"admin","password":"test"}' | Select-Object -ExpandProperty Content
```

```cmd
REM CMD
netstat -ano | findstr :3001

curl http://localhost:3001/health
curl -X POST http://localhost:3001/api/auth/login -H "Content-Type: application/json" -d "{\"username\":\"admin\",\"password\":\"test\"}"
```
