// Vercel Serverless Function - Routes API (computeRoutes)
// Aceita horário de partida (departureTime) para usar trânsito histórico daquele horário.

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "GOOGLE_MAPS_API_KEY não configurada" });

  const { points, optimize, departureTime } = req.body || {};

  if (!points || points.length < 2) {
    return res.status(400).json({ error: "Mínimo 2 pontos" });
  }

  const origin = points[0];
  const destination = points[points.length - 1];
  const intermediates = points.slice(1, -1);

  // Monta timestamp do horário de partida.
  // Se o horário já passou hoje, usa amanhã (senão Google recusa).
  let departureTimestamp = null;
  if (departureTime && /^\d{2}:\d{2}$/.test(departureTime)) {
    const [hh, mm] = departureTime.split(":").map(Number);
    const now = new Date();
    const target = new Date(now);
    target.setHours(hh, mm, 0, 0);
    if (target.getTime() <= now.getTime() + 60 * 1000) {
      target.setDate(target.getDate() + 1);
    }
    departureTimestamp = target.toISOString();
  }

  const body = {
    origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
    destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_AWARE_OPTIMAL",
    optimizeWaypointOrder: !!optimize,
    languageCode: "es-CL",
    units: "METRIC"
  };

  if (departureTimestamp) body.departureTime = departureTimestamp;

  if (intermediates.length > 0) {
    body.intermediates = intermediates.map(p => ({
      location: { latLng: { latitude: p.lat, longitude: p.lng } }
    }));
  }

  try {
    const r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.legs.duration,routes.legs.distanceMeters,routes.optimizedIntermediateWaypointIndex"
      },
      body: JSON.stringify(body)
    });

    const data = await r.json();

    if (!r.ok || !data.routes?.length) {
      return res.status(500).json({ error: "Routes API erro", details: data });
    }

    const route = data.routes[0];
    const legs = (route.legs || []).map(leg => ({
      durationSec: parseInt((leg.duration || "0s").replace("s", ""), 10),
      distanceMeters: leg.distanceMeters || 0
    }));

    return res.status(200).json({
      optimizedOrder: route.optimizedIntermediateWaypointIndex || [],
      totalDurationSec: parseInt((route.duration || "0s").replace("s", ""), 10),
      totalDistanceMeters: route.distanceMeters || 0,
      legs: legs
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
