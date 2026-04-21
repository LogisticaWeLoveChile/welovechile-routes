import React, { useState, useMemo, useEffect } from "react";
import { styles } from "./styles.js";

// ============================================================
// WeLoveChile Route Dispatcher v5 (Google Maps integrado - B3)
// Estratégia híbrida:
//  1. Geocoding API: cada endereço → coordenada real (com cache)
//  2. Cluster por setor (comuna real do Google) respeitando vetor do tour
//  3. Routes API: dentro de cada cluster, ordem otimizada por ruas reais
//  4. Concatena os clusters na ordem do vetor
// ============================================================

var TOURS_DEFAULT = [
  { nome: "Valle Nevado", horario: "05:00", vetor: "leste" },
  { nome: "Farellones", horario: "06:00", vetor: "leste" },
  { nome: "El Colorado", horario: "05:00", vetor: "leste" },
  { nome: "Astronómico Santiago", horario: "14:30", vetor: "sudeste" },
  { nome: "Concha y Toro", horario: "07:00", vetor: "sul" },
  { nome: "Cousiño Macul", horario: "12:00", vetor: "leste" },
  { nome: "Embalse El Yeso", horario: "05:00", vetor: "sudeste" },
  { nome: "Isla Negra", horario: "07:30", vetor: "oeste" },
  { nome: "Parque Safari", horario: "07:30", vetor: "sul" },
  { nome: "Portillo", horario: "05:00", vetor: "norte" },
  { nome: "Santa Rita", horario: "08:00", vetor: "sul" },
  { nome: "El Principal", horario: "14:00", vetor: "sul" },
  { nome: "Termas da Colina", horario: "05:00", vetor: "sudeste" },
  { nome: "Transporte Alyan", horario: "14:30", vetor: "sul" },
  { nome: "Undurraga", horario: "07:30", vetor: "oeste" },
  { nome: "Valparaíso", horario: "06:30", vetor: "oeste" }
];

var TIPOS_VAN_DEFAULT = [
  { id: "t6", capacidade: 6 }, { id: "t8", capacidade: 8 }, { id: "t9", capacidade: 9 },
  { id: "t10", capacidade: 10 }, { id: "t15", capacidade: 15 },
  { id: "t18", capacidade: 18 }, { id: "t19", capacidade: 19 }
];

// Determina setor por COORDENADAS (mais confiável que nome de comuna)
// Santiago tem longitudes: Oeste ~-70.70 ... Leste ~-70.50
//                          latitudes centrais:  ~-33.45
// Setores são faixas verticais de longitude
function setorPorCoordenadas(lat, lng) {
  if (!lat || !lng) return 99;
  // Fora de Santiago (lat muito fora da faixa) → outro
  if (lat < -33.65 || lat > -33.30) return 99;
  if (lng < -70.80 || lng > -70.45) return 99;

  // Faixas de longitude (ajustadas para Santiago)
  if (lng < -70.660) return 1; // Estación Central / Quinta Normal / Pudahuel
  if (lng < -70.625) return 2; // Centro histórico (Plaza de Armas, Alameda, Lastarria)
  if (lng < -70.585) return 3; // Providencia (Manuel Montt, Pedro de Valdivia, Los Leones)
  return 4;                     // Las Condes / Vitacura / Lo Barnechea
}

function nomeSetor(setor) {
  if (setor === 1) return "Est. Central";
  if (setor === 2) return "Centro";
  if (setor === 3) return "Providencia";
  if (setor === 4) return "Las Condes";
  return "Outro";
}

function direcaoSetores(vetor) {
  // Ordem em que os setores devem aparecer na rota
  if (vetor === "leste" || vetor === "norte" || vetor === "sudeste" || vetor === "nordeste") {
    return [1, 2, 3, 4, 99]; // Oeste -> Leste
  }
  return [4, 3, 2, 1, 99]; // Leste -> Oeste
}

// ============================================================
// CACHE GEOCODING (localStorage)
// ============================================================
var CACHE_KEY = "wlc_geocache_v1";
function carregarCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); }
  catch (e) { return {}; }
}
function salvarCache(c) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch (e) {}
}
function chaveCache(end) {
  return end.toLowerCase().trim().replace(/\s+/g, " ").replace(/[.,]/g, "");
}

