package com.example.pressdock

import java.net.URI

// 纯策略与 Android UI 分离，供 JVM 测试验证首请求 UA 和导航边界。
internal object HarvestPolicy {
    fun desktopUserAgent(defaultAgent: String, providerVersion: String?): String {
        val version = Regex("Chrome/([0-9]+(?:\\.[0-9]+){1,3})").find(defaultAgent)?.groupValues?.get(1)
            ?: providerVersion?.takeIf { it.matches(Regex("[0-9]+(?:\\.[0-9]+){1,3}")) }
            ?: error("无法识别网页组件版本")
        require(version.substringBefore('.').toInt() >= 111)
        return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/$version Safari/537.36"
    }

    fun navigationAllowed(value: String): Boolean = runCatching {
        if (value == "about:blank") return true
        val uri = URI(value)
        val host = uri.host?.lowercase() ?: return false
        // 正式 Android 工程保持禁止明文流量；不为采集降低网络安全策略。
        uri.scheme.equals("https", true) && uri.port == -1 && uri.rawUserInfo == null &&
            (host == "baidu.com" || host.endsWith(".baidu.com"))
    }.getOrDefault(false)

    fun reference(value: String): String {
        require(value.matches(Regex("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")))
        return value
    }
}
