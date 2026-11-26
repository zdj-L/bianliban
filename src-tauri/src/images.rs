use std::fs;
use std::path::{Path, PathBuf};

use image::{DynamicImage, ImageFormat, ImageReader, RgbaImage, imageops::FilterType};
use uuid::Uuid;

pub const MAX_BYTES: u64 = 20 * 1024 * 1024;
pub const MAX_SIDE: u32 = 8000;
pub const THUMB_MAX_SIDE: u32 = 480;

#[derive(Debug, Clone)]
pub struct SavedImage {
    pub id: String,
    pub image_file: String,
    pub thumb_file: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SkippedFile {
    pub name: String,
    pub reason: String,
}

#[derive(Debug)]
pub struct PreparedImport {
    pub saved: Vec<SavedImage>,
    pub skipped: Vec<SkippedFile>,
}

pub fn import_paths(dir: &Path, paths: &[String]) -> Result<PreparedImport, String> {
    fs::create_dir_all(dir).map_err(|err| format!("无法创建图片目录：{err}"))?;
    let mut saved = Vec::new();
    let mut skipped = Vec::new();
    for path in paths {
        match import_one(dir, Path::new(path)) {
            Ok(image) => saved.push(image),
            Err(skip) => skipped.push(skip),
        }
    }
    Ok(PreparedImport { saved, skipped })
}

pub fn store_rgba(dir: &Path, image: &RgbaImage) -> Result<SavedImage, String> {
    fs::create_dir_all(dir).map_err(|err| format!("无法创建图片目录：{err}"))?;
    if let Some(reason) = dimension_error(image.width(), image.height()) {
        return Err(reason.into());
    }
    let id = Uuid::new_v4().to_string();
    write_pair(dir, &id, &DynamicImage::ImageRgba8(image.clone()))
}

pub fn remove_files(dir: &Path, image_file: &str, thumb_file: &str) {
    remove_named(dir, image_file);
    remove_named(dir, thumb_file);
}

pub fn read_base64(dir: &Path, name: &str) -> Option<String> {
    let path = safe_join(dir, name)?;
    let bytes = fs::read(path).ok()?;
    Some(base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        bytes,
    ))
}

pub fn full_image_path(dir: &Path, name: &str) -> Result<PathBuf, String> {
    safe_join(dir, name).ok_or_else(|| "图片文件名无效".to_string())
}

pub fn thumb_dimensions(width: u32, height: u32, max_side: u32) -> (u32, u32) {
    if width == 0 || height == 0 {
        return (1, 1);
    }
    let long_side = width.max(height);
    if long_side <= max_side {
        return (width, height);
    }
    let scale = f64::from(max_side) / f64::from(long_side);
    let mut thumb_width = (f64::from(width) * scale).round().max(1.0) as u32;
    let mut thumb_height = (f64::from(height) * scale).round().max(1.0) as u32;
    if thumb_width > max_side {
        thumb_width = max_side;
    }
    if thumb_height > max_side {
        thumb_height = max_side;
    }
    (thumb_width, thumb_height)
}

pub fn dimension_error(width: u32, height: u32) -> Option<&'static str> {
    if width == 0 || height == 0 {
        return Some("无法读取");
    }
    if width > MAX_SIDE || height > MAX_SIDE {
        return Some("边长超过 8000");
    }
    None
}

pub fn size_error(len: u64) -> Option<&'static str> {
    if len > MAX_BYTES {
        Some("超过 20MB")
    } else {
        None
    }
}

fn import_one(dir: &Path, path: &Path) -> Result<SavedImage, SkippedFile> {
    let name = display_name(path);
    let fail = |reason: &str| SkippedFile {
        name: name.clone(),
        reason: reason.to_string(),
    };
    let meta = match fs::metadata(path) {
        Ok(meta) if meta.is_file() => meta,
        _ => return Err(fail("不是文件")),
    };
    if let Some(reason) = size_error(meta.len()) {
        return Err(fail(reason));
    }
    let Some(format) = format_of(path) else {
        return Err(fail("格式不支持"));
    };
    let mut reader = match ImageReader::open(path) {
        Ok(reader) => reader,
        Err(_) => return Err(fail("无法读取")),
    };
    reader.set_format(format);
    let dimensions = match reader.into_dimensions() {
        Ok(dimensions) => dimensions,
        Err(_) => return Err(fail("无法读取")),
    };
    if let Some(reason) = dimension_error(dimensions.0, dimensions.1) {
        return Err(fail(reason));
    }
    let mut reader = match ImageReader::open(path) {
        Ok(reader) => reader,
        Err(_) => return Err(fail("无法读取")),
    };
    reader.set_format(format);
    let decoded = match reader.decode() {
        Ok(image) => image,
        Err(_) => return Err(fail("无法读取")),
    };
    let id = Uuid::new_v4().to_string();
    write_pair(dir, &id, &decoded).map_err(|err| fail(&err))
}

