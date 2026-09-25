param(
  [Parameter(Mandatory = $true)][string]$Mode,
  [string]$Hwnd = "0",
  [int]$X = 0,
  [int]$Y = 0,
  [int]$W = 0,
  [int]$H = 0
)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class LvtBar {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern IntPtr FindWindow(string c, string w);
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")]
  public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);

  public static void EachSecondary(int cmd) {
    EnumWindows((h, l) => {
      var sb = new StringBuilder(256);
      GetClassName(h, sb, 256);
      if (sb.ToString() == "Shell_SecondaryTrayWnd") ShowWindow(h, cmd);
      return true;
    }, IntPtr.Zero);
  }
}
"@

if ($Mode -eq 'hide') {
  [LvtBar]::ShowWindow([LvtBar]::FindWindow('Shell_TrayWnd', $null), 0) | Out-Null
  [LvtBar]::EachSecondary(0)
} elseif ($Mode -eq 'show') {
  [LvtBar]::ShowWindow([LvtBar]::FindWindow('Shell_TrayWnd', $null), 5) | Out-Null
  [LvtBar]::EachSecondary(5)
} elseif ($Mode -eq 'pin') {
  $h = [IntPtr]::new([int64]$Hwnd)
  # HWND_TOPMOST = -1, SWP_SHOWWINDOW = 0x40. Physical pixels, full monitor bounds.
  [LvtBar]::SetWindowPos($h, [IntPtr]::new(-1), $X, $Y, $W, $H, 0x0040) | Out-Null
}
