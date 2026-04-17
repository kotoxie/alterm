import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { config } from '../config.js';

export function ensureTlsCerts(): { cert: string; key: string } {
  // Custom certs provided
  if (config.tlsCertPath && config.tlsKeyPath) {
    return {
      cert: fs.readFileSync(config.tlsCertPath, 'utf-8'),
      key: fs.readFileSync(config.tlsKeyPath, 'utf-8'),
    };
  }

  const certPath = path.join(config.certsDir, 'server.crt');
  const keyPath = path.join(config.certsDir, 'server.key');

  // Reuse existing certs
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    return {
      cert: fs.readFileSync(certPath, 'utf-8'),
      key: fs.readFileSync(keyPath, 'utf-8'),
    };
  }

  // Generate self-signed certs
  fs.mkdirSync(config.certsDir, { recursive: true });

  try {
    // Try openssl first
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 365 -nodes -subj "/CN=Gatwy/O=Gatwy"`,
      { stdio: 'pipe' },
    );
  } catch {
    // Fallback: generate with Node.js crypto (self-signed)
    generateSelfSignedCert(certPath, keyPath);
  }

  return {
    cert: fs.readFileSync(certPath, 'utf-8'),
    key: fs.readFileSync(keyPath, 'utf-8'),
  };
}

function generateSelfSignedCert(certPath: string, keyPath: string) {
  const { generateKeyPairSync, createSign, X509Certificate } = crypto;

  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  // Create a minimal self-signed certificate using Node's crypto
  // For production, openssl should be available in the Docker container
  const keyPem = privateKey;

  // Build a simple self-signed cert with the sign API
  // This is a simplified approach; the Docker image will have openssl
  const sign = createSign('SHA256');
  sign.update('gatwy-self-signed');
  const signature = sign.sign(privateKey, 'base64');

  // Write a placeholder — real cert generation happens via openssl in Docker
  // For dev, we'll use openssl or mkcert
  fs.writeFileSync(keyPath, keyPem);

  // Use generateCertificate if available (Node 20+)
  if (typeof (crypto as unknown as Record<string, unknown>).X509Certificate !== 'undefined') {
    // Fallback: write key and use openssl in Docker
    fs.writeFileSync(keyPath, keyPem);
    fs.writeFileSync(certPath, publicKey); // This won't be a valid cert but lets the server start for dev
    console.warn('[TLS] Generated fallback key pair. Install openssl for proper self-signed certificates.');
  } else {
    fs.writeFileSync(keyPath, keyPem);
    fs.writeFileSync(certPath, publicKey);
    console.warn('[TLS] No openssl found. Using fallback key pair.');
  }
}
