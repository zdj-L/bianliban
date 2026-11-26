use std::path::{Path, PathBuf};

pub const DIR_NAME: &str = "com.bianliban.desktop";

/// Linux: ~/.local/share/com.bianliban.desktop
/// Windows: %APPDATA%\com.bianliban.desktop
/// 不读取 XDG_DATA_HOME，按说明里的固定路径。
pub fn data_dir_from(
    os: &str,
    home: Option<&Path>,
    appdata: Option<&Path>,
) -> Result<PathBuf, String> {
    if os == "windows" {
        let base = appdata.ok_or_else(|| "找不到 APPDATA".to_string())?;
        return Ok(base.join(DIR_NAME));
    }
    let home = home.ok_or_else(|| "找不到 HOME".to_string())?;
    Ok(home.join(".local").join("share").join(DIR_NAME))
}

pub fn data_dir() -> Result<PathBuf, String> {
    if std::env::consts::OS == "windows" {
        let appdata = std::env::var("APPDATA").map_err(|_| "找不到 APPDATA".to_string())?;
        return data_dir_from("windows", None, Some(Path::new(&appdata)));
    }
    let home = std::env::var("HOME").map_err(|_| "找不到 HOME".to_string())?;
    data_dir_from(std::env::consts::OS, Some(Path::new(&home)), None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linux_data_dir_is_under_local_share() {
        let home = Path::new("/home/me");
        let dir = data_dir_from("linux", Some(home), None).unwrap();
        assert_eq!(dir, home.join(".local/share/com.bianliban.desktop"));
    }

    #[test]
    fn windows_data_dir_is_under_appdata() {
        let appdata = Path::new("C:/Users/me/AppData/Roaming");
        let dir = data_dir_from("windows", None, Some(appdata)).unwrap();
        assert_eq!(dir, appdata.join("com.bianliban.desktop"));
    }

    #[test]
    fn windows_without_appdata_fails() {
        assert!(data_dir_from("windows", Some(Path::new("/home/me")), None).is_err());
    }
}
