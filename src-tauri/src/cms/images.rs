use super::{CmsError, PromoteImage};
use base64::{Engine, engine::general_purpose::STANDARD};
use reqwest::{Client, StatusCode, header};
use std::time::Duration;
use tokio::sync::Semaphore;
use url::Url;

pub(super) struct ImageLoader {
    client: Client,
    slots: Semaphore,
    pub(super) limit: usize,
    pub(super) timeout: Duration,
    #[cfg(test)]
    pub(super) allow_loopback_http: bool,
}

impl ImageLoader {
    pub(super) fn new() -> Result<Self, reqwest::Error> {
        Ok(Self {
            // 独立客户端：不使用 CMS 的认证头，不启用 Cookie 存储。
            client: Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(30))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            slots: Semaphore::new(4),
            limit: 20 * 1024 * 1024,
            timeout: Duration::from_secs(30),
            #[cfg(test)]
            allow_loopback_http: false,
        })
    }

    pub(super) fn accepts(&self, value: &str) -> bool {
        Url::parse(value).is_ok_and(|url| {
            if !url.username().is_empty() || url.password().is_some() || url.host().is_none() {
                return false;
            }
            if url.scheme() == "https" {
                return true;
            }
            // 仅测试构建允许本地服务器；发布构建没有 HTTP 例外。
            #[cfg(test)]
            if self.allow_loopback_http && url.scheme() == "http" {
                return matches!(url.host_str(), Some("127.0.0.1" | "[::1]"));
            }
            false
        })
    }

    pub(super) async fn load(&self, value: &str) -> Result<PromoteImage, CmsError> {
        let _slot = self
            .slots
            .acquire()
            .await
            .map_err(|_| image_error("图片加载已取消"))?;
        tokio::time::timeout(self.timeout, self.download(value))
            .await
            .map_err(|_| image_error("图片加载超时，请重试"))?
    }

    async fn download(&self, value: &str) -> Result<PromoteImage, CmsError> {
        let mut url = Url::parse(value).map_err(|_| image_error("图片地址无效"))?;
        for redirects in 0..=3 {
            if !self.accepts(url.as_str()) {
                return Err(image_error("图片重定向地址必须使用 HTTPS"));
            }
            let mut response = self
                .client
                .get(url.clone())
                .send()
                .await
                .map_err(network_error)?;
            if matches!(
                response.status(),
                StatusCode::MOVED_PERMANENTLY
                    | StatusCode::FOUND
                    | StatusCode::SEE_OTHER
                    | StatusCode::TEMPORARY_REDIRECT
                    | StatusCode::PERMANENT_REDIRECT
            ) {
                if redirects == 3 {
                    return Err(image_error("图片重定向超过 3 次"));
                }
                let location = response
                    .headers()
                    .get(header::LOCATION)
                    .and_then(|v| v.to_str().ok())
                    .ok_or_else(|| image_error("图片重定向地址无效"))?;
                url = url
                    .join(location)
                    .map_err(|_| image_error("图片重定向地址无效"))?;
                continue;
            }
            if !response.status().is_success() {
                // 图片服务器的 401 不属于 CMS 认证错误。
                return Err(image_error(format!(
                    "图片服务器返回 {}，请重试",
                    response.status().as_u16()
                )));
            }
            let mime_type = response
                .headers()
                .get(header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .split(';')
                .next()
                .unwrap_or("")
                .trim()
                .to_ascii_lowercase();
            if !mime_type.starts_with("image/") {
                return Err(image_error("服务器未返回有效的图片类型"));
            }
            let mut bytes = Vec::new();
            // Content-Length 可能缺失或不准确；以实际读取字节数执行限制。
            while let Some(chunk) = response.chunk().await.map_err(network_error)? {
                if chunk.len() > self.limit.saturating_sub(bytes.len()) {
                    return Err(CmsError::new("IMAGE_TOO_LARGE", "图片超过 20 MiB 限制"));
                }
                bytes.extend_from_slice(&chunk);
            }
            if bytes.is_empty() {
                return Err(image_error("图片内容为空"));
            }
            return Ok(PromoteImage {
                mime_type,
                byte_size: bytes.len(),
                data_base64: STANDARD.encode(bytes),
            });
        }
        unreachable!("redirect loop always returns")
    }
}

