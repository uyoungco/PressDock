use super::*;
use image::{ImageDecoder, ImageEncoder, Rgba, RgbaImage};
use std::{io::Cursor, sync::atomic::AtomicBool};

fn flag() -> AtomicBool {
    AtomicBool::new(false)
}
fn source(image: &RgbaImage) -> Input {
    Input {
        data_base64: STANDARD.encode(codec::png_bytes(image).unwrap()),
        mime_type: "image/png".into(),
    }
}
fn request(image: &RgbaImage, format: Format) -> ProcessRequest {
    ProcessRequest {
        job_id: uuid::Uuid::new_v4().to_string(),
        input: source(image),
        crop: Crop {
            x: 0.0,
            y: 0.0,
            width: 1.0,
            height: 1.0,
        },
        size: None,
        format,
        max_bytes: None,
        quality: 90,
    }
}
fn gradient() -> RgbaImage {
    RgbaImage::from_fn(320, 200, |x, y| {
        Rgba([
            (x * 255 / 319) as u8,
            (y * 255 / 199) as u8,
            ((x + y) * 255 / 518) as u8,
            255,
        ])
    })
}
fn decoded(output: &Output) -> image::DynamicImage {
    image::load_from_memory(&STANDARD.decode(&output.data_base64).unwrap()).unwrap()
}

#[test]
fn all_formats_preserve_dimensions_and_have_real_signatures() {
    let image = gradient();
    let original = image.clone();
    for format in [Format::Jpeg, Format::Png, Format::Webp] {
        let output = process(request(&image, format), &flag()).unwrap();
        let bytes = STANDARD.decode(&output.data_base64).unwrap();
        assert_eq!(output.byte_size, bytes.len());
        assert_eq!(codec::identify(&bytes).unwrap(), format);
        assert_eq!(
            (decoded(&output).width(), decoded(&output).height()),
            image.dimensions()
        );
        assert_eq!(output.mime_type, format.mime());
    }
    assert_eq!(image, original);
}

#[test]
fn crop_uses_source_pixels_and_exact_output_not_display_dpi() {
    let image = RgbaImage::from_fn(160, 80, |x, _| {
        if x < 80 {
            Rgba([230, 20, 10, 255])
        } else {
            Rgba([10, 20, 230, 255])
        }
    });
    let mut input = request(&image, Format::Png);
    input.crop = Crop {
        x: 0.5,
        y: 0.0,
        width: 0.5,
        height: 1.0,
    };
    input.size = Some(Size {
        width: 750,
        height: 750,
    });
    let output = process(input, &flag()).unwrap();
    let result = decoded(&output).to_rgba8();
    assert_eq!(result.dimensions(), (750, 750));
    assert_eq!(*result.get_pixel(100, 100), Rgba([10, 20, 230, 255]));
    let mut input = request(&image, Format::Png);
    input.crop = Crop {
        x: 0.5,
        y: 0.0,
        width: 0.5,
        height: 1.0,
    };
    assert_eq!((process(input, &flag()).unwrap().width), 80);
}

#[test]
fn transparent_output_and_jpeg_white_matte() {
    let image = RgbaImage::from_pixel(32, 32, Rgba([200, 30, 40, 0]));
    for format in [Format::Png, Format::Webp] {
        let output = process(request(&image, format), &flag()).unwrap();
        assert_eq!(decoded(&output).to_rgba8().get_pixel(0, 0)[3], 0);
    }
    let output = process(request(&image, Format::Jpeg), &flag()).unwrap();
    let p = decoded(&output).to_rgb8().get_pixel(10, 10).0;
    assert!(p.iter().all(|v| *v >= 250));
}

