$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add('http://+:3000/')
$listener.Start()
Write-Host "Szerver fut: http://localhost:3000"

$wwwroot = (Get-Location).Path

$mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css'
    '.js'   = 'text/javascript'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.svg'  = 'image/svg+xml'
    '.ico'  = 'image/x-icon'
}

while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response

    $rawUrl = $req.Url.LocalPath
    $filePath = Join-Path $wwwroot ($rawUrl -replace '/', '\')
    if ($rawUrl -eq '/') { $filePath = Join-Path $wwwroot 'index.html' }

    if (Test-Path $filePath) {
        $ext = [IO.Path]::GetExtension($filePath)
        $res.StatusCode = 200
        $res.ContentType = if ($mime[$ext]) { $mime[$ext] } else { 'text/plain' }
        $buf = [IO.File]::ReadAllBytes($filePath)
        $res.OutputStream.Write($buf, 0, $buf.Length)
    } else {
        $res.StatusCode = 404
        $res.ContentType = 'text/html; charset=utf-8'
        $buf = [Text.Encoding]::UTF8.GetBytes('<h1>404</h1>')
        $res.OutputStream.Write($buf, 0, $buf.Length)
    }
    $res.Close()
}