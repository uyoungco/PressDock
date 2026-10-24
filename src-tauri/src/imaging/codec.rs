use super::*;
use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader, RgbaImage};
use std::io::Cursor;

fn codec_error<T>(_: T) -> ImageError {
    invalid("图片无法解码或编码，请检查文件是否有效")
}

pub fn identify(bytes: &[u8]) -> Result<Format> {
    match image::guess_format(bytes).map_err(|_| invalid("请选择静态 JPG、PNG 或 WebP 图片"))?
    {
        ImageFormat::Jpeg => Ok(Format::Jpeg),
        ImageFormat::Png => Ok(Format::Png),
        ImageFormat::WebP => Ok(Format::Webp),
        _ => Err(invalid(
            "仅支持静态 JPG、PNG 和 WebP，暂不支持 GIF 或其他格式",
        )),
    }
}

pub fn decode(bytes: &[u8], cancel: &AtomicBool) -> Result<DynamicImage> {
    let format = identify(bytes)?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_SIDE);
    limits.max_image_height = Some(MAX_SIDE);
    limits.max_alloc = Some(256 * 1024 * 1024);
    match format {
        Format::Png => {
            let decoder =
                image::codecs::png::PngDecoder::with_limits(Cursor::new(bytes), limits.clone())
                    .map_err(codec_error)?;
            if decoder.is_apng().map_err(codec_error)? {
                return Err(invalid("暂不支持动画 PNG，请选择静态图片"));
            }
        }
        Format::Webp => {
            let decoder =
                image::codecs::webp::WebPDecoder::new(Cursor::new(bytes)).map_err(codec_error)?;
            if decoder.has_animation() {
                return Err(invalid("暂不支持动画 WebP，请选择静态图片"));
            }
        }
        Format::Jpeg => {
            if jpeg_has_four_components(bytes) {
                return Err(invalid("暂不支持 CMYK 图片，请先转换为 sRGB 图片"));
            }
        }
    }
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format.image_format());
    reader.limits(limits);
    let mut decoder = reader.into_decoder().map_err(codec_error)?;
    let (width, height) = decoder.dimensions();
    Size { width, height }.validate()?;
    let orientation = decoder.orientation().map_err(codec_error)?;
    let profile = decoder.icc_profile().map_err(codec_error)?;
    check(cancel)?;
    let mut image = DynamicImage::from_decoder(decoder).map_err(codec_error)?;
    image.apply_orientation(orientation);
    let mut rgba = image.to_rgba8();
    if let Some(profile) = profile {
        // Convert embedded RGB/gray ICC profiles before stripping metadata. Never reinterpret
        // Adobe RGB/P3 bytes as sRGB: that causes the color shift this editor must avoid.
        use lcms2::{ColorSpaceSignature, Intent, PixelFormat, Profile, Transform};
        let source = Profile::new_icc(&profile)
            .map_err(|_| invalid("图片色彩配置损坏，无法保证颜色，请使用有效的 sRGB 图片"))?;
        let destination = Profile::new_srgb();
        if source.color_space() == ColorSpaceSignature::RgbData {
            let transform: Transform<[u8; 3], [u8; 3]> = Transform::new(
                &source,
                PixelFormat::RGB_8,
                &destination,
                PixelFormat::RGB_8,
                Intent::RelativeColorimetric,
            )
            .map_err(|_| invalid("无法转换图片色彩配置"))?;
            let mut row = vec![[0; 3]; rgba.width() as usize];
            for pixels in rgba
                .as_mut()
                .chunks_exact_mut(width_after_orientation(&image) * 4)
            {
                check(cancel)?;
                for (rgb, pixel) in row.iter_mut().zip(pixels.as_chunks::<4>().0) {
                    *rgb = [pixel[0], pixel[1], pixel[2]];
                }
                transform.transform_in_place(&mut row);
                for (rgb, pixel) in row.iter().zip(pixels.as_chunks_mut::<4>().0) {
                    pixel[..3].copy_from_slice(rgb);
                }
            }
        } else if source.color_space() == ColorSpaceSignature::GrayData {
            let transform: Transform<u8, [u8; 3]> = Transform::new(
                &source,
                PixelFormat::GRAY_8,
                &destination,
                PixelFormat::RGB_8,
                Intent::RelativeColorimetric,
            )
            .map_err(|_| invalid("无法转换灰度色彩配置"))?;
            for pixels in rgba
                .as_mut()
                .chunks_exact_mut(width_after_orientation(&image) * 4)
            {
                check(cancel)?;
                let gray: Vec<_> = pixels.as_chunks::<4>().0.iter().map(|p| p[0]).collect();
                let mut rgb = vec![[0; 3]; gray.len()];
                transform.transform_pixels(&gray, &mut rgb);
                for (color, pixel) in rgb.iter().zip(pixels.as_chunks_mut::<4>().0) {
                    pixel[..3].copy_from_slice(color);
                }
            }
        } else {
            return Err(invalid("暂不支持此图片的色彩配置，请转换为 sRGB"));
        }
    }
    check(cancel)?;
    Ok(DynamicImage::ImageRgba8(rgba))
}
fn width_after_orientation(image: &DynamicImage) -> usize {
    image.width() as usize
}