#[test]
fn enforces_byte_limit_and_searches_quality_without_resizing() {
    let image = gradient();
    for format in [Format::Jpeg, Format::Webp] {
        let (high, _, _) = codec::encode(&image, format, 100, MAX_BYTES, &flag()).unwrap();
        let (low, _, _) = codec::encode(&image, format, 60, MAX_BYTES, &flag()).unwrap();
        assert!(low.len() < high.len());
        let mut input = request(&image, format);
        input.quality = 100;
        input.max_bytes = Some((low.len() + high.len()) / 2);
        let limit = input.max_bytes.unwrap();
        let output = process(input, &flag()).unwrap();
        assert!(output.byte_size <= limit);
        assert_eq!(decoded(&output).width(), 320);
        assert!(output.quality.unwrap() < 100);
    }
    let mut input = request(&image, Format::Png);
    input.max_bytes = Some(1);
    let error = process(input, &flag()).err().unwrap();
    assert_eq!(error.code, "IMAGE_TOO_LARGE");
    assert!(error.message.contains("上限 1 B"));
}

#[test]
fn rejects_invalid_content_mime_resource_limits_and_options() {
    let image = gradient();
    let mut input = request(&image, Format::Png);
    input.input.mime_type = "image/jpeg".into();
    assert!(process(input, &flag()).is_err());
    assert!(
        inspect(
            Input {
                data_base64: STANDARD.encode(b"not an image"),
                mime_type: "image/png".into()
            },
            &flag()
        )
        .is_err()
    );
    assert!(
        inspect(
            Input {
                data_base64: String::new(),
                mime_type: String::new()
            },
            &flag()
        )
        .is_err()
    );
    for size in [
        Size {
            width: 0,
            height: 10,
        },
        Size {
            width: 16385,
            height: 1,
        },
        Size {
            width: 6000,
            height: 6000,
        },
    ] {
        assert!(size.validate().is_err());
    }
    for crop in [
        Crop {
            x: -0.1,
            y: 0.0,
            width: 1.0,
            height: 1.0,
        },
        Crop {
            x: 0.5,
            y: 0.0,
            width: 1.0,
            height: 1.0,
        },
        Crop {
            x: 0.0,
            y: 0.0,
            width: 0.0,
            height: 1.0,
        },
        Crop {
            x: f64::NAN,
            y: 0.0,
            width: 1.0,
            height: 1.0,
        },
    ] {
        assert!(
            crop.pixels(Size {
                width: 100,
                height: 100
            })
            .is_err()
        );
    }
    let mut input = request(&image, Format::Png);
    input.quality = 59;
    assert!(process(input, &flag()).is_err());
    assert_eq!(
        process(request(&image, Format::Png), &AtomicBool::new(true))
            .err()
            .unwrap()
            .code,
        "IMAGE_CANCELLED"
    );
}

#[test]
fn rejects_apng_gif_and_animated_webp() {
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, 2, 2);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_animated(2, 0).unwrap();
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(&[255; 16]).unwrap();
        writer.write_image_data(&[128; 16]).unwrap();
    }
    assert!(
        codec::decode(&bytes, &flag())
            .err()
            .unwrap()
            .message
            .contains("动画 PNG")
    );
    assert!(codec::identify(b"GIF89a\x01\0\x01\0\0\0\0").is_err());
    // Minimal valid extended animation header; no frame is decoded before rejection.
    let mut payload = b"WEBPVP8X".to_vec();
    payload.extend(10_u32.to_le_bytes());
    payload.extend([2, 0, 0, 0, 1, 0, 0, 1, 0, 0]);
    payload.extend(b"ANIM");
    payload.extend(6_u32.to_le_bytes());
    payload.extend([0; 6]);
    let mut webp = b"RIFF".to_vec();
    webp.extend((payload.len() as u32).to_le_bytes());
    webp.extend(payload);
    assert!(codec::decode(&webp, &flag()).is_err());
}

