# Finance Zap

Bot de controle financeiro pelo **WhatsApp** (Baileys), com API **Fastify**, **PostgreSQL** + **Prisma**, parser heurístico em português, **OCR** (Tesseract), **transcrição opcional** (whisper.cpp), relatórios e arquitetura em camadas.

## Para quem é

Pessoas que querem anotar **gastos** e **receitas**, além de **agenda e lembretes** com data e hora, em linguagem natural, sem abrir planilha. O bot confirma o que entendeu, pede esclarecimento quando precisa e usa mensagens curtas e padronizadas no WhatsApp.

## O que o usuário pode fazer (resumo)

| Ação | Exemplo de mensagem |
|------|---------------------|
| Gasto | `uber 23,50`, `gastei 40 no mercado` |
| Receita | `recebi 1200`, `recebi 80 de fulano` |
| Vários de uma vez | `uber 10, mercado 40` (separados por vírgula) |
| Resumo | `resumo` → o bot pergunta *hoje* ou *mês* |
| Ajuda | `ajuda` |
| Corrigir último valor | `corrige o último para 59,90` |
| Apagar último | `apaga o último lançamento` |
| Apagar tudo (conta) | `apagar todos os dados` (irreversível) |
| Lembrete / compromisso | `amanhã às 14h reunião com Ana`, `dia 10 pagar aluguel`, `daqui 30 minutos ligar para o cliente` |
| Listar agenda | `agenda`, `agenda de hoje`, `meus lembretes`, `próximos compromissos` |
| Cancelar lembrete | `cancelar lembrete do aluguel`, `cancelar aluguel` |
| Concluir | `marcar como feito …`, `paguei a conta de luz` (quando bater com título salvo) |
| Remarcar | `remarcar reunião de amanhã para 15h` (precisa de horário reconhecível) |

Mensagens automáticas (após migrações e com campos em `users`):

- **Primeira mensagem:** boas-vindas com o primeiro nome.
- **Todo dia entre 00:00 e 00:44** (fuso `users.timezone`): resumo de **ontem**.
- **Mais de 24 h sem falar:** lembrete para **fixar o chat** (não repete até a pessoa voltar e sumir de novo).

## Arquitetura (visão rápida)

1. **WhatsApp (Baileys)** recebe texto, áudio ou imagem → `IngestInboundUseCase`.
2. **Mídia:** áudio → transcrição; imagem → OCR (quando aplicável).
3. **Parser** (`FinancialParserService`) classifica intenção e extrai valor, tipo e categoria sugerida.
4. **Confirmações pendentes** (`PendingConfirmationRepository`) guardam contexto (tipo de movimentação, categoria incerta, período do resumo, transcrição de áudio).
5. **Transações** gravadas com auditoria e detecção de recorrência.
6. **Agenda / lembretes** (`src/modules/reminders/`): parser em PT-BR (`reminder-nl-parser.ts`), persistência (`UserReminder`, `ReminderDelivery` no Prisma), orquestração (`RemindersAppService`), copy em `reminder-messages.ts`.
7. **Disparo**: `ReminderSchedulerService` (`src/modules/notifications/application/reminder-scheduler.service.ts`) roda a cada minuto, busca lembretes ativos com `notifyAt` no intervalo (com lookback para tolerar atrasos), **deduplica** com `ReminderDelivery` (`@@unique([reminderId, slotAt])`), envia WhatsApp e marca como concluído (evento único) ou recalcula `eventAt`/`notifyAt` (recorrência).

**Fuso e regras de negócio (lembretes)**

- Cada lembrete guarda o **timezone** do usuário no momento da criação (alinhado a `users.timezone`).
- Compromisso **com hora**: aviso padrão **15 minutos antes** (`REMINDER_EARLY_MINUTES`).
- Só **data** (dia inteiro): notificação no início do dia local, na hora padrão `REMINDER_DEFAULT_DAY_HOUR` (padrão 9h).
- Recorrência simples: **todo dia** (com hora), **toda semana** (mesmo dia da semana + hora, quando a frase pedir), **todo mês dia N**.

**Integração com o fluxo financeiro**

No `IngestInboundUseCase`, após comandos do último lançamento e bloqueio “só número”, o texto é tentado primeiro no **módulo de lembretes**; se não for agenda, segue o parser financeiro. Frases claramente monetárias (`gastei 50`, `recebi 100`, etc.) são ignoradas pelo parser de lembretes.

Copy voltado ao usuário final fica centralizado em `src/modules/whatsapp/presentation/bot-replies.ts`. A frase `TRANSACTION_TYPE_CHOICE_PHRASE` alinha a mensagem de “despesa / receita / transferência” com o roteamento do ingest (evita divergência entre texto e lógica).