fn jpeg_has_four_components(bytes: &[u8]) -> bool {
    // image's JPEG decoder reports RGB even for CMYK/YCCK. Inspect the SOF
    // component count before that implicit conversion can discard this distinction.
    let mut offset = 2;
    while bytes.get(offset) == Some(&0xff) {
        while bytes.get(offset) == Some(&0xff) {
            offset += 1;
        }
        let Some(&marker) = bytes.get(offset) else {
            break;
        };
        offset += 1;
        if marker == 0xda || marker == 0xd9 {
            break;
        }
        if marker == 0x01 || (0xd0..=0xd8).contains(&marker) {
            continue;
        }
        let Some(length) = bytes.get(offset..offset + 2) else {
            break;
        };
        let length = usize::from(u16::from_be_bytes([length[0], length[1]]));
        if length < 2 || offset + length > bytes.len() {
            break;
        }
        if matches!(marker, 0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf) {
            return length >= 8 && bytes[offset + 7] == 4;
        }
        offset += length;
    }
    false
}

pub fn resize(image: DynamicImage, size: Size, cancel: &AtomicBool) -> Result<DynamicImage> {
    if (image.width(), image.height()) == (size.width, size.height) {
        return Ok(image);
    }
    // Filter premultiplied colors so hidden RGB in transparent pixels cannot bleed
    // into visible edges. Keep bounded RGBA8 buffers instead of full float images.
    let mut rgba = image.into_rgba8();
    for row in rgba.rows_mut() {
        check(cancel)?;
        for pixel in row {
            for c in 0..3 {
                pixel[c] = ((u16::from(pixel[c]) * u16::from(pixel[3]) + 127) / 255) as u8;
            }
        }
    }
    let mut output = image::imageops::resize(
        &rgba,
        size.width,
        size.height,
        image::imageops::FilterType::Lanczos3,
    );
    drop(rgba);
    for row in output.rows_mut() {
        check(cancel)?;
        for pixel in row {
            let alpha = u32::from(pixel[3]);
            for c in 0..3 {
                pixel[c] = (u32::from(pixel[c]).min(alpha) * 255 + alpha / 2)
                    .checked_div(alpha)
                    .unwrap_or(0) as u8;
            }
        }
    }
    Ok(DynamicImage::ImageRgba8(output))
}

pub fn png_bytes(image: &RgbaImage) -> Result<Vec<u8>> {
    let mut output = Vec::new();
    let mut encoder = png::Encoder::new(&mut output, image.width(), image.height());
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.set_source_srgb(png::SrgbRenderingIntent::RelativeColorimetric);
    encoder
        .write_header()
        .map_err(codec_error)?
        .write_image_data(image)
        .map_err(codec_error)?;
    Ok(output)
}
fn optimize(bytes: &[u8], cancel: &AtomicBool) -> Result<Vec<u8>> {
    check(cancel)?;
    let mut options = oxipng::Options::from_preset(2);
    options.timeout = Some(std::time::Duration::from_secs(5));
    let optimized = oxipng::optimize_from_memory(bytes, &options).map_err(codec_error)?;
    check(cancel)?;
    Ok(if optimized.len() < bytes.len() {
        optimized
    } else {
        bytes.to_vec()
    })
}