#[test]
fn orientation_is_applied_once_and_removed_on_export() {
    let image = gradient();
    let jpeg = process(request(&image, Format::Jpeg), &flag()).unwrap();
    let bytes = STANDARD.decode(jpeg.data_base64).unwrap();
    // TIFF IFD0 orientation=6 (90 degrees clockwise).
    let exif = b"Exif\0\0II\x2a\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0\x06\0\0\0\0\0\0\0";
    let mut oriented = bytes[..2].to_vec();
    oriented.extend([0xff, 0xe1]);
    oriented.extend(((exif.len() + 2) as u16).to_be_bytes());
    oriented.extend(exif);
    oriented.extend(&bytes[2..]);
    let inspected = inspect(
        Input {
            data_base64: STANDARD.encode(&oriented),
            mime_type: "image/jpeg".into(),
        },
        &flag(),
    )
    .unwrap();
    assert_eq!((inspected.width, inspected.height), (200, 320));
    let mut input = request(&image, Format::Png);
    input.input = Input {
        data_base64: STANDARD.encode(oriented),
        mime_type: "image/jpeg".into(),
    };
    let output = process(input, &flag()).unwrap();
    assert_eq!((output.width, output.height), (200, 320));
    let exported = STANDARD.decode(output.data_base64).unwrap();
    let mut decoder = image::ImageReader::new(Cursor::new(exported))
        .with_guessed_format()
        .unwrap()
        .into_decoder()
        .unwrap();
    assert_eq!(
        decoder.orientation().unwrap(),
        image::metadata::Orientation::NoTransforms
    );
}

#[test]
fn rgb_icc_is_converted_to_srgb_without_discarding_alpha() {
    use lcms2::{CIExyY, CIExyYTRIPLE, Intent, PixelFormat, Profile, ToneCurve, Transform};
    let primaries = CIExyYTRIPLE {
        Red: CIExyY {
            x: 0.64,
            y: 0.33,
            Y: 1.0,
        },
        Green: CIExyY {
            x: 0.21,
            y: 0.71,
            Y: 1.0,
        },
        Blue: CIExyY {
            x: 0.15,
            y: 0.06,
            Y: 1.0,
        },
    };
    let gamma = ToneCurve::new(2.2);
    let adobe = Profile::new_rgb(
        &CIExyY {
            x: 0.3127,
            y: 0.3290,
            Y: 1.0,
        },
        &primaries,
        &[&gamma, &gamma, &gamma],
    )
    .unwrap();
    let srgb = Profile::new_srgb();
    let transform: Transform<[u8; 3], [u8; 3]> = Transform::new(
        &srgb,
        PixelFormat::RGB_8,
        &adobe,
        PixelFormat::RGB_8,
        Intent::RelativeColorimetric,
    )
    .unwrap();
    let original = [[190, 130, 100], [40, 180, 100], [65, 75, 190]];
    let mut converted = [[0; 3]; 3];
    transform.transform_pixels(&original, &mut converted);
    let pixels: Vec<_> = converted
        .iter()
        .flat_map(|p| [p[0], p[1], p[2], 123])
        .collect();
    let mut png = Vec::new();
    {
        let mut encoder = image::codecs::png::PngEncoder::new(&mut png);
        encoder.set_icc_profile(adobe.icc().unwrap()).unwrap();
        encoder
            .write_image(&pixels, 3, 1, image::ExtendedColorType::Rgba8)
            .unwrap();
    }
    let restored = codec::decode(&png, &flag()).unwrap().to_rgba8();
    for (pixel, original) in restored.pixels().zip(original) {
        assert_eq!(pixel[3], 123);
        for c in 0..3 {
            assert!(
                pixel[c].abs_diff(original[c]) <= 3,
                "{pixel:?} vs {original:?}"
            );
        }
    }
}

#[test]
fn png_lossy_gate_rejects_visible_color_and_alpha_errors() {
    let image = gradient();
    let (_, _, lossless) = codec::encode(&image, Format::Png, 90, MAX_BYTES, &flag()).unwrap();
    assert!(!lossless);
    // A varied gradient must not be allowed to meet an impossible target through
    // destructive palette reductions, nor may its dimensions change.
    assert!(codec::encode(&image, Format::Png, 90, 100, &flag()).is_err());
    assert!(codec::palette_png(&image, &flag()).unwrap().is_none());
}

