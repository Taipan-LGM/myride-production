function parseDriverIdFromQrText(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const isValidLogiclineExternalId = (id) => {
    const s = String(id || "").trim();
    // Keep in sync with backend default: `ll-<token>`
    return /^ll-[a-z0-9][a-z0-9-]{2,63}$/i.test(s);
  };

  const normalize = (id) => String(id || "").trim();

  // Try JSON payloads commonly used by QR integrations
  try {
    const obj = JSON.parse(raw);
    const candidates = [
      obj.external_driver_id,
      obj.driver_id,
      obj.driverId,
      obj.id,
      obj.qr_id,
      obj.qrId,
    ].filter(Boolean);
    for (const c of candidates) {
      const v = normalize(c);
      if (isValidLogiclineExternalId(v)) return v;
    }
  } catch {
    // ignore
  }

  // Allow URLs that embed ?driver_id=...
  try {
    const u = new URL(raw);
    const qp =
      u.searchParams.get("external_driver_id") ||
      u.searchParams.get("driver_id") ||
      u.searchParams.get("id");
    if (qp) {
      const v = normalize(qp);
      if (isValidLogiclineExternalId(v)) return v;
    }
  } catch {
    // ignore
  }

  // Fallback: treat entire QR text as the driver id token (strict)
  if (isValidLogiclineExternalId(raw)) return normalize(raw);
  return null;
}

async function decodeWithBarcodeDetector(video) {
  if (!("BarcodeDetector" in window)) return null;
  const detector = new BarcodeDetector({ formats: ["qr_code"] });
  const bitmap = await createImageBitmap(video);
  const codes = await detector.detect(bitmap);
  if (!codes?.length) return null;
  const qr = codes.find((c) => c.format === "qr_code") || codes[0];
  return qr?.rawValue || null;
}

function decodeWithJsQr(video, canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;

  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(video, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, w, h);

  // jsQR is loaded via script tag as global `jsQR`
  // eslint-disable-next-line no-undef
  const result = jsQR(imgData.data, w, h, { inversionAttempts: "attemptBoth" });
  return result?.data || null;
}

export async function scanQrFromCamera({ signal, videoEl } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera not supported in this browser");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: "environment" } },
  });

  if (signal?.aborted) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error("aborted");
  }

  const video = videoEl || document.createElement("video");
  video.setAttribute("playsinline", "");
  video.muted = true;
  video.srcObject = stream;
  await video.play();

  const canvas = document.createElement("canvas");

  const started = Date.now();
  const timeoutMs = 45_000;

  try {
    while (Date.now() - started < timeoutMs) {
      if (signal?.aborted) throw new Error("aborted");

      let text = await decodeWithBarcodeDetector(video).catch(() => null);
      if (!text && globalThis.jsQR) {
        text = decodeWithJsQr(video, canvas);
      }

      if (text) {
        const driverId = parseDriverIdFromQrText(text);
        stream.getTracks().forEach((t) => t.stop());
        if (!driverId) {
          throw new Error("QR does not contain a valid Logicline Driver ID");
        }
        return { raw: text, driverId };
      }

      await new Promise((r) => requestAnimationFrame(r));
    }

    stream.getTracks().forEach((t) => t.stop());
    throw new Error("No QR detected");
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    throw e;
  }
}
