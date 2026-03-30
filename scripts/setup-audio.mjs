#!/usr/bin/env node

import {
  chmodSync,
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const VENDOR_WHISPER = join(ROOT, 'vendor', 'whisper');
const MODELS_DIR = join(VENDOR_WHISPER, 'models');
const BIN_DIR = join(VENDOR_WHISPER, 'bin');
const WHISPER_SRC = join(VENDOR_WHISPER, 'whisper.cpp');
const VENDOR_FFMPEG = join(ROOT, 'vendor', 'ffmpeg');

const WHISPER_TAG = 'v1.8.4';
const WIN_ZIP_URL = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_TAG}/whisper-blas-bin-x64.zip`;

const MODEL_FILE = process.env.FZ_WHISPER_MODEL?.trim() || 'ggml-base.bin';
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_FILE}`;

const platform = process.platform;
const arch = process.arch;

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    encoding: 'utf8',
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    shell: opts.shell ?? false,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(`Comando falhou (${cmd} ${args.join(' ')}): código ${String(r.status)}`);
  }
}

async function downloadToFile(url, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Download falhou: ${url} → HTTP ${String(res.status)}`);
  }
  const body = res.body;
  if (!body) throw new Error('Resposta sem corpo');
  await pipeline(body, createWriteStream(dest));
}

function upsertEnv(keys) {
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) {
    const ex = join(ROOT, '.env.example');
    if (!existsSync(ex)) throw new Error('Crie .env ou .env.example');
    copyFileSync(ex, envPath);
    console.log('[setup-audio] Criado .env a partir de .env.example');
  }
  let content = readFileSync(envPath, 'utf8');
  for (const [key, value] of Object.entries(keys)) {
    if (value === undefined || value === '') continue;
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(content)) {
      content = content.replace(re, line);
    } else {
      content = content.trimEnd() + '\n' + line + '\n';
    }
  }
  writeFileSync(envPath, content);
}

function commandExists(cmd) {
  try {
    if (platform === 'win32') {
      const r = spawnSync('where', [cmd], { encoding: 'utf8', shell: true });
      return r.status === 0;
    }
    const r = spawnSync('command', ['-v', cmd], { encoding: 'utf8', shell: '/bin/sh' });
    return r.status === 0;
  } catch {
    return false;
  }
}

function whisperCliName() {
  return platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
}

function findRecursive(dir, name) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const st = statSync(p);
    if (st.isDirectory()) {
      const hit = findRecursive(p, name);
      if (hit) return hit;
    } else if (f === name) {
      return p;
    }
  }
  return null;
}

async function ensureModel() {
  mkdirSync(MODELS_DIR, { recursive: true });
  const dest = join(MODELS_DIR, MODEL_FILE);
  if (existsSync(dest) && statSync(dest).size > 10_000_000) {
    console.log(`[setup-audio] Modelo já existe: ${relative(ROOT, dest)}`);
    return dest;
  }
  console.log(`[setup-audio] Baixando modelo ${MODEL_FILE} (pode demorar)…`);
  await downloadToFile(MODEL_URL, dest);
  console.log(`[setup-audio] Modelo salvo em ${relative(ROOT, dest)}`);
  return dest;
}

async function setupWindowsCli() {
  mkdirSync(BIN_DIR, { recursive: true });
  const cliTarget = join(BIN_DIR, whisperCliName());
  if (existsSync(cliTarget)) {
    console.log('[setup-audio] whisper-cli já presente (Windows).');
    return cliTarget;
  }
  const tmpZip = join(tmpdir(), `whisper-win-${Date.now()}.zip`);
  const tmpOut = join(tmpdir(), `whisper-win-out-${Date.now()}`);
  console.log('[setup-audio] Baixando whisper.cpp (Windows, pré-compilado)…');
  await downloadToFile(WIN_ZIP_URL, tmpZip);
  mkdirSync(tmpOut, { recursive: true });
  run('tar', ['-xf', tmpZip, '-C', tmpOut]);
  const exe = findRecursive(tmpOut, 'whisper-cli.exe');
  if (!exe) throw new Error('whisper-cli.exe não encontrado no ZIP');
  const dllDir = dirname(exe);
  for (const f of readdirSync(dllDir)) {
    if (f.endsWith('.dll') || f.endsWith('.exe')) {
      await copyFile(join(dllDir, f), join(BIN_DIR, f));
    }
  }
  console.log(`[setup-audio] whisper-cli instalado em ${relative(ROOT, cliTarget)}`);
  return join(BIN_DIR, whisperCliName());
}

function setupUnixCli() {
  mkdirSync(BIN_DIR, { recursive: true });
  const cliTarget = join(BIN_DIR, whisperCliName());
  if (existsSync(cliTarget)) {
    console.log('[setup-audio] whisper-cli já presente.');
    return cliTarget;
  }
  if (!commandExists('git')) {
    throw new Error('Instale git para compilar whisper.cpp (macOS/Linux).');
  }
  if (!commandExists('cmake')) {
    throw new Error('Instale cmake para compilar whisper.cpp (ex.: brew install cmake).');
  }
  if (!existsSync(WHISPER_SRC)) {
    console.log('[setup-audio] Clonando whisper.cpp (ramo tag)…');
    run('git', [
      'clone',
      '--depth',
      '1',
      '--branch',
      WHISPER_TAG,
      'https://github.com/ggml-org/whisper.cpp.git',
      WHISPER_SRC,
    ]);
  }
  const buildDir = join(WHISPER_SRC, 'build');
  const isDarwinArm = platform === 'darwin' && arch === 'arm64';
  const cmakeArgs = [
    '-B',
    buildDir,
    '-DCMAKE_BUILD_TYPE=Release',
    '-DBUILD_SHARED_LIBS=OFF',
    '-DWHISPER_BUILD_TESTS=OFF',
    '-DWHISPER_BUILD_EXAMPLES=ON',
  ];
  if (isDarwinArm) {
    cmakeArgs.push('-DGGML_METAL=ON');
  }
  console.log('[setup-audio] Configurando CMake…');
  run('cmake', cmakeArgs, { cwd: WHISPER_SRC });
  console.log('[setup-audio] Compilando whisper-cli (pode levar mais de um minuto)…');
  const cores = String(process.env.CMAKE_BUILD_PARALLEL_LEVEL || '4');
  run(
    'cmake',
    ['--build', buildDir, '--config', 'Release', '-j', cores, '--target', 'whisper-cli'],
    {
      cwd: WHISPER_SRC,
    },
  );
  const built = join(buildDir, 'bin', whisperCliName());
  if (!existsSync(built)) {
    throw new Error(`Compilação não gerou ${built}`);
  }
  copyFileSync(built, cliTarget);
  if (platform !== 'win32') {
    chmodSync(cliTarget, 0o755);
  }
  console.log(`[setup-audio] whisper-cli copiado para ${relative(ROOT, cliTarget)}`);
  return cliTarget;
}

async function ensureFfmpegPath() {
  if (commandExists('ffmpeg')) {
    console.log('[setup-audio] ffmpeg encontrado no PATH.');
    return 'ffmpeg';
  }
  if (platform === 'darwin') {
    mkdirSync(VENDOR_FFMPEG, { recursive: true });
    const localBin = join(VENDOR_FFMPEG, 'ffmpeg');
    if (existsSync(localBin)) {
      chmodSync(localBin, 0o755);
      console.log(`[setup-audio] Usando ffmpeg local: ${relative(ROOT, localBin)}`);
      return localBin;
    }
    const zipPath = join(VENDOR_FFMPEG, 'ffmpeg-macos.zip');
    console.log('[setup-audio] Baixando ffmpeg estático (evermeet.cx)…');
    await downloadToFile('https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip', zipPath);
    const tmpFf = join(tmpdir(), `ffmpeg-unzip-${String(Date.now())}`);
    mkdirSync(tmpFf, { recursive: true });
    run('unzip', ['-o', zipPath, '-d', tmpFf]);
    const found = findRecursive(tmpFf, 'ffmpeg');
    if (!found) {
      throw new Error('Binário ffmpeg não encontrado no ZIP da evermeet.cx');
    }
    copyFileSync(found, localBin);
    chmodSync(localBin, 0o755);
    console.log(`[setup-audio] ffmpeg em ${relative(ROOT, localBin)}`);
    return localBin;
  }
  console.warn(
    '[setup-audio] ffmpeg não encontrado. Instale: Linux `sudo apt install ffmpeg`, Windows https://ffmpeg.org/download.html',
  );
  return 'ffmpeg';
}

function sha256Short(p) {
  const h = createHash('sha256');
  h.update(readFileSync(p));
  return h.digest('hex').slice(0, 12);
}

async function main() {
  console.log('[setup-audio] Raiz do projeto:', ROOT);

  const exampleEnv = join(ROOT, '.env.example');
  if (!existsSync(exampleEnv)) {
    throw new Error('Arquivo .env.example não encontrado');
  }

  const modelPath = await ensureModel();

  let cliPath;
  if (platform === 'win32') {
    cliPath = await setupWindowsCli();
  } else {
    cliPath = setupUnixCli();
  }

  const ffmpegPath = await ensureFfmpegPath();

  upsertEnv({
    WHISPER_CLI_PATH: cliPath,
    WHISPER_MODEL_PATH: modelPath,
    WHISPER_LANG: 'pt',
    FFMPEG_PATH: ffmpegPath,
  });

  console.log('\n[setup-audio] Pronto. Caminhos gravados no .env:');
  console.log(`  WHISPER_CLI_PATH=${cliPath}`);
  console.log(`  WHISPER_MODEL_PATH=${modelPath}`);
  console.log(`  FFMPEG_PATH=${ffmpegPath}`);
  console.log('\nTeste: yarn dev e envie um áudio no WhatsApp, ou:');
  console.log(
    `  curl -s -X POST http://localhost:${process.env.PORT || '3009'}/dev/simulate-transcription -H 'Content-Type: application/json' -d '{"audioPath":"..."}'\n`,
  );
}

main().catch((err) => {
  console.error('[setup-audio] Erro:', err instanceof Error ? err.message : err);
  process.exit(1);
});
