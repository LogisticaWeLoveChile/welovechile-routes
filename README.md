# WeLoveChile Route Dispatcher

Sistema de roteirização inteligente para os tours em Santiago, com integração Google Maps API.

## Como funciona

1. **Geocoding API** converte cada endereço em coordenadas reais (com cache local — endereço repetido = zero custo)
2. **Cluster por setor** (comuna real do Google) respeitando o vetor direcional do tour
3. **Routes API** otimiza a ordem de pickup dentro de cada setor (ruas reais, mãos únicas, trânsito)
4. **Tempos reais** entre paradas calculados pelo Google
5. **Drag & drop** para rebalancear vans manualmente
6. **Link Google Maps** ao final de cada rota para verificação

---

## DEPLOY NO VERCEL — PASSO A PASSO

### Pré-requisitos
- Conta Google Cloud com APIs já ativadas (Geocoding + Routes)
- Chave de API do Google Maps em mãos
- Conta no GitHub (gratuita, em github.com)
- Conta no Vercel (gratuita, em vercel.com — pode logar com a conta GitHub)

### 1. Criar repositório no GitHub

1. Acessa github.com → "New repository"
2. Nome: `welovechile-routes`
3. **Private** (importante, não público)
4. Cria

### 2. Subir os arquivos

**Opção mais fácil (interface web):**
1. Na página do repo recém-criado, clica em "uploading an existing file"
2. Arrasta TODOS os arquivos e pastas (`api/`, `src/`, `package.json`, `vite.config.js`, `index.html`, `vercel.json`, `.gitignore`, `README.md`)
3. Commit

### 3. Conectar Vercel ao GitHub

1. Em vercel.com, clica "Add New" → "Project"
2. Importa o repositório `welovechile-routes`
3. **NÃO clica deploy ainda** — antes precisa adicionar a chave

### 4. Configurar a chave do Google (CRÍTICO)

Na tela de configuração do projeto no Vercel, antes de fazer deploy:

1. Expande **"Environment Variables"**
2. Adiciona:
   - **Name**: `GOOGLE_MAPS_API_KEY`
   - **Value**: sua chave do Google (cola)
   - **Environment**: marca todas (Production, Preview, Development)
3. Clica "Add"

### 5. Deploy

1. Clica **"Deploy"**
2. Espera ~1-2 minutos
3. Vercel vai te dar um link tipo `welovechile-routes-abc123.vercel.app`
4. Clica e testa!

### 6. Restringir a chave Google (depois do primeiro deploy)

Volta no Google Cloud Console → APIs e Credenciais → tua chave → Editar:
- Em **Restrições de aplicação > Sites**, REMOVE o `*` temporário
- Adiciona apenas: `*.vercel.app/*` e o domínio específico do projeto

---

## ATUALIZAR O SISTEMA

Quando precisar de mudanças, novo código:
1. Edita os arquivos no GitHub (interface web mesmo, edita arquivo, commita)
2. Vercel detecta sozinho e faz deploy automático em ~1 min
3. Mesmo link, versão nova

---

## VARIÁVEIS DE AMBIENTE

| Nome | Valor | Onde |
|------|-------|------|
| `GOOGLE_MAPS_API_KEY` | sua chave | Vercel > Settings > Env Vars |

---

## ESTRUTURA

```
welovechile-routes/
├── api/                    ← funções serverless (rodam no Vercel, chave protegida)
│   ├── geocode.js          ← converte endereço em lat/lng
│   └── routes.js           ← otimiza ordem de paradas
├── src/                    ← app React (roda no navegador)
│   ├── App.jsx             ← componente principal
│   ├── styles.js           ← estilos
│   └── main.jsx            ← entry point
├── index.html              ← HTML base
├── package.json            ← dependências
├── vite.config.js          ← build config
└── vercel.json             ← deploy config
```

---

## CUSTO ESTIMADO

- Geocoding: 10.000 requests grátis/mês. Com cache local, depois de 2 semanas seu uso real fica em ~50/mês. **Custo: US$0**.
- Routes: 2 chamadas por rota gerada (1 otimização por setor + 1 cálculo de tempos). Em alta temporada (~15 rotas/dia × 30): ~900/mês. **Custo após trial de US$300: ~US$5/mês**.

Total esperado: **US$0/mês durante 90 dias do trial Google, depois US$5-10/mês na alta temporada**.