fn image_error(message: impl Into<String>) -> CmsError {
    CmsError::new("IMAGE_LOAD", message)
}
fn network_error(error: reqwest::Error) -> CmsError {
    image_error(if error.is_timeout() {
        "图片加载超时，请重试"
    } else {
        "图片下载失败，请重试"
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{method, path},
    };

    fn loader() -> ImageLoader {
        let mut loader = ImageLoader::new().unwrap();
        loader.allow_loopback_http = true;
        loader
    }

    #[tokio::test]
    async fn reads_actual_bytes_without_authentication_or_cookies() {
        let server = MockServer::start().await;
        Mock::given(path("/image"))
            .and(method("GET"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("Content-Type", "image/png; charset=binary")
                    .set_body_bytes(b"image bytes".to_vec()),
            )
            .mount(&server)
            .await;
        let image = loader()
            .load(&format!("{}/image", server.uri()))
            .await
            .unwrap();
        assert_eq!(image.mime_type, "image/png");
        assert_eq!(image.byte_size, 11);
        assert_eq!(STANDARD.decode(image.data_base64).unwrap(), b"image bytes");
        let requests = server.received_requests().await.unwrap();
        assert!(!requests[0].headers.contains_key("authorization"));
        assert!(!requests[0].headers.contains_key("cookie"));
    }

    #[tokio::test]
    async fn missing_length_uses_body_and_incorrect_length_is_an_error() {
        for length in [None, Some(100)] {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let url = format!("http://{}/image", listener.local_addr().unwrap());
            let server = std::thread::spawn(move || {
                let (mut socket, _) = listener.accept().unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut buffer = [0; 4096];
                assert!(socket.read(&mut buffer).unwrap() > 0);
                let length = length
                    .map(|n| format!("Content-Length: {n}\r\n"))
                    .unwrap_or_default();
                write!(socket, "HTTP/1.0 200 OK\r\nContent-Type: image/png\r\n{length}Connection: close\r\n\r\nabcde").unwrap();
            });
            let result = loader().load(&url).await;
            server.join().unwrap();
            if length.is_none() {
                assert_eq!(result.unwrap().byte_size, 5);
            } else {
                assert_eq!(result.err().unwrap().code, "IMAGE_LOAD");
            }
        }
    }

    #[tokio::test]
    async fn enforces_actual_size_timeout_mime_and_image_http_errors() {
        let server = MockServer::start().await;
        for (name, response) in [
            (
                "large",
                ResponseTemplate::new(200)
                    .insert_header("Content-Type", "image/jpeg")
                    .set_body_bytes(vec![0; 101]),
            ),
            (
                "slow",
                ResponseTemplate::new(200)
                    .insert_header("Content-Type", "image/png")
                    .set_body_bytes(vec![0; 5])
                    .set_delay(Duration::from_millis(200)),
            ),
            (
                "html",
                ResponseTemplate::new(200).set_body_string("<html>error</html>"),
            ),
            ("unauthorized", ResponseTemplate::new(401)),
        ] {
            Mock::given(path(format!("/{name}")))
                .respond_with(response)
                .mount(&server)
                .await;
        }
        let mut loader = loader();
        loader.limit = 100;
        loader.timeout = Duration::from_millis(80);
        assert_eq!(
            loader
                .load(&format!("{}/large", server.uri()))
                .await
                .err()
                .unwrap()
                .code,
            "IMAGE_TOO_LARGE"
        );
        assert!(
            loader
                .load(&format!("{}/slow", server.uri()))
                .await
                .err()
                .unwrap()
                .message
                .contains("超时")
        );
        assert!(
            loader
                .load(&format!("{}/html", server.uri()))
                .await
                .is_err()
        );
        assert_eq!(
            loader
                .load(&format!("{}/unauthorized", server.uri()))
                .await
                .err()
                .unwrap()
                .code,
            "IMAGE_LOAD"
        );
    }

    #[tokio::test]
    async fn follows_up_to_three_redirects_and_rejects_unsafe_targets() {
        let server = MockServer::start().await;
        for i in 0..4 {
            Mock::given(path(format!("/{i}")))
                .respond_with(
                    ResponseTemplate::new(302).insert_header("Location", format!("/{}", i + 1)),
                )
                .mount(&server)
                .await;
        }
        Mock::given(path("/4"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("Content-Type", "image/png")
                    .set_body_bytes(b"image".to_vec()),
            )
            .mount(&server)
            .await;
        let loader = loader();
        assert_eq!(
            loader
                .load(&format!("{}/1", server.uri()))
                .await
                .unwrap()
                .byte_size,
            5
        );
        assert!(
            loader
                .load(&format!("{}/0", server.uri()))
                .await
                .err()
                .unwrap()
                .message
                .contains("超过 3 次")
        );
        Mock::given(path("/unsafe"))
            .respond_with(
                ResponseTemplate::new(302).insert_header("Location", "http://example.com/image"),
            )
            .mount(&server)
            .await;
        assert!(
            loader
                .load(&format!("{}/unsafe", server.uri()))
                .await
                .is_err()
        );
        let production = ImageLoader::new().unwrap();
        assert!(production.accepts("https://example.com/image"));
        assert!(!production.accepts("http://127.0.0.1/image"));
        assert!(!production.accepts("https://user:password@example.com/image"));
    }
}
