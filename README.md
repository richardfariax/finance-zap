# Finance Zap

Bot de controle financeiro via **WhatsApp** (Baileys), com API **Fastify**, **PostgreSQL** + **Prisma**, parser heurístico, OCR (Tesseract), transcrição opcional (whisper.cpp), relatórios e arquitetura em camadas.

## Requisitos

- Node.js **20+**
- **Yarn** **1.22** (recomendado via Corepack: `corepack enable` — o campo `packageManager` no `package.json` fixa a versão)
- **Docker** (para PostgreSQL)
- **ffmpeg** no PATH (para conversão de áudio recebido pelo WhatsApp)
- Opcional: binário **whisper.cpp** + modelo (transcrição local)

## Instalação

```bash
yarn install
```

Transcrição de voz (opcional, tudo em `vendor/` + entradas no `.env`):

```bash
yarn setup:audio
```

Na primeira vez, crie o `.env` (ou deixe o script fazer isso):

```bash
yarn setup:env   # copia .env.example → .env se .env não existir
```

Ajuste `DATABASE_URL` se necessário (o padrão aponta para o Postgres do `docker-compose`).

## Banco de dados (Docker + migrations + seed)

**Tudo de uma vez** (sobe Postgres, espera a porta, gera client, aplica migrações, seed):

```bash
yarn bootstrap
```

**Passo a passo:**

```bash
docker compose up -d
yarn db:ready              # opcional: espera localhost:5432
yarn prisma:migrate        # desenvolvimento (interativo)
# ou, sem prompts (CI / primeira subida com migrações já versionadas):
yarn prisma:migrate:deploy
yarn prisma:seed
```

Os comandos `prisma:*` carregam automaticamente o arquivo **`.env`** (via `dotenv-cli`) e criam `.env` a partir do exemplo se ainda não existir.

## Executar em desenvolvimento

```bash
yarn dev
```

- API HTTP na porta definida em `PORT` (padrão **3009**).
- Pasta `baileys_auth/` guarda a sessão do WhatsApp.
- No terminal, aparece o **QR Code** para parear o número.

## Docker Compose (app + Postgres + áudio + OCR)

Sobe **PostgreSQL**, a **API** e deixa pronto:

- **ffmpeg** (conversão de áudio para WAV 16 kHz)
- **whisper.cpp** compilado na imagem + modelo **ggml-base.bin** (troque com build-arg `WHISPER_MODEL_FILE`)
- **Tesseract** (`por` + `eng`) para OCR no sistema; o código usa também **tesseract.js**
- **Migrações** (`prisma migrate deploy`) e **seed** de categorias na subida
- Volumes nomeados para **sessão Baileys** e **mídia** (não perdem ao recriar o container)

**Requisito:** Docker + Docker Compose v2.

```bash
docker compose up --build
```

Ou: `yarn docker:up` (mesmo efeito). Em segundo plano: `yarn docker:up:detached`. Logs do app: `yarn docker:logs`.

- API: `http://localhost:3009` (porta alterável com `PORT` no host, ex.: `PORT=8080 docker compose up`).
- Postgres exposto em `localhost:5432` (usuário `finance`, senha `finance`, DB `finance_zap`).
- O **QR Code** do WhatsApp aparece no terminal — use `tty: true` já definido no compose.

Variáveis úteis (arquivo `.env` na raiz do projeto ou ambiente do shell): `PORT`, `LOG_LEVEL`, `DEFAULT_TIMEZONE`, `WHISPER_LANG`, `WHISPER_PROMPT`, `RUN_SEED` (`false` para pular o seed após a primeira vez), `WHISPER_MODEL_FILE` (só no **build**, ex.: `ggml-small.bin`).

**Só o banco** (desenvolvimento local com `yarn dev`): `docker compose up postgres -d`.

**Nota:** a primeira build compila o whisper.cpp e pode levar vários minutos. Imagem final fica maior por causa do modelo GGML. Em **Mac Apple Silicon** o serviço `app` usa `platform: linux/amd64` para a compilação do whisper ser estável (pode ser mais lento na primeira build por emulação).

## Mensagens automáticas (WhatsApp)

- **Primeira mensagem** da pessoa: boas-vindas com o *primeiro nome* (push name) e apresentação curta do bot.
- **Todo dia, entre 00:00 e 00:44 no fuso do usuário** (`users.timezone`): resumo automático do **dia anterior** (despesas, receitas, saldo, top categorias + dica rápida).
- **Mais de 24h sem mensagem:** um lembrete amigável para **fixar a conversa** (não repete até a pessoa voltar a falar e ficar ausente de novo).

Exige migração: `yarn prisma:migrate:deploy` (novos campos em `users`).

## Autenticação Baileys

1. Rode `yarn dev`.
2. Escaneie o QR exibido no terminal com o WhatsApp (Aparelhos conectados).
3. Após conectado, a sessão fica em `BAILEYS_AUTH_DIR` (padrão `./baileys_auth`).

## Testar mensagens sem celular (dev)

Com o servidor rodando (`yarn dev`), envie texto simulado:

