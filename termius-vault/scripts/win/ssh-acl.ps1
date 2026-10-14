# Restrict newly created export files before credential contents are written.
$ErrorActionPreference = 'Stop'
$paths = [Console]::In.ReadToEnd() | ConvertFrom-Json
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
foreach ($path in $paths) {
    $item = Get-Item -LiteralPath $path -Force
    if ($item.PSIsContainer) {
        $acl = New-Object Security.AccessControl.DirectorySecurity
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    } else {
        $acl = New-Object Security.AccessControl.FileSecurity
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'Allow')
    }
    $acl.SetOwner($sid)
    $acl.SetAccessRuleProtection($true, $false)
    $acl.AddAccessRule($rule)
    # Use .NET directly: WSL may supply a PSModulePath that prevents Set-Acl
    # from autoloading the Windows security module.
    if ($item.PSIsContainer) {
        [IO.Directory]::SetAccessControl($path, $acl)
    } else {
        [IO.File]::SetAccessControl($path, $acl)
    }
}
