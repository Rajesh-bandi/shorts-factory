#requires -Version 5.1
<#
Allow SSH from this machine's current public IP.

The EC2 security group only allows port 22 from one home IP. When the ISP
changes that IP, SSH and scripts/refresh-youtube-cookies.ps1 time out even
though the app keeps running. Run this script to add the new IP.

It only adds a rule; it never removes one. Review the printed list and remove
stale rules in the AWS console if you want to keep the group tight.

Usage:
  powershell -ExecutionPolicy Bypass -File scripts/allow-ssh-ip.ps1
#>
[CmdletBinding()]
param(
    [string]$GroupId = "sg-024b4c65f2d9a0f5d",
    [string]$Region = "us-east-1",
    [int]$Port = 22
)

$ErrorActionPreference = "Stop"

$ip = (Invoke-RestMethod -Uri "https://api.ipify.org" -TimeoutSec 15).Trim()
if ($ip -notmatch '^\d{1,3}(\.\d{1,3}){3}$') {
    throw "Could not determine this machine's public IPv4 address (got '$ip')."
}
$cidr = "$ip/32"

$sg = aws ec2 describe-security-groups --group-ids $GroupId --region $Region --output json | ConvertFrom-Json
if (-not $sg.SecurityGroups) { throw "Security group $GroupId was not found in $Region." }

$rules = @($sg.SecurityGroups[0].IpPermissions | Where-Object {
    $_.IpProtocol -eq "tcp" -and $_.FromPort -eq $Port -and $_.ToPort -eq $Port
})
$cidrs = @($rules | ForEach-Object { $_.IpRanges.CidrIp } | Where-Object { $_ })

if ($cidrs -contains $cidr) {
    Write-Host "Port $Port already allows $cidr."
} else {
    Write-Host "Allowing $cidr on port $Port ..."
    aws ec2 authorize-security-group-ingress --group-id $GroupId --region $Region `
        --protocol tcp --port $Port --cidr $cidr --output json | Out-Null
    $cidrs += $cidr
    Write-Host "Added $cidr."
}

Write-Host "Port $Port currently allows: $($cidrs -join ', ')"
