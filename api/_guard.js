// Guarda compartilhada dos endpoints.
// 1) Bloqueia chamadas de outros sites (proteção básica da cota Google).
//    Permite: deploys *.vercel.app do projeto (inclui previews) e localhost.
//    Requests sem Origin/Referer (ex: curl) passam — proteção é contra abuso
//    via navegador de terceiros, que é o vetor barato de queimar cota.
// 2) Helper de CORS.
export function origemPermitida(req) {
  const ref = req.headers.origin || req.headers.referer || "";
  if (!ref) return true;
  const ok =
    ref.includes("localhost") ||
    ref.includes("127.0.0.1") ||
    (ref.includes("welovechile") && ref.includes("vercel.app"));
  return ok;
}

export function aplicarCors(req, res, metodos) {
  const ref = req.headers.origin || "";
  // Só ecoa a origem se for permitida; senão não manda header nenhum.
  if (ref && origemPermitida(req)) {
    res.setHeader("Access-Control-Allow-Origin", ref);
  }
  res.setHeader("Access-Control-Allow-Methods", metodos);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