```bash
curl -s -X POST http://localhost:3009/dev/simulate-text \
  -H 'Content-Type: application/json' \
  -d '{"whatsappNumber":"5511999999999","text":"uber 23,50"}'
```

Rotas úteis:

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/health` | Healthcheck |
| GET | `/metrics/simple` | Uptime / memória |
| GET | `/reports/monthly?whatsappNumber=...` | Resumo do mês |
| GET | `/reports/categories?whatsappNumber=...` | Gastos por categoria |
| GET | `/transactions/latest?whatsappNumber=...` | Últimos lançamentos |
| POST | `/dev/simulate-text` | Simula mensagem de texto |
| POST | `/dev/simulate-ocr` | `{ "imagePath": "/caminho/arquivo.jpg" }` |
| POST | `/dev/simulate-transcription` | `{ "audioPath": "/caminho/arquivo.wav" }` |

Em **produção**, rotas `/dev/*` não são registradas.

## OCR (Tesseract)

- Implementação: `TesseractOcrProvider` (`tesseract.js` + pré-processamento com **sharp**).
- Idiomas: variável `TESSERACT_LANG` (ex.: `por+eng`).
- Cupons e prints com baixa qualidade podem exigir ajuste de imagem ou idiomas extras.

## Transcrição de áudio (automática no repositório)

Tudo fica em `vendor/` (ignorado pelo Git, exceto `.gitkeep`). Um comando prepara modelo GGML, binário `whisper-cli` e (no **macOS**, se não existir `ffmpeg` no PATH) um **ffmpeg** estático.

**Requisitos extras:**

- **macOS / Linux:** `git`, `cmake` e compilador C++ (Xcode CLT ou `build-essential`). No Apple Silicon o script habilita **Metal** no build.
- **Windows:** `tar` (Windows 10+) ou Git Bash; o script baixa o ZIP oficial com `whisper-cli.exe` e DLLs.

```bash
yarn setup:audio
```

Isso:

1. Garante `.env` (via `ensure-env`).
2. Baixa `vendor/whisper/models/ggml-base.bin` (troque com `FZ_WHISPER_MODEL=ggml-small.bin` para modelo maior).
3. **macOS/Linux:** clona `vendor/whisper/whisper.cpp`, compila e copia `vendor/whisper/bin/whisper-cli`.
4. **Windows:** baixa o release [ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp) e extrai para `vendor/whisper/bin/`.
5. **macOS sem ffmpeg no PATH:** baixa binário [evermeet.cx](https://evermeet.cx/ffmpeg/) para `vendor/ffmpeg/ffmpeg`.
6. Atualiza `WHISPER_CLI_PATH`, `WHISPER_MODEL_PATH`, `WHISPER_LANG=pt` e `FFMPEG_PATH` no `.env`.

**Dicas pós-setup:** opcionalmente defina `WHISPER_PROMPT` no `.env` (texto curto em PT; whisper.cpp repassa como `--prompt` e ajuda em valores e verbos de gasto/receita — exige binário recente). Modelo **small** ou **medium** costuma transcrever melhor que **base** em áudio ruidoso.

Em **Linux**, se não houver `ffmpeg` no sistema, instale com o gerenciador de pacotes (ex.: `sudo apt install ffmpeg`) e rode `yarn setup:audio` de novo ou aponte `FFMPEG_PATH` manualmente.

Se `WHISPER_CLI_PATH` / `WHISPER_MODEL_PATH` estiverem vazios, o servidor avisa no log e áudios não são transcritos.

### Testar sem WhatsApp

```bash
curl -s -X POST http://localhost:3009/dev/simulate-transcription \
  -H 'Content-Type: application/json' \
  -d '{"audioPath":"/caminho/teste.wav"}'
```

Referência: [whisper.cpp](https://github.com/ggerganov/whisper.cpp).

## Testes e qualidade

```bash
yarn test
yarn lint
yarn format:check
```

Checagem de tipos:

```bash
yarn typecheck
```

## Limitações atuais (MVP)

- Parser baseado em regras/heurísticas (sem LLM pago); erros em frases muito ambíguas.
- OCR depende da qualidade da imagem e do idioma.
- Transcrição depende de whisper.cpp/ffmpeg instalados e configurados.
- Reprocessamento de mensagem (`POST /dev/reprocess-message/:id`) ainda não implementado.
- Grupos `@g.us` são ignorados.

## Roadmap sugerido

- Painel web e API REST completa com autenticação.
- Exportação CSV/PDF.
- Motor de regras avançado e aprendizado com histórico.
- Integração com LLM local (opcional) mantendo o domínio desacoplado.
- Migrar para o pacote `baileys` oficial quando estável.

## Estrutura (`src/`)

- `app/` — bootstrap Fastify, wiring, rotas.
- `config/` — env validado (Zod).
- `modules/*` — domínio por feature (whatsapp, messages, parser, transactions, reports, media, …).
- `shared/` — utilitários, tipos, infra Prisma.

## Licença

MIT (ajuste conforme sua organização).