function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function geocodificar(endereco, cache, tentativa) {
  tentativa = tentativa || 1;
  var k = chaveCache(endereco);
  if (cache[k]) return { ...cache[k], fonte: "cache" };

  try {
    var resp = await fetch("/api/geocode?address=" + encodeURIComponent(endereco));
    if (!resp.ok) {
      var err = await resp.json().catch(function () { return {}; });
      // Tenta novamente até 3 vezes em caso de erro temporário
      if (tentativa < 3) {
        await delay(500 * tentativa);
        return await geocodificar(endereco, cache, tentativa + 1);
      }
      return { erro: err.error || "Erro " + resp.status };
    }
    var data = await resp.json();
    var resultado = {
      lat: data.lat, lng: data.lng,
      comuna: data.comuna,
      setor: setorPorCoordenadas(data.lat, data.lng),
      formatted: data.formatted
    };
    cache[k] = resultado;
    salvarCache(cache);
    return { ...resultado, fonte: "api" };
  } catch (e) {
    if (tentativa < 3) {
      await delay(500 * tentativa);
      return await geocodificar(endereco, cache, tentativa + 1);
    }
    return { erro: "Falha de rede: " + e.message };
  }
}

// ============================================================
// HAVERSINE + tempo estimado por distância (fallback quando Routes API falha)
// ============================================================
function distanciaKm(lat1, lng1, lat2, lng2) {
  var R = 6371;
  var toRad = function (x) { return (x * Math.PI) / 180; };
  var dLat = toRad(lat2 - lat1);
  var dLng = toRad(lng2 - lng1);
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function tempoEstimadoMin(a, b) {
  if (!a.lat || !b.lat) return 10;
  var km = distanciaKm(a.lat, a.lng, b.lat, b.lng);
  var mesmoSetor = a.setor === b.setor;
  var fatorMalha = mesmoSetor ? 1.35 : 1.55;
  var velocKmH = mesmoSetor ? 22 : 28;
  var min = (km * fatorMalha / velocKmH) * 60 + 1.5;
  return arredondar5(min);
}

// ============================================================
// ROTAS API (otimização real)
// ============================================================
async function otimizarRota(pontos) {
  if (pontos.length < 2) return { ordem: pontos.map(function (_, i) { return i; }), legs: [] };

  try {
    var resp = await fetch("/api/routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points: pontos, optimize: true })
    });
    if (!resp.ok) {
      var err = await resp.json().catch(function () { return {}; });
      return { erro: err.error || "Routes erro" };
    }
    var data = await resp.json();
    // optimizedOrder vem só com os intermediários reordenados
    // Reconstrói a ordem completa: [0, ...optimized+1, last]
    var n = pontos.length;
    var ordem = [0];
    (data.optimizedOrder || []).forEach(function (i) { ordem.push(i + 1); });
    ordem.push(n - 1);
    return { ordem: ordem, legs: data.legs || [] };
  } catch (e) {
    return { erro: e.message };
  }
}

// ============================================================
// PARSER COLAGEM (formato sistema atual)
// ============================================================
function parseColagem(texto) {
  var linhas = texto.split("\n").map(function (l) { return l.trim(); }).filter(function (l) { return l.length > 0; });
  var reservas = [];
  for (var i = 0; i < linhas.length; i++) {
    var linha = linhas[i];
    linha = linha.replace(/^\d+\s*[\)\.\-]\s*/, "");
    linha = linha.replace(/^~?\d{1,2}:\d{2}\s*[\/\-]\s*/, "");

    var matchSoma = linha.match(/(\d+)\s*\+\s*(\d+)\s*pax/i);
    var matchPax = linha.match(/(\d+)\s*pax/i);
    var pax = 0, semPax = linha;
    if (matchSoma) { pax = parseInt(matchSoma[1]) + parseInt(matchSoma[2]); semPax = linha.replace(matchSoma[0], "").trim(); }
    else if (matchPax) { pax = parseInt(matchPax[1]); semPax = linha.replace(matchPax[0], "").trim(); }

    semPax = semPax.replace(/^[\/\-\s]+/, "").replace(/[\/\-\s]+$/, "").trim();
    var partes = semPax.split(/\s*[\/]\s*/).map(function (p) { return p.trim(); }).filter(Boolean);
    var endereco = partes.length > 0 ? partes[partes.length - 1] : semPax;

    if (pax === 0) {
      var m = endereco.match(/^(\d+)\s+(.+)$/);
      if (m && parseInt(m[1]) <= 20 && m[2].match(/[a-zA-Z]/)) {
        pax = parseInt(m[1]); endereco = m[2].trim();
      }
    }

    if (endereco.length > 0 && pax > 0) {
      reservas.push({
        id: "r" + Date.now() + "_" + i + "_" + Math.random().toString(36).substring(2, 6),
        endereco: endereco, passageiros: pax
      });
    }
  }
  return reservas;
}