## Requisitos

- **Node.js 20+**
- **Yarn 1.22** (recomendado: `corepack enable` — `packageManager` no `package.json` fixa a versão)
- **Docker** (PostgreSQL; opcionalmente app completo)
- **ffmpeg** no PATH (áudio do WhatsApp)
- Opcional: **whisper.cpp** + modelo (transcrição local)

## Instalação

```bash
yarn install
```

Criar `.env` (ou deixar o script criar a partir do exemplo):

```bash
yarn setup:env
```

Ajuste `DATABASE_URL` se necessário (padrão aponta para o Postgres do `docker-compose`).

### Transcrição de voz (opcional)

```bash
yarn setup:audio
```

Coloca binários/modelo em `vendor/` (gitignored, exceto `.gitkeep`). Ver secção mais abaixo.

## Banco de dados

**Tudo de uma vez** (Postgres, espera porta, Prisma generate, migrate deploy, seed):

```bash
yarn bootstrap
```

**Passo a passo:**

```bash
docker compose up -d postgres
yarn db:ready
yarn prisma:migrate
# ou CI / deploy: yarn prisma:migrate:deploy
yarn prisma:seed
```

Comandos `prisma:*` carregam `.env` via `dotenv-cli`.

## Executar em desenvolvimento

```bash
yarn dev
```

- API HTTP na porta **`PORT`** (padrão **3009**).
- Sessão WhatsApp em `BAILEYS_AUTH_DIR` (padrão `./baileys_auth`).
- **QR Code** no terminal para parear o número.

## Docker Compose (app + Postgres + áudio + OCR)

Sobe Postgres, API, ffmpeg, whisper na imagem, Tesseract, migrações e seed.

```bash
docker compose up --build
# ou: yarn docker:up  |  segundo plano: yarn docker:up:detached
```

- API: `http://localhost:3009` (porta do host alterável com `PORT`).
- Postgres: `localhost:5432` (usuário `finance`, senha `finance`, DB `finance_zap`).
- **QR Code** no terminal (`tty: true` no compose).

Variáveis úteis: `PORT`, `LOG_LEVEL`, `DEFAULT_TIMEZONE`, `WHISPER_LANG`, `WHISPER_PROMPT`, `RUN_SEED`, `WHISPER_MODEL_FILE` (build-arg). **Apple Silicon:** o serviço `app` pode usar `platform: linux/amd64` para build estável do whisper (primeira build mais lenta).

**Só o banco** (app local com `yarn dev`): `docker compose up postgres -d`.

## Variáveis de ambiente (principais)

| Variável | Descrição |
|----------|-----------|
| `PORT` | Porta HTTP da API |
| `DATABASE_URL` | Postgres (Prisma) |
| `BAILEYS_AUTH_DIR` | Pasta da sessão Baileys |
| `MEDIA_STORAGE_DIR` | Arquivos de mídia recebidos |
| `DEFAULT_TIMEZONE` | Fuso padrão de novos usuários / relatórios |
| `DEFAULT_LOCALE` | Locale (pt-BR) |
| `TESSERACT_LANG` | Idiomas OCR (ex.: `por+eng`) |
| `WHISPER_CLI_PATH` / `WHISPER_MODEL_PATH` | Transcrição local |
| `FFMPEG_PATH` | Conversão de áudio |
| `REMINDER_DEFAULT_DAY_HOUR` | Hora local (0–23) para lembretes só com data |
| `REMINDER_EARLY_MINUTES` | Antecedência padrão para compromissos com hora (minutos) |

Lista completa no `.env.example`.

## Testar sem celular (desenvolvimento)

Com `yarn dev` rodando:

