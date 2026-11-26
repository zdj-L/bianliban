use std::collections::HashSet;

pub fn is_sequence_prefix(prefix: &str) -> bool {
    matches!(prefix, "文字" | "图片" | "截图")
}

/// 最小的、还没被占用的正整数。`文字01` 不算 `文字1`，`文字` 本身也不占号。
pub fn next_sequence_name(existing: &[String], prefix: &str) -> String {
    let used = existing
        .iter()
        .filter_map(|name| parse_sequence(name, prefix))
        .collect::<HashSet<_>>();
    let mut number = 1u64;
    while used.contains(&number) {
        number = number.saturating_add(1);
        if number == u64::MAX {
            break;
        }
    }
    format!("{prefix}{number}")
}

pub fn prefix_for(kind: &str, title: Option<&str>) -> &'static str {
    if kind == "text" {
        return "文字";
    }
    if title.is_some_and(|value| parse_sequence(value.trim(), "截图").is_some()) {
        return "截图";
    }
    "图片"
}

pub fn parse_sequence(name: &str, prefix: &str) -> Option<u64> {
    let rest = name.strip_prefix(prefix)?;
    if rest.is_empty() || rest.as_bytes().first() == Some(&b'0') {
        return None;
    }
    if !rest.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    rest.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_name_starts_at_one() {
        assert_eq!(next_sequence_name(&[], "文字"), "文字1");
    }

    #[test]
    fn skips_numbers_that_already_exist_and_fills_gaps() {
        let existing = vec!["文字1".to_string(), "文字3".to_string(), "会议".to_string()];
        assert_eq!(next_sequence_name(&existing, "文字"), "文字2");
        let full = vec!["文字1".to_string(), "文字2".to_string()];
        assert_eq!(next_sequence_name(&full, "文字"), "文字3");
    }

    #[test]
    fn leading_zero_and_other_prefixes_do_not_count() {
        let existing = vec![
            "文字".to_string(),
            "文字0".to_string(),
            "文字01".to_string(),
            "文字1a".to_string(),
            "图片1".to_string(),
        ];
        assert_eq!(next_sequence_name(&existing, "文字"), "文字1");
        assert_eq!(next_sequence_name(&existing, "图片"), "图片2");
        assert_eq!(next_sequence_name(&existing, "截图"), "截图1");
    }

    #[test]
    fn batch_uses_each_new_name() {
        let mut existing = vec!["图片2".to_string()];
        let mut given = Vec::new();
        for _ in 0..3 {
            let name = next_sequence_name(&existing, "图片");
            existing.push(name.clone());
            given.push(name);
        }
        assert_eq!(given, vec!["图片1", "图片3", "图片4"]);
    }

    #[test]
    fn rename_prefix_keeps_screenshot_numbers() {
        assert_eq!(prefix_for("text", None), "文字");
        assert_eq!(prefix_for("text", Some("截图1")), "文字");
        assert_eq!(prefix_for("image", Some("截图12")), "截图");
        assert_eq!(prefix_for("image", Some("截图01")), "图片");
        assert_eq!(prefix_for("image", Some("照片")), "图片");
        assert_eq!(prefix_for("image", None), "图片");
    }
}