// ============================================================
// UNIFICAR ENDEREÇOS IDÊNTICOS
// ============================================================
function unificarReservas(reservas) {
  var mapa = {}, ordem = [];
  reservas.forEach(function (r) {
    var k = chaveCache(r.endereco);
    if (mapa[k]) {
      mapa[k].passageiros += r.passageiros;
      mapa[k].origens.push(r.passageiros);
    } else {
      mapa[k] = { id: r.id, endereco: r.endereco, passageiros: r.passageiros, origens: [r.passageiros] };
      ordem.push(k);
    }
  });
  return ordem.map(function (k) { return mapa[k]; });
}

// ============================================================
// HORÁRIOS
// ============================================================
function somarMinutos(hora, min) {
  var p = hora.split(":");
  var total = parseInt(p[0]) * 60 + parseInt(p[1]) + min;
  while (total < 0) total += 24 * 60;
  var h = Math.floor(total / 60) % 24, m = total % 60;
  return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
}
function arredondar5(min) {
  var r = Math.round(min / 5) * 5;
  return r < 3 ? 3 : r;
}

// ============================================================
// EXPANDIR VANS POR QUANTIDADE
// ============================================================
function expandirVans(tipos, ativos) {
  var resultado = [];
  tipos.forEach(function (t) {
    var qtd = ativos[t.id] || 0;
    for (var i = 0; i < qtd; i++) {
      resultado.push({ id: t.id + "_" + i, nome: "Van " + t.capacidade + "p" + (qtd > 1 ? " #" + (i + 1) : ""), capacidade: t.capacidade });
    }
  });
  return resultado;
}

function alocarVans(reservas, vans) {
  var total = reservas.reduce(function (s, r) { return s + r.passageiros; }, 0);
  var vMenor = vans.slice().sort(function (a, b) { return a.capacidade - b.capacidade; });
  for (var i = 0; i < vMenor.length; i++) {
    if (vMenor[i].capacidade >= total) {
      return [{ vanId: vMenor[i].id, reservaIds: reservas.map(function (r) { return r.id; }) }];
    }
  }
  var vMaior = vans.slice().sort(function (a, b) { return b.capacidade - a.capacidade; });
  var rotas = [], rest = reservas.slice();
  while (rest.length > 0 && vMaior.length > 0) {
    var v = vMaior.shift(), grupo = [], pax = 0;
    while (rest.length > 0 && pax + rest[0].passageiros <= v.capacidade) {
      var r = rest.shift(); grupo.push(r.id); pax += r.passageiros;
    }
    if (grupo.length > 0) rotas.push({ vanId: v.id, reservaIds: grupo });
  }
  return rotas;
}

// ============================================================
// LINK GOOGLE MAPS
// ============================================================
function linkMaps(reservas) {
  if (reservas.length === 0) return "#";
  var pts = reservas.map(function (r) { return encodeURIComponent((r.formatted || r.endereco) + ", Santiago, Chile"); });
  if (pts.length === 1) return "https://www.google.com/maps/search/?api=1&query=" + pts[0];
  var url = "https://www.google.com/maps/dir/?api=1&origin=" + pts[0] + "&destination=" + pts[pts.length - 1];
  if (pts.length > 2) url += "&waypoints=" + pts.slice(1, -1).join("|");
  return url + "&travelmode=driving";
}