#[test]
fn png_palette_reaches_a_feasible_limit_with_small_color_errors() {
    let mut hash = 0x1234_5678_u32;
    let image = RgbaImage::from_fn(128, 128, |_, _| {
        hash ^= hash << 13;
        hash ^= hash >> 17;
        hash ^= hash << 5;
        Rgba([
            80 + (hash % 9) as u8,
            120 + ((hash / 9) % 9) as u8,
            160 + ((hash / 81) % 9) as u8,
            255,
        ])
    });
    let (lossless, _, _) = codec::encode(&image, Format::Png, 90, MAX_BYTES, &flag()).unwrap();
    let palette = codec::palette_png(&image, &flag())
        .unwrap()
        .expect("subtle color variations should pass the quality gate");
    assert!(palette.len() < lossless.len());
    let mut input = request(&image, Format::Png);
    let limit = (palette.len() + lossless.len()) / 2;
    input.max_bytes = Some(limit);
    let output = process(input, &flag()).unwrap();
    assert!(output.lossy);
    assert!(output.byte_size <= limit);
    assert_eq!(decoded(&output).to_rgba8().dimensions(), (128, 128));
}

#[test]
fn save_creates_new_files_and_never_overwrites_an_original() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("original.png");
    write_new(&path, b"original", &flag()).unwrap();
    assert!(
        write_new(&path, b"replacement", &flag())
            .err()
            .unwrap()
            .message
            .contains("原图不会被覆盖")
    );
    assert_eq!(std::fs::read(path).unwrap(), b"original");
    let cancelled_path = directory.path().join("cancelled.png");
    let cancel = AtomicBool::new(true);
    assert_eq!(
        write_new(&cancelled_path, b"test", &cancel)
            .unwrap_err()
            .code,
        "IMAGE_CANCELLED"
    );
    assert!(!cancelled_path.exists());
}

#[test]
fn resized_transparent_edges_do_not_import_hidden_colors() {
    let pixels = RgbaImage::from_fn(2, 2, |x, _| {
        if x == 0 {
            Rgba([255, 0, 0, 255])
        } else {
            Rgba([0, 0, 255, 0])
        }
    });
    let resized = codec::resize(
        image::DynamicImage::ImageRgba8(pixels),
        Size {
            width: 40,
            height: 40,
        },
        &flag(),
    )
    .unwrap()
    .to_rgba8();
    for pixel in resized.pixels().filter(|p| p[3] > 10) {
        assert_eq!(pixel[0], 255);
        assert_eq!(pixel[1], 0);
        assert_eq!(pixel[2], 0, "hidden blue must not bleed into the red edge");
    }
}

#[test]
fn cmyk_jpeg_header_is_rejected_before_implicit_rgb_decode() {
    let bytes = [
        0xff, 0xd8, 0xff, 0xc0, 0, 20, 8, 0, 1, 0, 1, 4, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0, 4,
        0x11, 0, 0xff, 0xd9,
    ];
    let error = codec::decode(&bytes, &flag()).err().unwrap();
    assert!(error.message.contains("CMYK"));
}

#[tokio::test]
async fn queued_cancel_duplicate_ids_and_cleanup() {
    let jobs = Arc::new(ImageJobs::default());
    let permit = jobs.permit().await.unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let task_jobs = jobs.clone();
    let task_id = id.clone();
    let task = tokio::spawn(async move { task_jobs.run(task_id, |_| Ok(123)).await });
    while !jobs.jobs.lock().unwrap().contains_key(&id) {
        tokio::task::yield_now().await;
    }
    assert!(jobs.begin(id.clone()).is_err());
    jobs.cancel(&id);
    drop(permit);
    assert_eq!(task.await.unwrap().err().unwrap().code, "IMAGE_CANCELLED");
    assert!(jobs.jobs.lock().unwrap().is_empty());
}