fn write_pair(dir: &Path, id: &str, image: &DynamicImage) -> Result<SavedImage, String> {
    let image_file = format!("{id}.png");
    let thumb_file = format!("{id}.thumb.png");
    let full_path = dir.join(&image_file);
    let thumb_path = dir.join(&thumb_file);
    image
        .save_with_format(&full_path, ImageFormat::Png)
        .map_err(|err| format!("无法保存图片：{err}"))?;
    let (width, height) = thumb_dimensions(image.width(), image.height(), THUMB_MAX_SIDE);
    let thumb = if (width, height) == (image.width(), image.height()) {
        image.clone()
    } else {
        image.resize_exact(width, height, FilterType::Triangle)
    };
    if let Err(err) = thumb.save_with_format(&thumb_path, ImageFormat::Png) {
        let _ = fs::remove_file(&full_path);
        return Err(format!("无法保存缩略图：{err}"));
    }
    Ok(SavedImage {
        id: id.to_string(),
        image_file,
        thumb_file,
    })
}

fn format_of(path: &Path) -> Option<ImageFormat> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "png" => Some(ImageFormat::Png),
        "jpg" | "jpeg" => Some(ImageFormat::Jpeg),
        "gif" => Some(ImageFormat::Gif),
        "webp" => Some(ImageFormat::WebP),
        "bmp" => Some(ImageFormat::Bmp),
        _ => None,
    }
}

fn display_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}

fn safe_join(dir: &Path, name: &str) -> Option<PathBuf> {
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
        return None;
    }
    if Path::new(name).components().count() != 1 {
        return None;
    }
    Some(dir.join(name))
}

fn remove_named(dir: &Path, name: &str) {
    if let Some(path) = safe_join(dir, name) {
        let _ = fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("bianliban-{name}-{}", Uuid::new_v4().simple()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn thumb_longest_side_is_480_without_upscaling() {
        assert_eq!(thumb_dimensions(1000, 400, 480), (480, 192));
        assert_eq!(thumb_dimensions(400, 1000, 480), (192, 480));
        assert_eq!(thumb_dimensions(120, 80, 480), (120, 80));
        assert_eq!(dimension_error(8001, 10), Some("边长超过 8000"));
        assert_eq!(size_error(MAX_BYTES + 1), Some("超过 20MB"));
        assert_eq!(size_error(MAX_BYTES), None);
    }

    #[test]
    fn import_writes_png_and_thumb_and_skips_other_files() {
        let src_dir = scratch("src");
        let out_dir = scratch("out");
        let sample = src_dir.join("wide.png");
        RgbaImage::from_pixel(1000, 400, Rgba([12, 34, 56, 255]))
            .save(&sample)
            .unwrap();
        let notes = src_dir.join("notes.txt");
        fs::write(&notes, b"hello").unwrap();

        let prepared = import_paths(
            &out_dir,
            &[
                sample.to_string_lossy().into_owned(),
                notes.to_string_lossy().into_owned(),
            ],
        )
        .unwrap();
        assert_eq!(prepared.saved.len(), 1);
        assert_eq!(
            prepared.skipped,
            vec![SkippedFile {
                name: "notes.txt".into(),
                reason: "格式不支持".into(),
            }]
        );
        let saved = &prepared.saved[0];
        assert_eq!(saved.image_file, format!("{}.png", saved.id));
        assert_eq!(saved.thumb_file, format!("{}.thumb.png", saved.id));
        let thumb = image::open(out_dir.join(&saved.thumb_file)).unwrap();
        assert_eq!((thumb.width(), thumb.height()), (480, 192));
        let full = image::open(out_dir.join(&saved.image_file)).unwrap();
        assert_eq!((full.width(), full.height()), (1000, 400));

        let _ = fs::remove_dir_all(src_dir);
        let _ = fs::remove_dir_all(out_dir);
    }
}