// ============================================================
// ALGORITMO PRINCIPAL B3
// 1. Geocodifica todos
// 2. Agrupa por setor (na ordem do vetor)
// 3. Pra cada setor, chama Routes API otimizando ordem interna
// 4. Concatena tudo + calcula horários a partir do início
// ============================================================
async function processarRotaB3(reservas, vetor, horarioInicio, cache, onProgress) {
  // 1. Geocodifica todos (em série, com pausa leve entre chamadas)
  var enriquecidos = [];
  for (var i = 0; i < reservas.length; i++) {
    if (onProgress) onProgress("Geocodificando " + (i + 1) + "/" + reservas.length + ": " + reservas[i].endereco);
    var geo = await geocodificar(reservas[i].endereco, cache);
    enriquecidos.push({ ...reservas[i], ...geo });
    // Pausa curta pra não sobrecarregar a API
    if (i < reservas.length - 1) await delay(150);
  }

  // 2. Separa não geocodificados (vão pro final)
  var ok = enriquecidos.filter(function (r) { return r.lat && r.lng; });
  var falhos = enriquecidos.filter(function (r) { return !r.lat; });

  var ordenadosFinal = [];

  if (ok.length === 0) {
    ordenadosFinal = [];
  } else if (ok.length === 1) {
    ordenadosFinal = ok;
  } else if (ok.length === 2) {
    // 2 pontos: ordena pela direção do vetor
    var ascendente2 = (vetor === "leste" || vetor === "norte" || vetor === "sudeste" || vetor === "nordeste");
    ordenadosFinal = ok.slice().sort(function (a, b) {
      return ascendente2 ? a.lng - b.lng : b.lng - a.lng;
    });
  } else {
    // 3+ pontos: fixa extremos pelo vetor, Google otimiza o meio livremente
    var ascendente = (vetor === "leste" || vetor === "norte" || vetor === "sudeste" || vetor === "nordeste");

    // Ordena por longitude e pega os extremos
    var porLng = ok.slice().sort(function (a, b) { return a.lng - b.lng; });
    var maisOeste = porLng[0];
    var maisLeste = porLng[porLng.length - 1];

    // Entrada (primeiro ponto da rota) e saída (último) conforme vetor
    var entrada = ascendente ? maisOeste : maisLeste;
    var saida = ascendente ? maisLeste : maisOeste;
    var meio = ok.filter(function (r) { return r !== entrada && r !== saida; });

    if (onProgress) onProgress("Otimizando rota (" + ok.length + " paradas) via Google...");

    // Monta pontos: entrada + meio + saida
    var pts = [{ lat: entrada.lat, lng: entrada.lng }]
      .concat(meio.map(function (r) { return { lat: r.lat, lng: r.lng }; }))
      .concat([{ lat: saida.lat, lng: saida.lng }]);

    var rotaOtim = await otimizarRota(pts);
    if (rotaOtim.erro) {
      // Fallback: ordena por longitude respeitando vetor
      ordenadosFinal = ok.slice().sort(function (a, b) {
        return ascendente ? a.lng - b.lng : b.lng - a.lng;
      });
    } else {
      var todos = [entrada].concat(meio).concat([saida]);
      ordenadosFinal = rotaOtim.ordem.map(function (i) { return todos[i]; });
    }
  }

  // 5. Adiciona falhos no final
  ordenadosFinal = ordenadosFinal.concat(falhos);
  var todasLegs = [];

  // 6. Calcula tempos REAIS entre paradas consecutivas (uma chamada Routes só pra tempos)
  if (ordenadosFinal.filter(function (r) { return r.lat; }).length >= 2) {
    if (onProgress) onProgress("Calculando tempos reais...");
    var ptsFinal = ordenadosFinal.filter(function (r) { return r.lat; }).map(function (r) { return { lat: r.lat, lng: r.lng }; });
    var temposReq = await fetch("/api/routes", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points: ptsFinal, optimize: false })
    });
    if (temposReq.ok) {
      var tempData = await temposReq.json();
      todasLegs = tempData.legs || [];
    }
  }

  // 7. Aplica horários
  var horarios = [], deslocs = [];
  var idxLeg = 0;
  for (var j = 0; j < ordenadosFinal.length; j++) {
    if (j === 0) {
      horarios[j] = horarioInicio;
      deslocs[j] = 0;
    } else {
      var min;
      var atual = ordenadosFinal[j], anterior = ordenadosFinal[j - 1];
      if (atual.lat && anterior.lat && todasLegs[idxLeg]) {
        // Usa tempo real do Google, arredondando ao múltiplo de 5 mais próximo
        min = arredondar5(todasLegs[idxLeg].durationSec / 60 + 1.5);
        idxLeg++;
      } else if (atual.lat && anterior.lat) {
        // Fallback por distância Haversine
        min = tempoEstimadoMin(anterior, atual);
      } else {
        min = 10;
      }
      deslocs[j] = min;
      horarios[j] = somarMinutos(horarios[j - 1], min);
    }
  }

  return ordenadosFinal.map(function (r, i) {
    return { ...r, horario: horarios[i], deslocamentoMin: deslocs[i] };
  });
}