// Optional isolated UI QA bridge, executed only by scripts/image-qa.mjs. It uses
// real codecs without adding a login bypass or test endpoint to the application.
#[test]
fn qa_bridge() {
    let Ok(input_path) = std::env::var("PRESSDOCK_IMAGE_QA_INPUT") else {
        return;
    };
    let output_path = std::env::var("PRESSDOCK_IMAGE_QA_OUTPUT").unwrap();
    let request: serde_json::Value =
        serde_json::from_slice(&std::fs::read(input_path).unwrap()).unwrap();
    let result: Result<serde_json::Value> = (|| match request["command"].as_str() {
        Some("image_inspect") => Ok(serde_json::to_value(inspect(
            serde_json::from_value(request["args"]["input"].clone()).map_err(invalid_json)?,
            &flag(),
        )?)
        .unwrap()),
        Some("image_process") => Ok(serde_json::to_value(process(
            serde_json::from_value(request["args"]["request"].clone()).map_err(invalid_json)?,
            &flag(),
        )?)
        .unwrap()),
        _ => Err(invalid("隔离验收只允许图片检查和处理")),
    })();
    let response = match result {
        Ok(value) => serde_json::json!({ "ok": true, "value": value }),
        Err(error) => {
            serde_json::json!({ "ok": false, "error": { "code": error.code, "message": error.message } })
        }
    };
    std::fs::write(output_path, serde_json::to_vec(&response).unwrap()).unwrap();
}
fn invalid_json(error: serde_json::Error) -> ImageError {
    invalid(error.to_string())
}

#[test]
fn generate_visual_samples_when_requested() {
    let Ok(directory) = std::env::var("PRESSDOCK_IMAGE_QA_DIR") else {
        return;
    };
    let directory = std::path::Path::new(&directory);
    std::fs::create_dir_all(directory).unwrap();
    let mut samples = vec![
        ("gradient", gradient()),
        (
            "alpha",
            RgbaImage::from_fn(320, 200, |x, y| {
                Rgba([210, 70, 95, ((x + y) * 255 / 518) as u8])
            }),
        ),
        (
            "screenshot",
            RgbaImage::from_fn(320, 200, |x, y| {
                if y % 24 < 9 && (15..300).contains(&x) {
                    Rgba([28, 28, 28, 255])
                } else {
                    Rgba([248, 248, 248, 255])
                }
            }),
        ),
        (
            "color-card",
            RgbaImage::from_fn(320, 200, |x, _| {
                let colors = [
                    [192, 128, 98, 255],
                    [115, 82, 68, 255],
                    [87, 108, 67, 255],
                    [53, 68, 139, 255],
                    [220, 180, 45, 255],
                    [193, 70, 123, 255],
                    [255, 255, 255, 255],
                    [0, 0, 0, 255],
                ];
                Rgba(colors[(x / 40) as usize])
            }),
        ),
    ];
    if let Ok(path) = std::env::var("PRESSDOCK_IMAGE_QA_PHOTO") {
        samples.push((
            "photo",
            image::open(path).unwrap().thumbnail(960, 640).to_rgba8(),
        ));
    }
    let mut report = String::from("sample,format,width,height,bytes,milliseconds\n");
    for (name, image) in samples {
        std::fs::write(
            directory.join(format!("{name}-source.png")),
            codec::png_bytes(&image).unwrap(),
        )
        .unwrap();
        for format in [Format::Jpeg, Format::Png, Format::Webp] {
            let start = std::time::Instant::now();
            let output = process(request(&image, format), &flag()).unwrap();
            let elapsed = start.elapsed().as_millis();
            std::fs::write(
                directory.join(format!(
                    "{name}-{}.{}",
                    format.extension(),
                    format.extension()
                )),
                STANDARD.decode(&output.data_base64).unwrap(),
            )
            .unwrap();
            report.push_str(&format!(
                "{name},{},{},{},{},{elapsed}\n",
                format.extension(),
                output.width,
                output.height,
                output.byte_size
            ));
        }
    }
    std::fs::write(directory.join("metrics.csv"), report).unwrap();
}
