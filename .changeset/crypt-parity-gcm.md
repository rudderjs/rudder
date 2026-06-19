---
"@rudderjs/crypt": major
---

**Breaking:** IV encoding changed from hex to base64 to match Laravel's `Encrypter` wire format — existing 1.x ciphertexts must be re-encrypted after upgrading.

New features: AES-256-GCM cipher support (`cipher: 'aes-256-gcm'` in `CryptConfig`), `Crypt.supported()` static method, and `SupportedCipher` exported type. Decryption auto-detects the cipher from the payload shape so CBC ciphertexts remain readable after switching to GCM.