#[derive(Default)]
struct PaletteColorSpace(exoquant::SimpleColorSpace);
impl exoquant::ColorSpace for PaletteColorSpace {
    fn to_linear(&self, color: exoquant::Colorf) -> exoquant::Colorf {
        self.0.to_linear(color)
    }
    fn from_linear(&self, color: exoquant::Colorf) -> exoquant::Colorf {
        // exoquant 0.2's default inverse removes the alpha weight after applying
        // inverse gamma, introducing a systematic brightness bias. Undo the weight
        // first so this internal quantization metric round-trips the source colors.
        let weight = color.a * (1.0 - self.0.transparency_scale) + self.0.transparency_scale;
        let mut straight = color;
        straight.r /= weight;
        straight.g /= weight;
        straight.b /= weight;
        (straight / self.0.scale).pow(1.0 / self.0.gamma)
    }
    fn from_float(&self, color: exoquant::Colorf) -> exoquant::Color {
        let color = self.from_linear(color);
        let byte = |v: f64| (v * 255.0).round().clamp(0.0, 255.0) as u8;
        exoquant::Color::new(byte(color.r), byte(color.g), byte(color.b), byte(color.a))
    }
    fn to_dither(&self, color: exoquant::Colorf) -> exoquant::Colorf {
        self.0.to_dither(color)
    }
    fn from_dither(&self, color: exoquant::Colorf) -> exoquant::Colorf {
        self.0.from_dither(color)
    }
}

pub(super) fn palette_png(image: &RgbaImage, cancel: &AtomicBool) -> Result<Option<Vec<u8>>> {
    use exoquant::{Color, Histogram, Remapper, ditherer, optimizer};
    // Bound palette training independently of image resolution; remapping is streamed and
    // cancellation is checked every row. Only a 256-color candidate is attempted.
    let step = (image.width() as usize * image.height() as usize)
        .div_ceil(65_536)
        .max(1);
    let histogram: Histogram = image
        .pixels()
        .step_by(step)
        .map(|p| Color::new(p[0], p[1], p[2], p[3]))
        .collect();
    let colorspace = PaletteColorSpace::default();
    let palette = exoquant::generate_palette(&histogram, &colorspace, &optimizer::KMeans, 256);
    check(cancel)?;
    let dithering = ditherer::FloydSteinberg::new();
    let remapper = Remapper::new(&palette, &colorspace, &dithering);
    let source = Box::new(image.pixels().map(|p| Color::new(p[0], p[1], p[2], p[3])));
    let mut indices = Vec::with_capacity((image.width() * image.height()) as usize);
    let mut squared = 0.0_f64;
    let mut bias = [0.0_f64; 3];
    let mut count = 0_u64;
    for (i, (index, source)) in remapper
        .remap_iter(source, image.width() as usize)
        .zip(image.pixels())
        .enumerate()
    {
        if i % image.width() as usize == 0 {
            check(cancel)?;
        }
        let color = palette[index as usize];
        // Evaluate on both black and white to catch alpha fringes, and reject overall
        // channel bias. The conservative gate falls back to lossless on difficult photos.
        for background in [0.0, 255.0] {
            for (channel, value) in [color.r, color.g, color.b].iter().enumerate() {
                let original = (f64::from(source[channel]) * f64::from(source[3])
                    + background * f64::from(255 - source[3]))
                    / 255.0;
                let mapped = (f64::from(*value) * f64::from(color.a)
                    + background * f64::from(255 - color.a))
                    / 255.0;
                let delta = mapped - original;
                if delta.abs() > 16.0 {
                    return Ok(None);
                }
                squared += delta * delta;
                bias[channel] += delta;
            }
            count += 1;
        }
        if source[3].abs_diff(color.a) > 2 {
            return Ok(None);
        }
        indices.push(index);
    }
    if (squared / (count as f64 * 3.0)).sqrt() > 3.0
        || bias.iter().any(|sum| (sum / count as f64).abs() > 0.75)
    {
        return Ok(None);
    }
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, image.width(), image.height());
        encoder.set_color(png::ColorType::Indexed);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_palette(
            palette
                .iter()
                .flat_map(|p| [p.r, p.g, p.b])
                .collect::<Vec<_>>(),
        );
        encoder.set_trns(palette.iter().map(|p| p.a).collect::<Vec<_>>());
        encoder.set_source_srgb(png::SrgbRenderingIntent::RelativeColorimetric);
        encoder
            .write_header()
            .map_err(codec_error)?
            .write_image_data(&indices)
            .map_err(codec_error)?;
    }
    Ok(Some(optimize(&bytes, cancel)?))
}

