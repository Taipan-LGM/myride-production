/** My Ride staff QR login card parsing (separate from Logicline driver QR in qrScan.js). */

export function isValidStaffExternalId(id) {
  const s = String(id || "").trim();
  return /^mr-staff-[a-z0-9][a-z0-9-]{2,63}$/i.test(s);
}

export function parseStaffIdFromQrText(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const normalize = (id) => String(id || "").trim();

  try {
    const obj = JSON.parse(raw);
    const candidates = [
      obj.external_staff_id,
      obj.staff_id,
      obj.staffId,
      obj.id,
      obj.qr_id,
      obj.qrId,
    ].filter(Boolean);
    for (const c of candidates) {
      const v = normalize(c);
      if (isValidStaffExternalId(v)) return v;
    }
  } catch {
    // ignore
  }

  try {
    const u = new URL(raw);
    const qp =
      u.searchParams.get("external_staff_id") ||
      u.searchParams.get("staff_id") ||
      u.searchParams.get("id");
    if (qp) {
      const v = normalize(qp);
      if (isValidStaffExternalId(v)) return v;
    }
  } catch {
    // ignore
  }

  if (isValidStaffExternalId(raw)) return normalize(raw);
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

  // eslint-disable-next-line no-undef
  const result = jsQR(imgData.data, w, h, { inversionAttempts: "attemptBoth" });
  return result?.data || null;
}

export async function scanStaffQrFromCamera({ signal, videoEl } = {}) {
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
        const staffId = parseStaffIdFromQrText(text);
        stream.getTracks().forEach((t) => t.stop());
        if (!staffId) {
          throw new Error("QR does not contain a valid My Ride staff card ID");
        }
        return { raw: text, staffId };
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
