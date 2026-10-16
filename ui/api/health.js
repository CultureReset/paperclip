export default function handler(req, res) {
  res.status(200).json({
    status: "ok",
    message: "Paperclip UI is deployed. Full backend is not yet connected.",
    timestamp: new Date().toISOString()
  });
}