pub fn encode(
    image: &RgbaImage,
    format: Format,
    quality: u8,
    limit: usize,
    cancel: &AtomicBool,
) -> Result<(Vec<u8>, Option<u8>, bool)> {
    if format == Format::Png {
        let lossless = optimize(&png_bytes(image)?, cancel)?;
        if lossless.len() <= limit {
            return Ok((lossless, None, false));
        }
        let reduced = palette_png(image, cancel)?;
        if let Some(bytes) = reduced.as_ref().filter(|b| b.len() <= limit) {
            return Ok((bytes.clone(), None, true));
        }
        let best = reduced
            .as_ref()
            .map_or(lossless.len(), |b| b.len().min(lossless.len()));
        return Err(too_large(best, limit));
    }
    let rgb = if format == Format::Jpeg {
        Some(image::RgbImage::from_fn(
            image.width(),
            image.height(),
            |x, y| {
                let p = image.get_pixel(x, y);
                image::Rgb([0, 1, 2].map(|c| {
                    ((u32::from(p[c]) * u32::from(p[3]) + 255 * u32::from(255 - p[3]) + 127) / 255)
                        as u8
                }))
            },
        ))
    } else {
        None
    };
    let encode_quality = |q| -> Result<Vec<u8>> {
        check(cancel)?;
        let bytes = match &rgb {
            Some(rgb) => {
                let mut bytes = Vec::new();
                image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, q)
                    .encode_image(rgb)
                    .map_err(codec_error)?;
                bytes
            }
            None => webp::Encoder::from_rgba(image, image.width(), image.height())
                .encode_simple(false, f32::from(q))
                .map_err(codec_error)?
                .to_vec(),
        };
        check(cancel)?;
        Ok(bytes)
    };
    let bytes = encode_quality(quality)?;
    if bytes.len() <= limit {
        return Ok((bytes, Some(quality), true));
    }
    let low = encode_quality(60)?;
    if low.len() > limit {
        return Err(too_large(low.len().min(bytes.len()), limit));
    }
    let mut best = (low, 60);
    let (mut left, mut right) = (61, quality.saturating_sub(1));
    while left <= right {
        let middle = left + (right - left) / 2;
        let candidate = encode_quality(middle)?;
        if candidate.len() <= limit {
            best = (candidate, middle);
            left = middle + 1;
        } else {
            right = middle - 1;
        }
    }
    Ok((best.0, Some(best.1), true))
}
fn too_large(actual: usize, limit: usize) -> ImageError {
    ImageError {
        code: "IMAGE_TOO_LARGE",
        message: format!(
            "在保留尺寸和基本观感的条件下无法达到体积上限：当前最小结果 {actual} B，上限 {limit} B。请调整未锁定的参数或更换图片。"
        ),
    }
}

#[cfg(test)]
mod color_space_tests {
    use super::PaletteColorSpace;
    use exoquant::{Color, ColorSpace};

    #[test]
    fn quantization_metric_round_trips_rgb_and_alpha_without_brightness_bias() {
        let space = PaletteColorSpace::default();
        for alpha in [0, 1, 17, 100, 255] {
            for value in 0..=255 {
                let color = Color::new(value, 255 - value, value / 2, alpha);
                let restored = space.from_float(space.to_float(color));
                assert!(
                    color == restored,
                    "internal color conversion must be reversible"
                );
            }
        }
    }
}
