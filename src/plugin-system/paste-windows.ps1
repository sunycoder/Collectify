param([int]$BlockedProcessId)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CollectifyPaste {
    [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort vk; public ushort scan; public uint flags; public uint time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION { [FieldOffset(0)] public KEYBDINPUT key; [FieldOffset(0)] public MOUSEINPUT mouse; }
    [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int x; public int y; public uint data; public uint flags; public uint time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION value; }
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
    [DllImport("user32.dll",SetLastError=true)] public static extern uint SendInput(uint count,INPUT[] inputs,int size);
    public static bool Paste(int blocked) {
        var window=GetForegroundWindow(); uint pid; GetWindowThreadProcessId(window,out pid);
        if(window==IntPtr.Zero||pid==0||pid==(uint)blocked) return false;
        var input=new INPUT[4]; ushort[] keys={0x11,0x56,0x56,0x11};
        for(int i=0;i<4;i++){input[i].type=1;input[i].value.key.vk=keys[i];input[i].value.key.flags=i>=2?2u:0u;}
        return SendInput(4,input,Marshal.SizeOf(typeof(INPUT)))==4;
    }
}
'@
if(-not [CollectifyPaste]::Paste($BlockedProcessId)){[Console]::Error.WriteLine('No external target window, or Windows rejected the paste input.');exit 1}
