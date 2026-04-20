async function createServerJob(payload) {
  const resp = await fetch(`/api/jobs/${payload.task_type}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const raw = await resp.text();
  const contentType = resp.headers.get("content-type") || "";

  let data = null;
  if (contentType.includes("application/json")) {
    try {
      data = JSON.parse(raw);
    } catch (err) {
      throw new Error(`JSON parse edilemedi. İlk içerik: ${raw.slice(0, 200)}`);
    }
  }

  if (!resp.ok) {
    throw new Error(
      data?.detail ||
      `Backend error. HTTP ${resp.status}. Cevap: ${raw.slice(0, 200)}`
    );
  }

  return data;
}