```bash
curl -s -X POST http://localhost:3009/dev/simulate-text \
  -H 'Content-Type: application/json' \
  -d '{"whatsappNumber":"5511999999999","text":"uber 23,50"}'
```

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/health` | Healthcheck |
| GET | `/metrics/simple` | Uptime / memória |
| GET | `/reports/monthly?whatsappNumber=...` | Resumo do mês |
| GET | `/reports/categories?whatsappNumber=...` | Gastos por categoria |
| GET | `/transactions/latest?whatsappNumber=...` | Últimos lançamentos |
| POST | `/dev/simulate-text` | Simula mensagem de texto |
| POST | `/dev/simulate-ocr` | `{ "imagePath": "/caminho/arquivo.jpg" }` |
| POST | `/dev/interpret-receipt` | `{ "text": "…texto do OCR…" }` → JSON estruturado do comprovante |
| POST | `/dev/simulate-transcription` | `{ "audioPath": "/caminho/arquivo.wav" }` |
| GET | `/dev/reminders?whatsappNumber=…` | Lista lembretes ativos do usuário (JSON) |
| POST | `/dev/reminders/tick` | Executa um ciclo do scheduler (retorna `{ processed: n }`) |

Em **produção**, rotas `/dev/*` não são registradas.

Para testar lembretes por texto (mesmo fluxo do WhatsApp):

```bash
curl -s -X POST http://localhost:3009/dev/simulate-text \
  -H 'Content-Type: application/json' \
  -d '{"whatsappNumber":"5511999999999","text":"amanhã às 14h reunião com Ana"}'
```

## Autenticação Baileys

1. `yarn dev`
2. Escanear o QR com WhatsApp → Aparelhos conectados
3. Sessão persistida em `BAILEYS_AUTH_DIR`

## OCR

Implementação: `TesseractOcrProvider` (`tesseract.js` + **sharp**). Ajuste `TESSERACT_LANG` para cupons mistos PT/EN.

### Comprovantes (cupom / NF)

Após o OCR, o texto é analisado por heurísticas em `interpretBrazilianReceipt` (`src/modules/receipts/`): **valor total** (prioriza linhas com *TOTAL*, *VALOR A PAGAR*, etc.), **estabelecimento** quando legível, tipo (combustível, supermercado, restaurante, farmácia, recibo), data e categoria sugerida — **sem lista de produtos** (`itens` permanece vazio no JSON por compatibilidade). Se a confiança for **alta** ou **média** e houver valor, o bot envia um resumo e pede *sim* antes de gravar o gasto (igual ao fluxo de áudio). O JSON estruturado fica em `messages.metadata.receiptInterpretation`.

## Transcrição (whisper.cpp)

Setup local em `vendor/`:

```bash
yarn setup:audio
```

Requisitos extras: `git`, `cmake`, C++ toolchain (Xcode CLT / `build-essential`). No macOS Apple Silicon o script pode habilitar Metal. **Windows:** release ZIP do whisper.cpp. **macOS sem ffmpeg no PATH:** download opcional para `vendor/ffmpeg/`.

Referência: [whisper.cpp](https://github.com/ggerganov/whisper.cpp).

## Testes e qualidade

```bash
yarn test
yarn lint
yarn format:check
yarn typecheck
```

Inclui testes de parser financeiro, **parser de lembretes** (`reminder-nl-parser`), segmentação de mensagens, comandos do último lançamento, copy estável (`TRANSACTION_TYPE_CHOICE_PHRASE`), datas amigáveis (`user-facing-date`) e agregados de relatório.

## Troubleshooting

| Problema | O que verificar |
|----------|-----------------|
| Bot não responde | `yarn dev` rodando, QR pareado, `outbound.canSend()` (Baileys conectado) |
| Erro de banco | `DATABASE_URL`, Postgres no ar, `yarn prisma:migrate:deploy` |
| Áudio não vira texto | `FFMPEG_PATH`, `WHISPER_*` no `.env`, logs no startup |
| OCR ilegível | Qualidade da foto, `TESSERACT_LANG`, contraste |
| Resumo automático não sai | Migrações aplicadas, `users.timezone`, janela 00:00–00:44 local |
| Lembrete não dispara | WhatsApp conectado (`canSend`), migração `user_reminders` aplicada, `POST /dev/reminders/tick` para forçar tick em dev |

## Limitações (MVP)

- Parser heurístico (sem LLM pago): frases muito ambíguas exigem confirmação.
- Agenda: recorrências avançadas (RRULE completo), fusos diferentes por lembrete e múltiplos lembretes no mesmo minuto não são o foco; deduplicação é por `(reminderId, slotAt)`.
- Para evento **único com hora**, há **um** disparo no horário de aviso (antecipado), não um segundo “é agora” (comportamento intencional para MVP).
- OCR e transcrição dependem de qualidade e configuração.
- Grupos `@g.us` são ignorados.
- Reprocessamento de mensagem por ID ainda não implementado.

## Estrutura (`src/`)

- `app/` — Fastify, wiring, rotas.
- `config/` — env validado (Zod).
- `modules/` — features: `whatsapp`, `messages`, `parser`, `transactions`, `reports`, `reminders`, `notifications`, `media`, `confirmations`, etc.
- `shared/` — tipos, utilitários (`user-facing-date`, `normalize-text`, …), Prisma.

## Licença

MIT (ajuste conforme sua organização).
