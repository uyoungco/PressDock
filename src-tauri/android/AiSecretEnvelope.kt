package com.example.pressdock

import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal object AiSecretEnvelope {
    fun encode(reference: String, secret: String, key: SecretKey): ByteArray {
        HarvestPolicy.reference(reference)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.ENCRYPT_MODE, key)
            updateAAD(reference.toByteArray(Charsets.UTF_8))
        }
        return cipher.iv + cipher.doFinal(secret.toByteArray(Charsets.UTF_8))
    }

    fun decode(reference: String, bytes: ByteArray, key: SecretKey): String {
        HarvestPolicy.reference(reference)
        require(bytes.size > 28)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
            updateAAD(reference.toByteArray(Charsets.UTF_8))
        }
        return String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8)
    }
}