// ============================================================
// COMPONENTE
// ============================================================
export default function App() {
  var [tours, setTours] = useState(TOURS_DEFAULT);
  var [tiposVan, setTiposVan] = useState(TIPOS_VAN_DEFAULT);
  var [tourSel, setTourSel] = useState("Valle Nevado");
  var [horarioCustom, setHorarioCustom] = useState("");
  var [colagem, setColagem] = useState("");
  var [reservas, setReservas] = useState([]);
  var [vansAtivas, setVansAtivas] = useState({});
  var [resultado, setResultado] = useState(null);
  var [processando, setProcessando] = useState(false);
  var [statusMsg, setStatusMsg] = useState("");
  var [abaConfig, setAbaConfig] = useState(false);
  var [cache, setCache] = useState({});
  var [dragging, setDragging] = useState(null);

  useEffect(function () { setCache(carregarCache()); }, []);

  var tourAtual = tours.find(function (t) { return t.nome === tourSel; }) || tours[0];
  var horarioEf = horarioCustom || tourAtual.horario;
  var vansExp = useMemo(function () { return expandirVans(tiposVan, vansAtivas); }, [tiposVan, vansAtivas]);
  var totalPax = reservas.reduce(function (s, r) { return s + r.passageiros; }, 0);
  var totalCap = vansExp.reduce(function (s, v) { return s + v.capacidade; }, 0);

  function aplicarColagem() { setReservas(parseColagem(colagem)); }
  function atualizarReserva(id, campo, val) {
    setReservas(reservas.map(function (r) {
      if (r.id !== id) return r;
      return { ...r, [campo]: campo === "passageiros" ? parseInt(val) || 0 : val };
    }));
  }
  function removerReserva(id) { setReservas(reservas.filter(function (r) { return r.id !== id; })); }
  function addManual() {
    setReservas(reservas.concat([{ id: "r" + Date.now(), endereco: "", passageiros: 1 }]));
  }
  function ajustarVan(id, d) {
    var atual = vansAtivas[id] || 0;
    setVansAtivas({ ...vansAtivas, [id]: Math.max(0, atual + d) });
  }
  function limparTudo() {
    setColagem(""); setReservas([]); setResultado(null); setHorarioCustom(""); setVansAtivas({});
  }
  function limparCache() {
    if (confirm("Limpar cache de geocoding? Próximas consultas vão pra API novamente.")) {
      localStorage.removeItem(CACHE_KEY); setCache({}); alert("Cache limpo.");
    }
  }

  async function gerarRota() {
    if (reservas.length === 0 || vansExp.length === 0) return;
    setProcessando(true);
    setStatusMsg("Iniciando...");
    setResultado(null);

    try {
      var unificadas = unificarReservas(reservas);
      var processadas = await processarRotaB3(unificadas, tourAtual.vetor, horarioEf, cache, setStatusMsg);
      setStatusMsg("Alocando vans...");
      var alocacao = alocarVans(processadas, vansExp);

      var rotasFinais = alocacao.map(function (a) {
        var van = vansExp.find(function (v) { return v.id === a.vanId; });
        var rs = a.reservaIds.map(function (id) { return processadas.find(function (p) { return p.id === id; }); }).filter(Boolean);
        // Recalcula horários partindo do horário inicial pra cada van
        var horarios = [], deslocs = [];
        for (var i = 0; i < rs.length; i++) {
          if (i === 0) { horarios[i] = horarioEf; deslocs[i] = 0; }
          else { deslocs[i] = rs[i].deslocamentoMin || 10; horarios[i] = somarMinutos(horarios[i - 1], deslocs[i]); }
        }
        var rsFinais = rs.map(function (r, i) { return { ...r, horario: horarios[i], deslocamentoMin: deslocs[i] }; });
        var totalPaxR = rsFinais.reduce(function (s, r) { return s + r.passageiros; }, 0);
        return { van: van, reservas: rsFinais, totalPax: totalPaxR, excesso: totalPaxR > van.capacidade, linkMaps: linkMaps(rsFinais) };
      });

      setResultado({ rotas: rotasFinais });
      setStatusMsg("");
    } catch (e) {
      setStatusMsg("Erro: " + e.message);
    } finally {
      setProcessando(false);
    }
  }

  // Drag & drop
  function onDragStart(rId, rotaIdx) { setDragging({ rId: rId, rotaIdx: rotaIdx }); }
  function onDragOver(e) { e.preventDefault(); }
  async function onDrop(target) {
    if (!dragging || dragging.rotaIdx === target) { setDragging(null); return; }
    setProcessando(true);
    setStatusMsg("Recalculando rotas após movimento...");

    try {
      // Monta as novas listas de reservas por rota
      var novasListas = resultado.rotas.map(function (r, i) {
        if (i === dragging.rotaIdx) {
          return r.reservas.filter(function (x) { return x.id !== dragging.rId; });
        }
        if (i === target) {
          var movido = resultado.rotas[dragging.rotaIdx].reservas.find(function (x) { return x.id === dragging.rId; });
          return r.reservas.concat([movido]);
        }
        return r.reservas;
      });

      // Remove rotas vazias e mantém a van associada
      var novasRotas = [];
      for (var i = 0; i < resultado.rotas.length; i++) {
        if (novasListas[i].length === 0) continue;
        var rotaOriginal = resultado.rotas[i];

        // Reprocessa a rota (cluster + otimização do Google) com as reservas novas
        var reprocessadas = await processarRotaB3(novasListas[i], tourAtual.vetor, horarioEf, cache, setStatusMsg);
        var tp = reprocessadas.reduce(function (s, r) { return s + r.passageiros; }, 0);

        novasRotas.push({
          van: rotaOriginal.van,
          reservas: reprocessadas,
          totalPax: tp,
          excesso: tp > rotaOriginal.van.capacidade,
          linkMaps: linkMaps(reprocessadas)
        });
      }

      setResultado({ rotas: novasRotas });
      setStatusMsg("");
    } catch (e) {
      setStatusMsg("Erro ao recalcular: " + e.message);
    } finally {
      setProcessando(false);
      setDragging(null);
    }
  }

  // Render
  return (
    <div style={styles.app}>
      <div style={styles.grain}></div>

      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.logo}>◈</div>
          <div>
            <div style={styles.brand}>WeLoveChile</div>
            <div style={styles.subBrand}>Route Dispatcher · Santiago · v5.2 · Google Maps</div>
          </div>
        </div>
        <div style={styles.headerRight}>
          <button style={!abaConfig ? styles.tabActive : styles.tab} onClick={function () { setAbaConfig(false); }}>ROTEIRIZAR</button>
          <button style={abaConfig ? styles.tabActive : styles.tab} onClick={function () { setAbaConfig(true); }}>CONFIGURAÇÃO</button>
        </div>
      </header>

      {!abaConfig && (
        <main style={styles.main}>
          <section style={styles.col}>
            {/* Tour */}
            <div style={styles.panel}>
              <div style={styles.pHead}><span style={styles.pNum}>01</span><span style={styles.pTitle}>TOUR & HORÁRIO</span></div>
              <div style={styles.field}>
                <label style={styles.label}>Tour</label>
                <select value={tourSel} onChange={function (e) { setTourSel(e.target.value); setHorarioCustom(""); }} style={styles.select}>
                  {tours.map(function (t) { return <option key={t.nome} value={t.nome}>{t.nome} · {t.horario} · {t.vetor}</option>; })}
                </select>
              </div>
              <div style={styles.fieldRow}>
                <div style={styles.fieldHalf}>
                  <label style={styles.label}>Padrão</label>
                  <div style={styles.readonly}>{tourAtual.horario}</div>
                </div>
                <div style={styles.fieldHalf}>
                  <label style={styles.label}>Esta rota</label>
                  <input type="time" value={horarioCustom || tourAtual.horario} onChange={function (e) { setHorarioCustom(e.target.value); }} style={styles.input} />
                </div>
              </div>
              <div style={styles.meta}>
                <span style={styles.chip}>vetor <strong>{tourAtual.vetor}</strong></span>
                <span style={styles.chipHL}>1ª parada: <strong>{horarioEf}</strong></span>
              </div>
            </div>

            {/* Vans */}
            <div style={styles.panel}>
              <div style={styles.pHead}>
                <span style={styles.pNum}>02</span><span style={styles.pTitle}>VANS DISPONÍVEIS</span>
                <div style={styles.pHeadAct}><button style={styles.miniBtn} onClick={function () { setVansAtivas({}); }}>limpar</button></div>
              </div>
              <div style={styles.vanList}>
                {tiposVan.slice().sort(function (a, b) { return a.capacidade - b.capacidade; }).map(function (t) {
                  var q = vansAtivas[t.id] || 0;
                  return (
                    <div key={t.id} style={q > 0 ? styles.vanRowAct : styles.vanRow}>
                      <div style={styles.vanLbl}><span style={styles.vanCap}>{t.capacidade}</span><span style={styles.vanSuf}>pax</span></div>
                      <div style={styles.counter}>
                        <button style={q === 0 ? styles.cBtnD : styles.cBtn} onClick={function () { ajustarVan(t.id, -1); }} disabled={q === 0}>−</button>
                        <div style={styles.cVal}>{q}</div>
                        <button style={styles.cBtn} onClick={function () { ajustarVan(t.id, 1); }}>+</button>
                      </div>
                      <div style={styles.vanTot}>{q > 0 ? "= " + (q * t.capacidade) + " pax" : ""}</div>
                    </div>
                  );
                })}
              </div>
              <div style={styles.capInfo}>
                <div style={styles.capItem}><span style={styles.capLbl}>Pax total</span><span style={styles.capVal}>{totalPax}</span></div>
                <div style={styles.capSep}>/</div>
                <div style={styles.capItem}><span style={styles.capLbl}>Capacidade</span>
                  <span style={totalCap === 0 ? styles.capValM : totalCap >= totalPax ? styles.capValOk : styles.capValAl}>{totalCap}</span>
                </div>
              </div>
            </div>

            {/* Reservas */}
            <div style={styles.panel}>
              <div style={styles.pHead}>
                <span style={styles.pNum}>03</span><span style={styles.pTitle}>RESERVAS</span>
                <div style={styles.pHeadAct}>{reservas.length > 0 && <span style={styles.cntBadge}>{reservas.length}</span>}</div>
              </div>
              <label style={styles.label}>Cole a lista do sistema atual</label>
              <textarea style={styles.textarea} placeholder={"1) 06:30 / 4 PAX / Carmen 77\n2) ~21:00 / 2 PAX / Manuel Montt 234"} value={colagem} onChange={function (e) { setColagem(e.target.value); }} rows={5} />
              <div style={styles.btnRow}>
                <button style={colagem.trim() ? styles.btnSec : styles.btnSecD} onClick={aplicarColagem} disabled={!colagem.trim()}>
                  ↓ PROCESSAR COLAGEM
                </button>
              </div>

              {reservas.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={styles.listHead}>Reservas detectadas</div>
                  <div style={styles.resList}>
                    {reservas.map(function (r, i) {
                      return (
                        <div key={r.id} style={styles.resRow}>
                          <div style={styles.resNum}>{i + 1}</div>
                          <input type="text" value={r.endereco} onChange={function (e) { atualizarReserva(r.id, "endereco", e.target.value); }} style={styles.resEnd} />
                          <input type="number" min="1" value={r.passageiros} onChange={function (e) { atualizarReserva(r.id, "passageiros", e.target.value); }} style={styles.resPax} />
                          <span style={styles.paxSuf}>p</span>
                          <button style={styles.btnRem} onClick={function () { removerReserva(r.id); }}>×</button>
                        </div>
                      );
                    })}
                  </div>
                  <button style={styles.btnAdd} onClick={addManual}>+ adicionar manual</button>
                </div>
              )}
            </div>

            <div style={styles.acts}>
              <button style={reservas.length > 0 && vansExp.length > 0 && !processando ? styles.btnPri : styles.btnPriD}
                onClick={gerarRota} disabled={reservas.length === 0 || vansExp.length === 0 || processando}>
                {processando ? "PROCESSANDO..." : "→ GERAR ROTA"}
              </button>
              <button style={styles.btnGh} onClick={limparTudo}>Limpar</button>
            </div>

            {processando && statusMsg && (
              <div style={styles.statusBox}>⚙ {statusMsg}</div>
            )}
          </section>

          {/* Resultado */}
          <section style={styles.col}>
            <div style={styles.panel}>
              <div style={styles.pHead}><span style={styles.pNum}>04</span><span style={styles.pTitle}>ROTAS GERADAS</span></div>

              {!resultado && !processando && (
                <div style={styles.empty}>
                  <div style={styles.emptyMark}>∅</div>
                  <div>Aguardando entrada.</div>
                  <div style={styles.emptyHint}>
                    O sistema vai geocodificar via Google,<br />
                    agrupar por setor respeitando o vetor do tour,<br />
                    e otimizar a ordem real dentro de cada setor.
                  </div>
                </div>
              )}

              {resultado && (
                <div>
                  {resultado.rotas.length > 1 && <div style={styles.dragHint}>↕ arraste clientes entre rotas</div>}

                  {resultado.rotas.map(function (rota, idx) {
                    var ocup = rota.van ? Math.round((rota.totalPax / rota.van.capacidade) * 100) : 0;
                    var dropT = dragging && dragging.rotaIdx !== idx;
                    return (
                      <div key={idx} style={dropT ? styles.rotaDrop : styles.rota} onDragOver={onDragOver} onDrop={function () { onDrop(idx); }}>
                        <div style={styles.rotaHead}>
                          <span style={styles.rotaNum}>ROTA {idx + 1}</span>
                          <span style={styles.rotaVan}>{rota.van.nome}</span>
                          <span style={styles.rotaPax}>{rota.totalPax}/{rota.van.capacidade} pax</span>
                          <span style={styles.rotaOcup(ocup, rota.excesso)}>{rota.excesso ? "EXCESSO" : ocup + "%"}</span>
                        </div>
                        <div style={styles.paradas}>
                          {rota.reservas.map(function (r, i) {
                            var unif = r.origens && r.origens.length > 1;
                            return (
                              <div key={r.id} draggable onDragStart={function () { onDragStart(r.id, idx); }} style={styles.parada}>
                                <div style={styles.pDrag}>⋮⋮</div>
                                <div style={styles.pNum}>{i + 1}</div>
                                <div style={styles.pHora}>{r.horario}</div>
                                <div style={styles.pInfo}>
                                  <div style={styles.pEnd}>{r.endereco}</div>
                                  <div style={styles.pMeta}>
                                    {i > 0 && r.deslocamentoMin > 0 && <span style={styles.deslocCh}>+{r.deslocamentoMin}min</span>}
                                    {r.comuna && <span style={styles.comunaCh}>{r.comuna}</span>}
                                    {unif && <span style={styles.unifCh}>{r.origens.length} reservas · {r.origens.join("+")}</span>}
                                    {!r.lat && <span style={styles.errCh}>não geocodificado</span>}
                                  </div>
                                </div>
                                <div style={styles.pRight}>
                                  <span style={styles.setorCh(r.setor)}>{nomeSetor(r.setor)}</span>
                                  <span style={styles.paxBadge}>{r.passageiros}p</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <a href={rota.linkMaps} target="_blank" rel="noopener noreferrer" style={styles.mapsLink}>
                          ▶ VERIFICAR NO GOOGLE MAPS ↗
                        </a>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </main>
      )}

      {abaConfig && (
        <main style={styles.mainConfig}>
          <section style={styles.panel}>
            <div style={styles.pHead}><span style={styles.pNum}>◉</span><span style={styles.pTitle}>TIPOS DE VAN</span></div>
            <div style={styles.cfgList}>
              {tiposVan.map(function (t, i) {
                return (
                  <div key={t.id} style={styles.cfgRow}>
                    <span style={styles.cfgLbl}>Capacidade</span>
                    <input style={styles.inputN} type="number" value={t.capacidade} onChange={function (e) {
                      var n = tiposVan.slice(); n[i] = { ...n[i], capacidade: parseInt(e.target.value) || 0 }; setTiposVan(n);
                    }} />
                    <span style={styles.capLbl}>pax</span>
                    <button style={styles.btnRem} onClick={function () { setTiposVan(tiposVan.filter(function (_, j) { return j !== i; })); }}>×</button>
                  </div>
                );
              })}
              <button style={styles.btnGhF} onClick={function () { setTiposVan(tiposVan.concat([{ id: "t" + Date.now(), capacidade: 10 }])); }}>+ adicionar tipo</button>
            </div>
          </section>

          <section style={styles.panel}>
            <div style={styles.pHead}><span style={styles.pNum}>◉</span><span style={styles.pTitle}>HORÁRIOS PADRÃO</span></div>
            <div style={styles.cfgList}>
              {tours.map(function (t, i) {
                return (
                  <div key={t.nome} style={styles.cfgRow}>
                    <div style={styles.tourNm}>{t.nome}</div>
                    <input style={styles.inputT} type="time" value={t.horario} onChange={function (e) {
                      var n = tours.slice(); n[i] = { ...n[i], horario: e.target.value }; setTours(n);
                    }} />
                    <span style={styles.vetCh}>{t.vetor}</span>
                  </div>
                );
              })}
            </div>
          </section>

          <section style={styles.panel}>
            <div style={styles.pHead}><span style={styles.pNum}>◉</span><span style={styles.pTitle}>CACHE DE GEOCODING</span></div>
            <div style={styles.cfgHint}>
              Endereços já consultados: <strong>{Object.keys(cache).length}</strong>.<br />
              Cada endereço repetido NÃO consome API.
            </div>
            <button style={styles.btnGhF} onClick={limparCache}>Limpar cache</button>
          </section>
        </main>
      )}

      <footer style={styles.footer}>
        <span>WeLoveChile · v5 · Google Maps integrado</span>
        <span style={styles.fHint}>{Object.keys(cache).length} endereços em cache</span>
      </footer>
    </div>
  );
}
