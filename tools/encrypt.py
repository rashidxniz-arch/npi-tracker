#!/usr/bin/env python3
"""Encrypt the tracker data so only people with the team passcode can read it.

Usage:  python3 tools/encrypt.py <plain tracker.json> <passcode> [out=data/tracker.enc.json]

Never commit the plain JSON. Only data/tracker.enc.json goes into the repo.
Format matches the app's WebCrypto decrypt: PBKDF2-SHA256 -> AES-256-GCM.
"""
import base64, json, os, sys
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

ITER = 250_000

def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    src, code = sys.argv[1], sys.argv[2]
    out = sys.argv[3] if len(sys.argv) > 3 else os.path.join(os.path.dirname(__file__), "..", "data", "tracker.enc.json")
    plain = json.dumps(json.load(open(src, encoding="utf-8")), ensure_ascii=False, separators=(",", ":")).encode()
    salt, iv = os.urandom(16), os.urandom(12)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(code.encode())
    ct = AESGCM(key).encrypt(iv, plain, None)
    b64 = lambda b: base64.b64encode(b).decode()
    json.dump({"v": 1, "iter": ITER, "salt": b64(salt), "iv": b64(iv), "ct": b64(ct)}, open(out, "w"))
    print(f"wrote {out} ({len(ct)} bytes)")

if __name__ == "__main__":
    main()
