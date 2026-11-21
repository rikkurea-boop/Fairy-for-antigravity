use std::path::Path;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;
#[cfg(windows)]
const RUN_SUBKEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
#[cfg(windows)]
const RUN_VALUE_NAME: &str = "FairyIII_HDD_Intro";
#[cfg(windows)]
const TASK_NAME: &str = "FairyIII_HDD_BootIntro";

pub fn get_startup_enabled() -> bool {
    #[cfg(windows)]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(key) = hkcu.open_subkey(RUN_SUBKEY) {
            return key.get_value::<String, _>(RUN_VALUE_NAME).is_ok();
        }
        false
    }
    #[cfg(not(windows))]
    {
        false
    }
}

pub fn set_startup_enabled(enabled: bool, exe_path: &Path) -> bool {
    #[cfg(windows)]
    {
        use std::process::{Command, Stdio};
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if enabled {
            if let Ok((key, _)) = hkcu.create_subkey(RUN_SUBKEY) {
                let cmd_val = format!("\"{}\"", exe_path.display());
                let _ = key.set_value(RUN_VALUE_NAME, &cmd_val);
            }
            let _ = Command::new("schtasks.exe")
                .args(["/Change", "/TN", TASK_NAME, "/ENABLE"])
                .creation_flags(CREATE_NO_WINDOW)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        } else {
            if let Ok(key) = hkcu.open_subkey_with_flags(RUN_SUBKEY, winreg::enums::KEY_SET_VALUE) {
                let _ = key.delete_value(RUN_VALUE_NAME);
            }
            let _ = Command::new("schtasks.exe")
                .args(["/Change", "/TN", TASK_NAME, "/DISABLE"])
                .creation_flags(CREATE_NO_WINDOW)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
        get_startup_enabled()
    }
    #[cfg(not(windows))]
    {
        let _ = (enabled, exe_path);
        false
    }
}

pub fn register_protocol_handler(exe_path: &Path) {
    #[cfg(windows)]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok((proto_key, _)) = hkcu.create_subkey("Software\\Classes\\fairy") {
            let _ = proto_key.set_value("", &"URL:Fairy Protocol");
            let _ = proto_key.set_value("URL Protocol", &"");
            if let Ok((cmd_key, _)) = proto_key.create_subkey("shell\\open\\command") {
                let cmd = format!("\"{}\" \"%1\"", exe_path.display());
                let _ = cmd_key.set_value("", &cmd);
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = exe_path;
    }
}
