param([UInt64]$WindowHandle)
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class CollectifyRegionCheck {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
  [DllImport("user32.dll")] public static extern int GetWindowRgn(IntPtr window, IntPtr region);
  [DllImport("gdi32.dll")] public static extern IntPtr CreateRectRgn(int left,int top,int right,int bottom);
  [DllImport("gdi32.dll")] public static extern int GetRgnBox(IntPtr region,out RECT box);
  [DllImport("gdi32.dll")] public static extern bool PtInRegion(IntPtr region,int x,int y);
  [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr handle);
}
'@
$region=[CollectifyRegionCheck]::CreateRectRgn(0,0,0,0)
try {
  $kind=[CollectifyRegionCheck]::GetWindowRgn([IntPtr]::new([Int64]$WindowHandle),$region)
  $box=New-Object CollectifyRegionCheck+RECT
  [void][CollectifyRegionCheck]::GetRgnBox($region,[ref]$box)
  $right=$box.Right-1; $bottom=$box.Bottom-1
  $corners=@(
    [CollectifyRegionCheck]::PtInRegion($region,0,0)
    [CollectifyRegionCheck]::PtInRegion($region,$right,0)
    [CollectifyRegionCheck]::PtInRegion($region,0,$bottom)
    [CollectifyRegionCheck]::PtInRegion($region,$right,$bottom)
  )
  $center=[CollectifyRegionCheck]::PtInRegion($region,[int]($box.Right/2),[int]($box.Bottom/2))
  @{kind=$kind;corners=$corners;center=$center} | ConvertTo-Json -Compress
} finally {
  [void][CollectifyRegionCheck]::DeleteObject($region)
}
