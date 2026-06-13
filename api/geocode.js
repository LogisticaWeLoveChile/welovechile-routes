// Vercel Serverless Function - Geocoding
// A chave NUNCA é exposta ao navegador.
// v7.1: guarda de origem + diferencia "não encontrado" (404) de rate limit (429)
// e erro de servidor (502), pra o cliente decidir certo quando fazer retry.

import { origemPermitida, aplicarCors } from "./_guard.js";

export default async function handler(req, res) {
  aplicarCors(req, res, "GET, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (!origemPermitida(req)) return res.status(403).json({ error: "Origem não autorizada" });

  const address = req.query.address;
  if (!address) return res.status(400).json({ error: "address obrigatório" });

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "GOOGLE_MAPS_API_KEY não configurada" });

  let busca = address;

  // v7.4: "Metro X" solto geocodifica mal (Tobalaba caiu em Macul).
  // Reescreve pra "Estación de Metro X", que o Google resolve direito.
  if (/\bmetro\b/i.test(busca) && !/estaci[oó]n/i.test(busca)) {
    busca = busca.replace(/\bmetro\b\s*/i, "Estación de Metro ");
  }

  if (!/chile/i.test(busca)) {
    if (!/santiago/i.test(busca)) busca += ", Santiago";
    busca += ", Chile";
  }

  // bounds = viés pro Gran Santiago: desempata resultados ambíguos
  // a favor de localizações dentro da cidade (sudoeste|nordeste)
  const url = "https://maps.googleapis.com/maps/api/geocode/json"
    + "?address=" + encodeURIComponent(busca)
    + "&bounds=" + encodeURIComponent("-33.65,-70.85|-33.30,-70.45")
    + "&region=cl&language=es&key=" + apiKey;

  try {
    const r = await fetch(url);
    const data = await r.json();

    if (data.status === "OVER_QUERY_LIMIT") {
      return res.status(429).json({ error: "Limite de consultas do Google atingido", status: data.status });
    }
    if (data.status !== "OK" || !data.results?.length) {
      const status = data.status === "ZERO_RESULTS" ? 404 : 502;
      return res.status(status).json({ error: "Endereço não encontrado", status: data.status });
    }

    const result = data.results[0];
    let comuna = null;
    for (const c of (result.address_components || [])) {
      if (c.types.includes("administrative_area_level_3") || c.types.includes("locality")) {
        comuna = c.long_name; break;
      }
    }

    return res.status(200).json({
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      formatted: result.formatted_address,
      comuna: comuna,
      placeId: result.place_id
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
