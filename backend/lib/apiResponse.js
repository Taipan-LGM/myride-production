/** Consistent API success envelope. */
export function sendSuccess(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}
