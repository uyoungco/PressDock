package com.example.pressdock

import org.junit.Assert.*
import org.junit.Test
import javax.crypto.KeyGenerator

class HarvestPolicyTest {
    @Test fun desktopUaKeepsKernelVersionAndRemovesMobileMarkers() {
        val agent = HarvestPolicy.desktopUserAgent("Mozilla/5.0 (Linux; Android 10; ONEPLUS A5000 Build/QKQ1; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/156.0.8078.47 Mobile Safari/537.36", null)
        assertEquals("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.47 Safari/537.36", agent)
        listOf("Android", "Mobile", "wv", "Version/4.0").forEach { assertFalse(agent.contains(it)) }
        assertEquals(agent, HarvestPolicy.desktopUserAgent("unknown", "156.0.8078.47"))
        assertTrue(runCatching { HarvestPolicy.desktopUserAgent("unknown", null) }.isFailure)
        assertTrue(runCatching { HarvestPolicy.desktopUserAgent("Chrome/110.0.0.0", null) }.isFailure)
    }

    @Test fun navigationRejectsSchemesCredentialsPortsAndLookalikeHosts() {
        listOf("about:blank", "https://baijiahao.baidu.com/s?id=1", "https://passport.baidu.com/login", "https://mbd.baidu.com/newspage/data/landingsuper?id=1").forEach { assertTrue(it, HarvestPolicy.navigationAllowed(it)) }
        listOf("javascript:alert(1)", "file:///secret", "intent://baidu.com", "http://baidu.com", "https://baidu.com.evil.test", "https://evilbaidu.com", "https://user@baidu.com", "https://baidu.com:443").forEach { assertFalse(it, HarvestPolicy.navigationAllowed(it)) }
    }

    @Test fun aiEnvelopesAreBoundToReferenceAndRejectCorruption() {
        val first = "5f3e3406-f3e5-435c-aa72-a4721daa0a00"
        val second = "5f3e3406-f3e5-435c-aa72-a4721daa0a01"
        val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val encrypted = AiSecretEnvelope.encode(first, "演示密钥", key)
        assertEquals("演示密钥", AiSecretEnvelope.decode(first, encrypted, key))
        assertTrue(runCatching { AiSecretEnvelope.decode(second, encrypted, key) }.isFailure)
        encrypted[encrypted.lastIndex] = (encrypted.last().toInt() xor 1).toByte()
        assertTrue(runCatching { AiSecretEnvelope.decode(first, encrypted, key) }.isFailure)
        assertTrue(runCatching { HarvestPolicy.reference("../cms-session") }.isFailure)
    }
}
