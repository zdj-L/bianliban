use image::{Rgba, RgbaImage};

use crate::images::MAX_SIDE;

/// 一块已经落到图片像素坐标系里的屏幕。原点可以是负数。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PixelRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureMonitor {
    #[serde(skip_serializing)]
    pub label: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
}

/// xcap 在部分平台上把显示器位置报成逻辑像素，位图却是物理像素。
/// 位图比报告尺寸大时，把原点按同样的比例放大，选区才能对上。
pub fn bounds_for(
    x: i32,
    y: i32,
    reported_width: u32,
    reported_height: u32,
    image_width: u32,
    image_height: u32,
) -> PixelRect {
    let scale_x = if reported_width == 0 {
        1.0
    } else {
        f64::from(image_width) / f64::from(reported_width)
    };
    let scale_y = if reported_height == 0 {
        1.0
    } else {
        f64::from(image_height) / f64::from(reported_height)
    };
    PixelRect {
        x: (f64::from(x) * scale_x).round() as i32,
        y: (f64::from(y) * scale_y).round() as i32,
        width: image_width,
        height: image_height,
    }
}

pub fn stitch(frames: &[(PixelRect, &RgbaImage)], region: PixelRect) -> Result<RgbaImage, String> {
    if region.width < 8 || region.height < 8 {
        return Err("选区太小".into());
    }
    if region.width > MAX_SIDE || region.height > MAX_SIDE {
        return Err("边长超过 8000".into());
    }
    let mut image = RgbaImage::from_pixel(region.width, region.height, Rgba([0, 0, 0, 0]));
    let mut hit = false;
    for (frame, source) in frames {
        if copy_overlap(&mut image, source, *frame, region) {
            hit = true;
        }
    }
    if !hit {
        return Err("选区不在屏幕上".into());
    }
    Ok(image)
}

pub fn capture_rect(x: i32, y: i32, width: u32, height: u32) -> Result<RgbaImage, String> {
    let monitors = xcap::Monitor::all().map_err(|err| format!("无法截图：{err}"))?;
    if monitors.is_empty() {
        return Err("找不到屏幕".into());
    }
    let mut owned = Vec::new();
    for monitor in monitors {
        let image = monitor
            .capture_image()
            .map_err(|err| format!("无法截图：{err}"))?;
        let bounds = bounds_for(
            monitor.x(),
            monitor.y(),
            monitor.width(),
            monitor.height(),
            image.width(),
            image.height(),
        );
        owned.push((bounds, image));
    }
    let frames = owned
        .iter()
        .map(|(bounds, image)| (*bounds, image))
        .collect::<Vec<_>>();
    stitch(
        &frames,
        PixelRect {
            x,
            y,
            width,
            height,
        },
    )
}

fn copy_overlap(dst: &mut RgbaImage, src: &RgbaImage, frame: PixelRect, region: PixelRect) -> bool {
    let x0 = i64::from(frame.x).max(i64::from(region.x));
    let y0 = i64::from(frame.y).max(i64::from(region.y));
    let x1 = (i64::from(frame.x) + i64::from(frame.width))
        .min(i64::from(region.x) + i64::from(region.width))
        .min(i64::from(frame.x) + i64::from(src.width()));
    let y1 = (i64::from(frame.y) + i64::from(frame.height))
        .min(i64::from(region.y) + i64::from(region.height))
        .min(i64::from(frame.y) + i64::from(src.height()));
    if x1 <= x0 || y1 <= y0 {
        return false;
    }
    for y in y0..y1 {
        let src_y = (y - i64::from(frame.y)) as usize;
        let dst_y = (y - i64::from(region.y)) as usize;
        let src_x = (x0 - i64::from(frame.x)) as usize;
        let dst_x = (x0 - i64::from(region.x)) as usize;
        let row_bytes = ((x1 - x0) as usize) * 4;
        let src_start = (src_y * src.width() as usize + src_x) * 4;
        let dst_start = (dst_y * dst.width() as usize + dst_x) * 4;
        dst.as_mut()[dst_start..dst_start + row_bytes]
            .copy_from_slice(&src.as_raw()[src_start..src_start + row_bytes]);
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid(width: u32, height: u32, pixel: Rgba<u8>) -> RgbaImage {
        RgbaImage::from_pixel(width, height, pixel)
    }

    #[test]
    fn physical_monitor_keeps_its_origin() {
        assert_eq!(
            bounds_for(1920, 0, 1920, 1080, 1920, 1080),
            PixelRect {
                x: 1920,
                y: 0,
                width: 1920,
                height: 1080
            }
        );
    }

    #[test]
    fn logical_monitor_origin_scales_with_the_bitmap() {
        assert_eq!(
            bounds_for(10, 20, 100, 50, 200, 100),
            PixelRect {
                x: 20,
                y: 40,
                width: 200,
                height: 100
            }
        );
    }

    #[test]
    fn stitches_a_region_across_two_monitors() {
        let red = Rgba([255, 0, 0, 255]);
        let blue = Rgba([0, 0, 255, 255]);
        let left = solid(100, 100, red);
        let right = solid(100, 100, blue);
        let frames = [
            (
                PixelRect {
                    x: 0,
                    y: 0,
                    width: 100,
                    height: 100,
                },
                &left,
            ),
            (
                PixelRect {
                    x: 100,
                    y: 0,
                    width: 100,
                    height: 100,
                },
                &right,
            ),
        ];
        let image = stitch(
            &frames,
            PixelRect {
                x: 80,
                y: 40,
                width: 40,
                height: 20,
            },
        )
        .unwrap();
        assert_eq!(image.dimensions(), (40, 20));
        assert_eq!(*image.get_pixel(0, 0), red);
        assert_eq!(*image.get_pixel(19, 10), red);
        assert_eq!(*image.get_pixel(20, 0), blue);
        assert_eq!(*image.get_pixel(39, 19), blue);
    }

    #[test]
    fn rejects_a_region_off_every_monitor_or_too_small() {
        let frame = solid(30, 30, Rgba([1, 2, 3, 255]));
        let frames = [(
            PixelRect {
                x: 0,
                y: 0,
                width: 30,
                height: 30,
            },
            &frame,
        )];
        assert!(
            stitch(
                &frames,
                PixelRect {
                    x: 100,
                    y: 100,
                    width: 20,
                    height: 20,
                },
            )
            .is_err()
        );
        assert!(
            stitch(
                &frames,
                PixelRect {
                    x: 0,
                    y: 0,
                    width: 7,
                    height: 20,
                },
            )
            .is_err()
        );
    }
}
